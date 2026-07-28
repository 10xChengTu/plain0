import {
	registerWorkbenchContribution2,
	WorkbenchPhase,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/contributions";
import { INotificationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service";

import { getPlainDebugRuntime } from "./plain-debug-runtime";
import { SESSION_ENDED_EVENT_NAME } from "./plain-debug-session";

/**
 * `F100` S5 — the piece that finally makes `plain/sessionEnded` (Plain's own
 * synthetic "the transport died" signal — see `src-tauri/src/debug/session.rs`'s
 * module doc) **visible** to the user. S2/S3/S4 wired this event all the way
 * from the reader thread through `DebugSessionController#handleEvent`
 * clearing its own state to `null`, but nothing ever told the user *why* the
 * session was gone — the UI simply went back to "Not debugging.", which reads
 * identically to a deliberate `Plain: Stop Debugging`. This class closes that
 * gap with a single `INotificationService.error` call naming the real reason
 * (`transportClosed`/`malformedFrame`), the same "self-registering
 * `registerWorkbenchContribution2` class" shape
 * `PlainDebugTerminalIntegration` already established for the identical
 * "purely reacts to a debug session event stream, needs no view of its own"
 * situation.
 *
 * # Why a deliberate user-initiated `Plain: Stop Debugging` never triggers this
 *
 * `DebugSessionController.disconnect` clears its own `state` to `null`
 * *synchronously*, before ever awaiting the `debugDisconnect` bridge call —
 * and `DebugSessionController#handleEvent` drops every event once `state` is
 * already `null` (see that method's own doc comment), including the
 * `plain/sessionEnded` event that eventually arrives once the real backend
 * teardown finishes tearing down the transport. So by construction, this
 * class's `onEvent` listener only ever *sees* a `plain/sessionEnded` event
 * when the session was still considered live from the frontend's own point
 * of view at the moment it ended — i.e. exactly the "this was not requested"
 * case this notification exists to surface. No extra bookkeeping needed here
 * to distinguish the two cases: the existing state machine already does it.
 *
 * # Why a `registerWorkbenchContribution2` class, not a view reacting to its own construction
 *
 * Mirrors `PlainDebugTerminalIntegration`'s own identical reasoning: a
 * session can end while the user has none of the three sidebar debug views
 * or the Debug Console open at all, and the notification must still appear —
 * a view-scoped listener would only exist once its own container had already
 * been constructed.
 */
export class PlainDebugSessionAlerts {
	static readonly ID = "plain.workbench.contrib.debugSessionAlerts";

	#eventSubscription: { dispose(): void } | undefined;

	constructor(private readonly notificationService: INotificationService) {
		const runtime = getPlainDebugRuntime();
		if (runtime === undefined) {
			return;
		}
		this.#eventSubscription = runtime.session.onEvent((event) => {
			if (event.event !== SESSION_ENDED_EVENT_NAME) {
				return;
			}
			this.notificationService.error(sessionEndedMessage(event.body));
		});
	}

	dispose(): void {
		this.#eventSubscription?.dispose();
		this.#eventSubscription = undefined;
	}
}

/** Translates `plain/sessionEnded`'s own `{ reason }` body (see
 * `src-tauri/src/debug/session.rs`'s `SessionEndReason::as_wire`) into a
 * human-readable message — an unrecognized/malformed body still produces a
 * real, honest (if generic) message rather than silently showing nothing or
 * throwing. Exported for unit testing without needing a live Workbench. */
export function sessionEndedMessage(body: unknown): string {
	const reason =
		typeof body === "object" && body !== null && !Array.isArray(body)
			? (body as Record<string, unknown>).reason
			: undefined;
	if (reason === "transportClosed") {
		return "Plain: the debug adapter's connection closed unexpectedly. The debugging session has ended.";
	}
	if (reason === "malformedFrame") {
		return "Plain: the debug adapter sent a malformed message and the debugging session had to end.";
	}
	return "Plain: the debugging session ended unexpectedly.";
}

Object.freeze(PlainDebugSessionAlerts.prototype);

INotificationService(PlainDebugSessionAlerts, undefined, 0);

registerWorkbenchContribution2(
	PlainDebugSessionAlerts.ID,
	PlainDebugSessionAlerts,
	WorkbenchPhase.AfterRestored,
);
