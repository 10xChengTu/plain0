import { describe, expect, it, vi } from "vitest";

import type {
	DebugEventPayload,
	DebugSetBreakpointsResult,
} from "../../app/platform/tauri/contracts";
import { DebugBreakpointStore } from "../../app/features/debug/plain-debug-breakpoints";
import {
	DebugSessionController,
	SESSION_ENDED_EVENT_NAME,
	type DebugSessionBridge,
	type DebugSessionState,
} from "../../app/features/debug/plain-debug-session";

const STDIO_TARGET = Object.freeze({
	transport: "stdio" as const,
	command: "/usr/bin/python3",
	args: Object.freeze(["-m", "debugpy.adapter"]),
});
const ROOT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ROOT_ID = "22222222-2222-4222-8222-222222222222";

interface FakeBridgeHandle {
	readonly bridge: DebugSessionBridge;
	emit(event: DebugEventPayload): void;
	readonly setBreakpointsCalls: Array<{
		sessionId: string;
		rootId: string;
		path: string;
		breakpoints: readonly { line: number }[];
	}>;
}

function fakeBridge(
	overrides: Partial<DebugSessionBridge> = {},
): FakeBridgeHandle {
	const listeners = new Set<(event: DebugEventPayload) => void>();
	const setBreakpointsCalls: FakeBridgeHandle["setBreakpointsCalls"] = [];
	let sessionCounter = 0;
	const bridge: DebugSessionBridge = {
		debugLaunch: vi.fn(async () => {
			sessionCounter += 1;
			return {
				sessionId: `session-${sessionCounter}`,
				capabilities: { supportsConditionalBreakpoints: true },
			};
		}),
		debugAttach: vi.fn(async () => {
			sessionCounter += 1;
			return { sessionId: `session-${sessionCounter}`, capabilities: {} };
		}),
		debugDisconnect: vi.fn(async () => {}),
		debugSetBreakpoints: vi.fn(
			async (
				sessionId: string,
				rootId: string,
				path: string,
				breakpoints: readonly { line: number }[],
			) => {
				setBreakpointsCalls.push({ sessionId, rootId, path, breakpoints });
				const result: DebugSetBreakpointsResult = {
					breakpoints: breakpoints.map((entry) => ({
						verified: true,
						line: entry.line,
						id: null,
						message: null,
					})),
				};
				return result;
			},
		),
		debugStackTrace: vi.fn(async () => ({
			stackFrames: [],
			totalFrames: 0,
		})),
		debugScopes: vi.fn(async () => ({ scopes: [] })),
		debugVariables: vi.fn(async () => ({ variables: [] })),
		debugEvaluate: vi.fn(async () => ({
			result: "7",
			type: "int",
			variablesReference: 0,
			namedVariables: null,
			indexedVariables: null,
		})),
		debugContinue: vi.fn(async () => ({ allThreadsContinued: true })),
		debugNext: vi.fn(async () => {}),
		debugStepIn: vi.fn(async () => {}),
		debugStepOut: vi.fn(async () => {}),
		debugPause: vi.fn(async () => {}),
		debugWatchEvent: vi.fn((listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}),
		...overrides,
	};
	return {
		bridge,
		emit(event) {
			for (const listener of listeners) {
				listener(event);
			}
		},
		setBreakpointsCalls,
	};
}

describe("DebugSessionController", () => {
	it("start() launches a session, sets state, and subscribes to events exactly once", async () => {
		const { bridge } = fakeBridge();
		const store = new DebugBreakpointStore();
		const controller = new DebugSessionController(bridge, store);

		const state = await controller.start(
			ROOT_ID,
			"launch",
			STDIO_TARGET,
			"debugpy",
			{
				program: "main.py",
			},
		);

		expect(state.sessionId).toBe("session-1");
		expect(state.rootId).toBe(ROOT_ID);
		expect(state.stoppedThreadId).toBeNull();
		expect(controller.state).toEqual(state);
		expect(bridge.debugLaunch).toHaveBeenCalledWith(
			ROOT_ID,
			STDIO_TARGET,
			"debugpy",
			{ program: "main.py" },
		);
		expect(bridge.debugWatchEvent).toHaveBeenCalledTimes(1);

		await controller.start(ROOT_ID, "launch", STDIO_TARGET, "debugpy", {});
		expect(bridge.debugWatchEvent).toHaveBeenCalledTimes(1);
	});

	it("attach sends the attach request instead of launch", async () => {
		const { bridge } = fakeBridge();
		const controller = new DebugSessionController(
			bridge,
			new DebugBreakpointStore(),
		);
		await controller.start(ROOT_ID, "attach", STDIO_TARGET, "debugpy", {});
		expect(bridge.debugAttach).toHaveBeenCalledTimes(1);
		expect(bridge.debugLaunch).not.toHaveBeenCalled();
	});

	it("replays matching events that arrive before launch returns its session id", async () => {
		let emitDuringLaunch: (event: DebugEventPayload) => void = () => {};
		const handle = fakeBridge({
			debugLaunch: vi.fn(async () => {
				emitDuringLaunch({
					sessionId: "stale-session",
					event: "plain/runInTerminal",
					body: { terminalSessionId: "stale-terminal", title: "stale" },
				});
				emitDuringLaunch({
					sessionId: "session-during-launch",
					event: "plain/runInTerminal",
					body: { terminalSessionId: "terminal-1", title: "main.py" },
				});
				return { sessionId: "session-during-launch", capabilities: {} };
			}),
		});
		emitDuringLaunch = handle.emit;
		const controller = new DebugSessionController(
			handle.bridge,
			new DebugBreakpointStore(),
		);
		const events: DebugEventPayload[] = [];
		controller.onEvent((event) => events.push(event));

		await controller.start(ROOT_ID, "launch", STDIO_TARGET, "debugpy", {});

		expect(events).toEqual([
			{
				sessionId: "session-during-launch",
				event: "plain/runInTerminal",
				body: { terminalSessionId: "terminal-1", title: "main.py" },
			},
		]);
	});

	it("a stopped event for the current session updates stoppedThreadId and notifies listeners", async () => {
		const { bridge, emit } = fakeBridge();
		const controller = new DebugSessionController(
			bridge,
			new DebugBreakpointStore(),
		);
		await controller.start(ROOT_ID, "launch", STDIO_TARGET, "debugpy", {});
		const states: (DebugSessionState | null)[] = [];
		controller.onDidChangeState((state) => {
			states.push(state);
		});

		emit({
			sessionId: "session-1",
			event: "stopped",
			body: { threadId: 3, reason: "breakpoint" },
		});

		expect(controller.state?.stoppedThreadId).toBe(3);
		expect(states.at(-1)?.stoppedThreadId).toBe(3);
	});

	it("a continued event resets stoppedThreadId to null", async () => {
		const { bridge, emit } = fakeBridge();
		const controller = new DebugSessionController(
			bridge,
			new DebugBreakpointStore(),
		);
		await controller.start(ROOT_ID, "launch", STDIO_TARGET, "debugpy", {});
		emit({ sessionId: "session-1", event: "stopped", body: { threadId: 1 } });
		expect(controller.state?.stoppedThreadId).toBe(1);

		emit({ sessionId: "session-1", event: "continued", body: null });
		expect(controller.state?.stoppedThreadId).toBeNull();
	});

	it("lastKnownThreadId survives a continued event (unlike stoppedThreadId)", async () => {
		const { bridge, emit } = fakeBridge();
		const controller = new DebugSessionController(
			bridge,
			new DebugBreakpointStore(),
		);
		await controller.start(ROOT_ID, "launch", STDIO_TARGET, "debugpy", {});
		emit({ sessionId: "session-1", event: "stopped", body: { threadId: 7 } });
		expect(controller.state?.lastKnownThreadId).toBe(7);

		emit({ sessionId: "session-1", event: "continued", body: null });
		expect(controller.state?.stoppedThreadId).toBeNull();
		expect(controller.state?.lastKnownThreadId).toBe(7);
	});

	it("a thread event names a thread before any stopped event has ever fired", async () => {
		const { bridge, emit } = fakeBridge();
		const controller = new DebugSessionController(
			bridge,
			new DebugBreakpointStore(),
		);
		await controller.start(ROOT_ID, "launch", STDIO_TARGET, "debugpy", {});
		expect(controller.state?.lastKnownThreadId).toBeNull();

		emit({
			sessionId: "session-1",
			event: "thread",
			body: { reason: "started", threadId: 4 },
		});
		expect(controller.state?.lastKnownThreadId).toBe(4);
		expect(controller.state?.stoppedThreadId).toBeNull();
	});

	it("events for a different session id are ignored", async () => {
		const { bridge, emit } = fakeBridge();
		const controller = new DebugSessionController(
			bridge,
			new DebugBreakpointStore(),
		);
		await controller.start(ROOT_ID, "launch", STDIO_TARGET, "debugpy", {});

		emit({
			sessionId: "some-other-session",
			event: "stopped",
			body: { threadId: 99 },
		});

		expect(controller.state?.stoppedThreadId).toBeNull();
	});

	it("plain/sessionEnded clears state and clears every path's recorded verification", async () => {
		const { bridge, emit } = fakeBridge();
		const store = new DebugBreakpointStore();
		store.toggle(ROOT_ID, "a.py", 5);
		const controller = new DebugSessionController(bridge, store);
		await controller.start(ROOT_ID, "launch", STDIO_TARGET, "debugpy", {});
		expect(store.viewsForPath(ROOT_ID, "a.py")[0]?.verification).not.toBeNull();

		emit({
			sessionId: "session-1",
			event: SESSION_ENDED_EVENT_NAME,
			body: null,
		});

		expect(controller.state).toBeNull();
		expect(store.viewsForPath(ROOT_ID, "a.py")[0]?.verification).toBeNull();
	});

	it("a terminated event disconnects the adapter and clears the completed session", async () => {
		const { bridge, emit } = fakeBridge();
		const store = new DebugBreakpointStore();
		store.toggle(ROOT_ID, "a.py", 5);
		const controller = new DebugSessionController(bridge, store);
		await controller.start(ROOT_ID, "launch", STDIO_TARGET, "debugpy", {});
		expect(store.viewsForPath(ROOT_ID, "a.py")[0]?.verification).not.toBeNull();

		emit({ sessionId: "session-1", event: "exited", body: { exitCode: 0 } });
		expect(controller.state).not.toBeNull();
		expect(bridge.debugDisconnect).not.toHaveBeenCalled();

		emit({ sessionId: "session-1", event: "terminated", body: null });

		expect(controller.state).toBeNull();
		expect(store.viewsForPath(ROOT_ID, "a.py")[0]?.verification).toBeNull();
		expect(bridge.debugDisconnect).toHaveBeenCalledExactlyOnceWith("session-1");
	});

	it("start() pushes every path's currently-placed breakpoints and records verification", async () => {
		const { bridge, setBreakpointsCalls } = fakeBridge();
		const store = new DebugBreakpointStore();
		store.toggle(ROOT_ID, "a.py", 5);
		store.toggle(ROOT_ID, "a.py", 10);
		store.toggle(ROOT_ID, "b.py", 1);
		store.toggle(OTHER_ROOT_ID, "a.py", 99);
		const controller = new DebugSessionController(bridge, store);

		await controller.start(ROOT_ID, "launch", STDIO_TARGET, "debugpy", {});

		expect(setBreakpointsCalls).toHaveLength(2);
		expect(setBreakpointsCalls.every((call) => call.rootId === ROOT_ID)).toBe(
			true,
		);
		const byPath = new Map(
			setBreakpointsCalls.map((call) => [call.path, call.breakpoints]),
		);
		expect(byPath.get("a.py")?.map((entry) => entry.line)).toEqual([5, 10]);
		expect(byPath.get("b.py")?.map((entry) => entry.line)).toEqual([1]);
		expect(store.viewsForPath(ROOT_ID, "a.py")[0]?.verification).toEqual({
			verified: true,
			actualLine: 5,
			message: null,
		});
		expect(
			store.viewsForPath(OTHER_ROOT_ID, "a.py")[0]?.verification,
		).toBeNull();
	});

	it("editing the breakpoint store while a session is live re-syncs only the changed path", async () => {
		const { bridge, setBreakpointsCalls } = fakeBridge();
		const store = new DebugBreakpointStore();
		store.toggle(ROOT_ID, "a.py", 5);
		const controller = new DebugSessionController(bridge, store);
		await controller.start(ROOT_ID, "launch", STDIO_TARGET, "debugpy", {});
		expect(setBreakpointsCalls).toHaveLength(1);

		store.toggle(OTHER_ROOT_ID, "a.py", 99);
		await Promise.resolve();
		await Promise.resolve();
		expect(setBreakpointsCalls).toHaveLength(1);

		store.toggle(ROOT_ID, "a.py", 8);
		await Promise.resolve();
		await Promise.resolve();

		expect(setBreakpointsCalls).toHaveLength(2);
		expect(setBreakpointsCalls[1]?.path).toBe("a.py");
		expect(setBreakpointsCalls[1]?.rootId).toBe(ROOT_ID);
		expect(
			setBreakpointsCalls[1]?.breakpoints.map((entry) => entry.line),
		).toEqual([5, 8]);
	});

	it("editing the breakpoint store before any session starts never calls the bridge", () => {
		const { bridge, setBreakpointsCalls } = fakeBridge();
		const store = new DebugBreakpointStore();
		const controller = new DebugSessionController(bridge, store);
		void controller;

		store.toggle(ROOT_ID, "a.py", 5);

		expect(setBreakpointsCalls).toHaveLength(0);
	});

	it("stackTrace/scopes/variables/evaluate resolve to undefined with no live session, without calling the bridge", async () => {
		const { bridge } = fakeBridge();
		const controller = new DebugSessionController(
			bridge,
			new DebugBreakpointStore(),
		);

		await expect(controller.stackTrace(1, null, null)).resolves.toBeUndefined();
		await expect(controller.scopes(1)).resolves.toBeUndefined();
		await expect(
			controller.variables(5, null, null, null),
		).resolves.toBeUndefined();
		await expect(
			controller.evaluate("1 + 1", null, "watch"),
		).resolves.toBeUndefined();
		expect(bridge.debugStackTrace).not.toHaveBeenCalled();
		expect(bridge.debugScopes).not.toHaveBeenCalled();
		expect(bridge.debugVariables).not.toHaveBeenCalled();
		expect(bridge.debugEvaluate).not.toHaveBeenCalled();
	});

	it("stackTrace/scopes/variables/evaluate delegate to the bridge scoped to the live session id", async () => {
		const { bridge } = fakeBridge();
		const controller = new DebugSessionController(
			bridge,
			new DebugBreakpointStore(),
		);
		await controller.start(ROOT_ID, "launch", STDIO_TARGET, "debugpy", {});

		await controller.stackTrace(2, 0, 20);
		expect(bridge.debugStackTrace).toHaveBeenCalledWith("session-1", 2, 0, 20);

		await controller.scopes(7);
		expect(bridge.debugScopes).toHaveBeenCalledWith("session-1", 7);

		await controller.variables(300, 10, 100, "indexed");
		expect(bridge.debugVariables).toHaveBeenCalledWith(
			"session-1",
			300,
			10,
			100,
			"indexed",
		);

		await controller.evaluate("a + b", 7, "watch");
		expect(bridge.debugEvaluate).toHaveBeenCalledWith(
			"session-1",
			"a + b",
			7,
			"watch",
		);
	});

	it("continue_/next/stepIn/stepOut/pause resolve to undefined/no-op with no live session, without calling the bridge", async () => {
		const { bridge } = fakeBridge();
		const controller = new DebugSessionController(
			bridge,
			new DebugBreakpointStore(),
		);

		await expect(controller.continue_(1)).resolves.toBeUndefined();
		await controller.next(1);
		await controller.stepIn(1);
		await controller.stepOut(1);
		await controller.pause(1);
		expect(bridge.debugContinue).not.toHaveBeenCalled();
		expect(bridge.debugNext).not.toHaveBeenCalled();
		expect(bridge.debugStepIn).not.toHaveBeenCalled();
		expect(bridge.debugStepOut).not.toHaveBeenCalled();
		expect(bridge.debugPause).not.toHaveBeenCalled();
	});

	it("continue_/next/stepIn/stepOut/pause delegate to the bridge scoped to the live session id", async () => {
		const { bridge } = fakeBridge();
		const controller = new DebugSessionController(
			bridge,
			new DebugBreakpointStore(),
		);
		await controller.start(ROOT_ID, "launch", STDIO_TARGET, "debugpy", {});

		const continueResult = await controller.continue_(1);
		expect(bridge.debugContinue).toHaveBeenCalledWith("session-1", 1);
		expect(continueResult?.allThreadsContinued).toBe(true);

		await controller.next(1);
		expect(bridge.debugNext).toHaveBeenCalledWith("session-1", 1);

		await controller.stepIn(1);
		expect(bridge.debugStepIn).toHaveBeenCalledWith("session-1", 1);

		await controller.stepOut(1);
		expect(bridge.debugStepOut).toHaveBeenCalledWith("session-1", 1);

		await controller.pause(1);
		expect(bridge.debugPause).toHaveBeenCalledWith("session-1", 1);
	});

	it("disconnect clears state before awaiting the bridge call, and is a no-op with no live session", async () => {
		const { bridge } = fakeBridge();
		const controller = new DebugSessionController(
			bridge,
			new DebugBreakpointStore(),
		);
		await controller.disconnect();
		expect(bridge.debugDisconnect).not.toHaveBeenCalled();

		await controller.start(ROOT_ID, "launch", STDIO_TARGET, "debugpy", {});
		await controller.disconnect();
		expect(controller.state).toBeNull();
		expect(bridge.debugDisconnect).toHaveBeenCalledWith("session-1");
	});

	it("dispose unsubscribes from debugWatchEvent and stops delivering further state/event notifications", async () => {
		const { bridge, emit } = fakeBridge();
		const controller = new DebugSessionController(
			bridge,
			new DebugBreakpointStore(),
		);
		await controller.start(ROOT_ID, "launch", STDIO_TARGET, "debugpy", {});
		const stateChanges: unknown[] = [];
		controller.onDidChangeState((state) => stateChanges.push(state));

		controller.dispose();
		emit({ sessionId: "session-1", event: "stopped", body: { threadId: 1 } });

		expect(stateChanges).toEqual([]);
	});
});
