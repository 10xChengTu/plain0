import {
	registerWorkbenchContribution2,
	WorkbenchPhase,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/contributions";
import { IViewsService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/views/common/viewsService.service";

import type { PlainTerminalView } from "../terminal/plain-terminal-view";
import { TERMINAL_VIEW_ID } from "../terminal/terminal-contribution";
import { getPlainDebugRuntime } from "./plain-debug-runtime";

/**
 * `F100` S4 — the piece that turns a real `runInTerminal` reverse request
 * (handled entirely in Rust — `debug::commands::handle_run_in_terminal_reverse_request`,
 * via `TerminalService::start_program`) into a **visible** terminal tab, per
 * the frozen research doc's "主导会话裁定" item 4: since there is no second
 * confirmation dialog for `runInTerminal` (an already-spawned, already-
 * trusted adapter can already run anything without asking first — a second
 * dialog here would add friction, not real security), *visibility* is the
 * substitute safeguard, and this class is what actually delivers it.
 *
 * # Why a `registerWorkbenchContribution2` class, not a view reacting to its
 * own construction
 *
 * `PlainTerminalView` itself only exists once something has already caused
 * the Panel/Terminal container to be constructed (opening the panel, running
 * `Plain: Create Terminal`, …) — if the user has never done either, no
 * `PlainTerminalView` instance exists yet to catch a `"plain/runInTerminal"`
 * notification at all. A `registerWorkbenchContribution2` class, by
 * contrast, is instantiated unconditionally at a fixed `WorkbenchPhase`
 * regardless of what the user has or hasn't opened, and
 * `IViewsService.openView(id, true)` **forces** the target view (and its
 * container) into existence if it does not already exist — exactly the
 * "可见性兜底" (visibility as the backstop) this feature's own task
 * instructions require: the tab must actually appear, not merely "exist
 * once the user happens to open the right panel later".
 *
 * # Why this lives in the `debug` feature, not `terminal`
 *
 * The terminal domain has no reason to know `runInTerminal`, DAP, or the
 * debug runtime exist at all — it is a generic PTY facility. This class is
 * the one-directional dependency the other way around (debug depends on
 * terminal's own `PlainTerminalView.adoptExternalSession`/`TERMINAL_VIEW_ID`,
 * never the reverse), keeping the terminal domain itself unaware of its own
 * debug-triggered callers.
 */
export class PlainDebugTerminalIntegration {
	static readonly ID = "plain.workbench.contrib.debugTerminalIntegration";

	#eventSubscription: { dispose(): void } | undefined;

	constructor(private readonly viewsService: IViewsService) {
		const runtime = getPlainDebugRuntime();
		if (runtime === undefined) {
			return;
		}
		this.#eventSubscription = runtime.session.onEvent((event) => {
			if (event.event !== "plain/runInTerminal") {
				return;
			}
			this.#adopt(event.body);
		});
	}

	#adopt(body: unknown): void {
		if (typeof body !== "object" || body === null || Array.isArray(body)) {
			return;
		}
		const record = body as Record<string, unknown>;
		const terminalSessionId = record.terminalSessionId;
		const title = record.title;
		if (
			typeof terminalSessionId !== "string" ||
			typeof title !== "string" ||
			title.length === 0
		) {
			return;
		}
		void this.viewsService
			.openView<PlainTerminalView>(TERMINAL_VIEW_ID, true)
			.then((view) => {
				view?.adoptExternalSession(terminalSessionId, `Debug: ${title}`);
			})
			.catch(() => {
				// Best-effort: a failure revealing/constructing the terminal view
				// must not become an unhandled rejection on this shared page (see
				// F090 S0's own recorded lesson) — there is no user-facing surface
				// this class itself owns to report it through, and the debug
				// session/adapter side of `runInTerminal` has already replied to
				// the adapter regardless (see `handle_run_in_terminal_reverse_request`'s
				// own doc comment: the Rust-side reply and this frontend
				// notification are independent).
			});
	}

	dispose(): void {
		this.#eventSubscription?.dispose();
		this.#eventSubscription = undefined;
	}
}

Object.freeze(PlainDebugTerminalIntegration.prototype);

IViewsService(PlainDebugTerminalIntegration, undefined, 0);

registerWorkbenchContribution2(
	PlainDebugTerminalIntegration.ID,
	PlainDebugTerminalIntegration,
	WorkbenchPhase.AfterRestored,
);
