import { describe, expect, it } from "vitest";

import type {
	TerminalDataEvent,
	TerminalExitEvent,
	TerminalFrame,
	TerminalScrollbackResult,
} from "../../app/platform/tauri/contracts";
import {
	attachTerminalStream,
	openTerminalStream,
	type TerminalStreamTransport,
} from "../../app/platform/tauri/terminal-stream";

const SESSION_ID = "0d3f4b0e-6f1a-4c9d-9c3a-1a2b3c4d5e6f";
const OTHER_SESSION_ID = "1d3f4b0e-6f1a-4c9d-9c3a-1a2b3c4d5e6f";
const ROOT_ID = "11111111-1111-4111-8111-111111111111";

const DEFAULT_STYLE = Object.freeze({
	bold: false,
	italic: false,
	faint: false,
	blink: false,
	inverse: false,
	invisible: false,
	strikethrough: false,
	overline: false,
	underline: "none" as const,
});

function frame(text: string): TerminalFrame {
	return {
		dirty: "partial",
		cols: 80,
		rows: 24,
		cursor: {
			visible: true,
			blinking: false,
			viewport: { x: text.length, y: 0, atWideTail: false },
			style: "block",
		},
		colors: {
			background: { r: 0, g: 0, b: 0 },
			foreground: { r: 229, g: 229, b: 229 },
			cursor: null,
		},
		rowsData: [
			{
				rowIndex: 0,
				semanticPrompt: "none",
				cells: [...text].map((character) => ({
					graphemes: character,
					fg: null,
					bg: null,
					style: DEFAULT_STYLE,
					hyperlink: null,
					semantic: "output",
				})),
			},
		],
		pwd: null,
	};
}

interface FakeTransportHandle {
	readonly transport: TerminalStreamTransport;
	readonly startCalls: Array<{
		rootId: string;
		profileId: string;
		cwd: string | null;
		cols: number;
		rows: number;
	}>;
	readonly inputTextCalls: Array<{ sessionId: string; text: string }>;
	readonly inputKeyCalls: Array<{
		sessionId: string;
		action: number;
		key: number;
		mods: number;
		utf8: string | null;
	}>;
	readonly focusCalls: Array<{ sessionId: string; focused: boolean }>;
	readonly resizeCalls: Array<{
		sessionId: string;
		cols: number;
		rows: number;
	}>;
	readonly ackCalls: Array<{ sessionId: string; sequence: number }>;
	readonly scrollbackCalls: Array<{
		sessionId: string;
		start: number;
		count: number;
	}>;
	readonly killCalls: Array<{ sessionId: string; immediate: boolean }>;
	readonly dataListenerCount: () => number;
	readonly exitListenerCount: () => number;
	emitData(event: TerminalDataEvent): void;
	emitExit(event: TerminalExitEvent): void;
	failNextStart(error: unknown): void;
	/** Makes the next `terminalStart` call hang until the returned function is
	 * invoked — lets a test emit events *before* the session id is known. */
	deferStart(): () => void;
}

function createFakeTransport(sessionId = SESSION_ID): FakeTransportHandle {
	const startCalls: FakeTransportHandle["startCalls"] = [];
	const inputTextCalls: FakeTransportHandle["inputTextCalls"] = [];
	const inputKeyCalls: FakeTransportHandle["inputKeyCalls"] = [];
	const focusCalls: FakeTransportHandle["focusCalls"] = [];
	const resizeCalls: FakeTransportHandle["resizeCalls"] = [];
	const ackCalls: FakeTransportHandle["ackCalls"] = [];
	const scrollbackCalls: FakeTransportHandle["scrollbackCalls"] = [];
	const killCalls: FakeTransportHandle["killCalls"] = [];
	const dataListeners = new Set<(event: TerminalDataEvent) => void>();
	const exitListeners = new Set<(event: TerminalExitEvent) => void>();
	let startError: unknown;
	let startGate: Promise<void> | undefined;
	let releaseStartGate: (() => void) | undefined;

	return {
		startCalls,
		inputTextCalls,
		inputKeyCalls,
		focusCalls,
		resizeCalls,
		ackCalls,
		scrollbackCalls,
		killCalls,
		dataListenerCount: () => dataListeners.size,
		exitListenerCount: () => exitListeners.size,
		emitData(event) {
			for (const listener of dataListeners) {
				listener(event);
			}
		},
		emitExit(event) {
			for (const listener of exitListeners) {
				listener(event);
			}
		},
		failNextStart(error) {
			startError = error;
		},
		deferStart() {
			startGate = new Promise((resolve) => {
				releaseStartGate = resolve;
			});
			return () => releaseStartGate?.();
		},
		transport: {
			async terminalStart(rootId, profileId, cwd, cols, rows) {
				startCalls.push({ rootId, profileId, cwd, cols, rows });
				if (startGate !== undefined) {
					await startGate;
					startGate = undefined;
				}
				if (startError !== undefined) {
					const error = startError;
					startError = undefined;
					throw error;
				}
				return { sessionId, shellIntegration: "injected" };
			},
			async terminalInputText(id, text) {
				inputTextCalls.push({ sessionId: id, text });
			},
			async terminalInputKey(id, action, key, mods, utf8) {
				inputKeyCalls.push({ sessionId: id, action, key, mods, utf8 });
			},
			async terminalFocus(id, focused) {
				focusCalls.push({ sessionId: id, focused });
			},
			async terminalResize(id, cols, rows) {
				resizeCalls.push({ sessionId: id, cols, rows });
			},
			async terminalAck(id, sequence) {
				ackCalls.push({ sessionId: id, sequence });
			},
			async terminalScrollback(id, start, count) {
				scrollbackCalls.push({ sessionId: id, start, count });
				return { rows: [] } satisfies TerminalScrollbackResult;
			},
			async terminalKill(id, immediate) {
				killCalls.push({ sessionId: id, immediate });
			},
			terminalWatchData(listener) {
				dataListeners.add(listener);
				return () => {
					dataListeners.delete(listener);
				};
			},
			terminalWatchExit(listener) {
				exitListeners.add(listener);
				return () => {
					exitListeners.delete(listener);
				};
			},
		},
	};
}

const startRequest = Object.freeze({
	rootId: ROOT_ID,
	profileId: "systemDefault",
	cwd: null,
	cols: 80,
	rows: 24,
});

describe("openTerminalStream", () => {
	it("resolves with the started sessionId and exposes writeText/writeKey/focus/resize/ack/scrollback/kill", async () => {
		const fake = createFakeTransport();
		const stream = await openTerminalStream(fake.transport, startRequest, {
			onFrame: () => {},
			onExit: () => {},
		});
		expect(stream.sessionId).toBe(SESSION_ID);
		expect(fake.startCalls).toEqual([
			{
				rootId: ROOT_ID,
				profileId: "systemDefault",
				cwd: null,
				cols: 80,
				rows: 24,
			},
		]);

		await stream.writeText("hi");
		expect(fake.inputTextCalls).toEqual([
			{ sessionId: SESSION_ID, text: "hi" },
		]);

		await stream.writeKey(0, 20, 0, "a");
		expect(fake.inputKeyCalls).toEqual([
			{ sessionId: SESSION_ID, action: 0, key: 20, mods: 0, utf8: "a" },
		]);

		await stream.focus(true);
		expect(fake.focusCalls).toEqual([{ sessionId: SESSION_ID, focused: true }]);

		await stream.resize(100, 40);
		expect(fake.resizeCalls).toEqual([
			{ sessionId: SESSION_ID, cols: 100, rows: 40 },
		]);

		await stream.ack(5);
		expect(fake.ackCalls).toEqual([{ sessionId: SESSION_ID, sequence: 5 }]);

		await stream.scrollback(0, 10);
		expect(fake.scrollbackCalls).toEqual([
			{ sessionId: SESSION_ID, start: 0, count: 10 },
		]);

		await stream.kill(true);
		expect(fake.killCalls).toEqual([
			{ sessionId: SESSION_ID, immediate: true },
		]);

		stream.dispose();
	});

	it("buffers data/exit events observed before terminalStart resolves and replays only its own session's", async () => {
		const fake = createFakeTransport();
		const release = fake.deferStart();
		const delivered: TerminalFrame[] = [];
		const exits: number[] = [];
		const promise = openTerminalStream(fake.transport, startRequest, {
			onFrame: (received) => delivered.push(received),
			onExit: (exitCode) => exits.push(exitCode),
		});

		// The session id is not known yet — these must not throw, and must not
		// be delivered until (and unless) they turn out to belong to us.
		fake.emitData({
			sessionId: OTHER_SESSION_ID,
			sequence: 0,
			frame: frame("not-mine"),
		});
		fake.emitData({ sessionId: SESSION_ID, sequence: 0, frame: frame("a") });
		fake.emitExit({ sessionId: OTHER_SESSION_ID, exitCode: 9 });

		release();
		const stream = await promise;
		expect(stream.sessionId).toBe(SESSION_ID);
		expect(delivered).toEqual([frame("a")]);
		expect(exits).toEqual([]);

		fake.emitData({ sessionId: SESSION_ID, sequence: 1, frame: frame("b") });
		expect(delivered).toEqual([frame("a"), frame("b")]);
		stream.dispose();
	});

	it("delivers data events for its own session in order and ignores other sessions", async () => {
		const fake = createFakeTransport();
		const delivered: TerminalFrame[] = [];
		const stream = await openTerminalStream(fake.transport, startRequest, {
			onFrame: (received) => delivered.push(received),
			onExit: () => {},
		});

		fake.emitData({
			sessionId: OTHER_SESSION_ID,
			sequence: 0,
			frame: frame("not-mine"),
		});
		fake.emitData({ sessionId: SESSION_ID, sequence: 0, frame: frame("a") });
		fake.emitData({ sessionId: SESSION_ID, sequence: 1, frame: frame("b") });

		expect(delivered).toEqual([frame("a"), frame("b")]);
		stream.dispose();
	});

	it("ignores an exact-duplicate (or older) sequence but delivers anything at or above the next expected one", async () => {
		const fake = createFakeTransport();
		const delivered: TerminalFrame[] = [];
		const stream = await openTerminalStream(fake.transport, startRequest, {
			onFrame: (received) => delivered.push(received),
			onExit: () => {},
		});

		fake.emitData({ sessionId: SESSION_ID, sequence: 0, frame: frame("a") });
		fake.emitData({
			sessionId: SESSION_ID,
			sequence: 0,
			frame: frame("dup"),
		});
		fake.emitData({ sessionId: SESSION_ID, sequence: 1, frame: frame("b") });

		expect(delivered).toEqual([frame("a"), frame("b")]);
		stream.dispose();
	});

	it("fires onExit for its own session and ignores other sessions' exit", async () => {
		const fake = createFakeTransport();
		const exits: number[] = [];
		const stream = await openTerminalStream(fake.transport, startRequest, {
			onFrame: () => {},
			onExit: (exitCode) => exits.push(exitCode),
		});

		fake.emitExit({ sessionId: OTHER_SESSION_ID, exitCode: 1 });
		fake.emitExit({ sessionId: SESSION_ID, exitCode: 0 });

		expect(exits).toEqual([0]);
		stream.dispose();
	});

	it("does not stop delivering data after exit has already fired for the same session", async () => {
		const fake = createFakeTransport();
		const delivered: TerminalFrame[] = [];
		let exited = false;
		const stream = await openTerminalStream(fake.transport, startRequest, {
			onFrame: (received) => delivered.push(received),
			onExit: () => {
				exited = true;
			},
		});

		fake.emitExit({ sessionId: SESSION_ID, exitCode: 0 });
		expect(exited).toBe(true);
		// A trailing frame that raced ahead of exit reporting (the documented
		// exit/data ordering caveat) must still be delivered, not dropped.
		fake.emitData({
			sessionId: SESSION_ID,
			sequence: 0,
			frame: frame("trailing"),
		});
		expect(delivered).toEqual([frame("trailing")]);
		stream.dispose();
	});

	it("stops delivering events after dispose()", async () => {
		const fake = createFakeTransport();
		const delivered: TerminalFrame[] = [];
		const stream = await openTerminalStream(fake.transport, startRequest, {
			onFrame: (received) => delivered.push(received),
			onExit: () => {},
		});
		expect(fake.dataListenerCount()).toBe(1);
		expect(fake.exitListenerCount()).toBe(1);

		stream.dispose();
		expect(fake.dataListenerCount()).toBe(0);
		expect(fake.exitListenerCount()).toBe(0);

		fake.emitData({ sessionId: SESSION_ID, sequence: 0, frame: frame("a") });
		expect(delivered).toEqual([]);

		// dispose() is safe to call more than once.
		stream.dispose();
	});

	it("propagates a rejection from terminalStart (e.g. WORKSPACE_NOT_TRUSTED) without catching it, and unsubscribes", async () => {
		const fake = createFakeTransport();
		fake.failNextStart({
			code: "WORKSPACE_NOT_TRUSTED",
			message: "not trusted",
		});
		await expect(
			openTerminalStream(fake.transport, startRequest, {
				onFrame: () => {},
				onExit: () => {},
			}),
		).rejects.toEqual({
			code: "WORKSPACE_NOT_TRUSTED",
			message: "not trusted",
		});
		expect(fake.dataListenerCount()).toBe(0);
		expect(fake.exitListenerCount()).toBe(0);
	});

	it("writeText/writeKey/focus/resize/ack become no-ops after dispose but kill still forwards", async () => {
		const fake = createFakeTransport();
		const stream = await openTerminalStream(fake.transport, startRequest, {
			onFrame: () => {},
			onExit: () => {},
		});
		stream.dispose();
		await stream.writeText("x");
		await stream.writeKey(0, 20, 0, null);
		await stream.focus(true);
		await stream.resize(1, 1);
		await stream.ack(1);
		expect(fake.inputTextCalls).toEqual([]);
		expect(fake.inputKeyCalls).toEqual([]);
		expect(fake.focusCalls).toEqual([]);
		expect(fake.resizeCalls).toEqual([]);
		expect(fake.ackCalls).toEqual([]);

		await stream.kill(false);
		expect(fake.killCalls).toEqual([
			{ sessionId: SESSION_ID, immediate: false },
		]);
	});

	it("scrollback is not gated by dispose (a caller may still want history after tearing down live listening)", async () => {
		const fake = createFakeTransport();
		const stream = await openTerminalStream(fake.transport, startRequest, {
			onFrame: () => {},
			onExit: () => {},
		});
		stream.dispose();
		const result = await stream.scrollback(0, 10);
		expect(result).toEqual({ rows: [] });
		expect(fake.scrollbackCalls).toEqual([
			{ sessionId: SESSION_ID, start: 0, count: 10 },
		]);
	});
});

describe("attachTerminalStream", () => {
	it("installs listeners before acknowledging any frame emitted before attachment", async () => {
		const fake = createFakeTransport();
		const delivered: TerminalFrame[] = [];

		const stream = await attachTerminalStream(fake.transport, SESSION_ID, {
			onFrame: (received) => delivered.push(received),
			onExit: () => {},
		});

		expect(fake.dataListenerCount()).toBe(1);
		expect(fake.exitListenerCount()).toBe(1);
		expect(fake.ackCalls).toEqual([
			{ sessionId: SESSION_ID, sequence: Number.MAX_SAFE_INTEGER },
		]);

		fake.emitData({
			sessionId: SESSION_ID,
			sequence: 1,
			frame: frame("redraw"),
		});
		expect(delivered).toEqual([frame("redraw")]);
		stream.dispose();
	});
});
