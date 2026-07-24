import { describe, expect, it } from "vitest";

import type {
	TerminalDataEvent,
	TerminalExitEvent,
} from "../../app/platform/tauri/contracts";
import {
	openTerminalStream,
	type TerminalStreamTransport,
} from "../../app/platform/tauri/terminal-stream";

const SESSION_ID = "0d3f4b0e-6f1a-4c9d-9c3a-1a2b3c4d5e6f";
const OTHER_SESSION_ID = "1d3f4b0e-6f1a-4c9d-9c3a-1a2b3c4d5e6f";

function bytes(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

interface FakeTransportHandle {
	readonly transport: TerminalStreamTransport;
	readonly inputCalls: Array<{ sessionId: string; data: Uint8Array }>;
	readonly resizeCalls: Array<{
		sessionId: string;
		cols: number;
		rows: number;
	}>;
	readonly ackCalls: Array<{ sessionId: string; byteCount: number }>;
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
	const inputCalls: Array<{ sessionId: string; data: Uint8Array }> = [];
	const resizeCalls: Array<{
		sessionId: string;
		cols: number;
		rows: number;
	}> = [];
	const ackCalls: Array<{ sessionId: string; byteCount: number }> = [];
	const killCalls: Array<{ sessionId: string; immediate: boolean }> = [];
	const dataListeners = new Set<(event: TerminalDataEvent) => void>();
	const exitListeners = new Set<(event: TerminalExitEvent) => void>();
	let startError: unknown;
	let startGate: Promise<void> | undefined;
	let releaseStartGate: (() => void) | undefined;

	return {
		inputCalls,
		resizeCalls,
		ackCalls,
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
			async terminalStart() {
				if (startGate !== undefined) {
					await startGate;
					startGate = undefined;
				}
				if (startError !== undefined) {
					const error = startError;
					startError = undefined;
					throw error;
				}
				return { sessionId };
			},
			async terminalInput(id, data) {
				inputCalls.push({ sessionId: id, data });
			},
			async terminalResize(id, cols, rows) {
				resizeCalls.push({ sessionId: id, cols, rows });
			},
			async terminalAck(id, byteCount) {
				ackCalls.push({ sessionId: id, byteCount });
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

const startRequest = Object.freeze({ cwd: null, cols: 80, rows: 24 });

describe("openTerminalStream", () => {
	it("resolves with the started sessionId and exposes write/resize/ack/kill", async () => {
		const fake = createFakeTransport();
		const stream = await openTerminalStream(fake.transport, startRequest, {
			onData: () => {},
			onExit: () => {},
		});
		expect(stream.sessionId).toBe(SESSION_ID);

		await stream.write(bytes("hi"));
		expect(fake.inputCalls).toEqual([
			{ sessionId: SESSION_ID, data: bytes("hi") },
		]);

		await stream.resize(100, 40);
		expect(fake.resizeCalls).toEqual([
			{ sessionId: SESSION_ID, cols: 100, rows: 40 },
		]);

		await stream.ack(1_234);
		expect(fake.ackCalls).toEqual([
			{ sessionId: SESSION_ID, byteCount: 1_234 },
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
		const delivered: Uint8Array[] = [];
		const exits: number[] = [];
		const promise = openTerminalStream(fake.transport, startRequest, {
			onData: (data) => delivered.push(data),
			onExit: (exitCode) => exits.push(exitCode),
		});

		// The session id is not known yet — these must not throw, and must not
		// be delivered until (and unless) they turn out to belong to us.
		fake.emitData({
			sessionId: OTHER_SESSION_ID,
			sequence: 0,
			bytes: bytes("not-mine"),
		});
		fake.emitData({ sessionId: SESSION_ID, sequence: 0, bytes: bytes("a") });
		fake.emitExit({ sessionId: OTHER_SESSION_ID, exitCode: 9 });

		release();
		const stream = await promise;
		expect(stream.sessionId).toBe(SESSION_ID);
		expect(delivered).toEqual([bytes("a")]);
		expect(exits).toEqual([]);

		fake.emitData({ sessionId: SESSION_ID, sequence: 1, bytes: bytes("b") });
		expect(delivered).toEqual([bytes("a"), bytes("b")]);
		stream.dispose();
	});

	it("delivers data events for its own session in order and ignores other sessions", async () => {
		const fake = createFakeTransport();
		const delivered: Uint8Array[] = [];
		const stream = await openTerminalStream(fake.transport, startRequest, {
			onData: (data) => delivered.push(data),
			onExit: () => {},
		});

		fake.emitData({
			sessionId: OTHER_SESSION_ID,
			sequence: 0,
			bytes: bytes("not-mine"),
		});
		fake.emitData({ sessionId: SESSION_ID, sequence: 0, bytes: bytes("a") });
		fake.emitData({ sessionId: SESSION_ID, sequence: 1, bytes: bytes("b") });

		expect(delivered).toEqual([bytes("a"), bytes("b")]);
		stream.dispose();
	});

	it("ignores an exact-duplicate (or older) sequence but delivers anything at or above the next expected one", async () => {
		const fake = createFakeTransport();
		const delivered: Uint8Array[] = [];
		const stream = await openTerminalStream(fake.transport, startRequest, {
			onData: (data) => delivered.push(data),
			onExit: () => {},
		});

		fake.emitData({ sessionId: SESSION_ID, sequence: 0, bytes: bytes("a") });
		fake.emitData({ sessionId: SESSION_ID, sequence: 0, bytes: bytes("dup") });
		fake.emitData({ sessionId: SESSION_ID, sequence: 1, bytes: bytes("b") });

		expect(delivered).toEqual([bytes("a"), bytes("b")]);
		stream.dispose();
	});

	it("fires onExit for its own session and ignores other sessions' exit", async () => {
		const fake = createFakeTransport();
		const exits: number[] = [];
		const stream = await openTerminalStream(fake.transport, startRequest, {
			onData: () => {},
			onExit: (exitCode) => exits.push(exitCode),
		});

		fake.emitExit({ sessionId: OTHER_SESSION_ID, exitCode: 1 });
		fake.emitExit({ sessionId: SESSION_ID, exitCode: 0 });

		expect(exits).toEqual([0]);
		stream.dispose();
	});

	it("does not stop delivering data after exit has already fired for the same session", async () => {
		const fake = createFakeTransport();
		const delivered: Uint8Array[] = [];
		let exited = false;
		const stream = await openTerminalStream(fake.transport, startRequest, {
			onData: (data) => delivered.push(data),
			onExit: () => {
				exited = true;
			},
		});

		fake.emitExit({ sessionId: SESSION_ID, exitCode: 0 });
		expect(exited).toBe(true);
		// A trailing chunk that raced ahead of exit reporting (the documented
		// exit/data ordering caveat) must still be delivered, not dropped.
		fake.emitData({
			sessionId: SESSION_ID,
			sequence: 0,
			bytes: bytes("trailing"),
		});
		expect(delivered).toEqual([bytes("trailing")]);
		stream.dispose();
	});

	it("stops delivering events after dispose()", async () => {
		const fake = createFakeTransport();
		const delivered: Uint8Array[] = [];
		const stream = await openTerminalStream(fake.transport, startRequest, {
			onData: (data) => delivered.push(data),
			onExit: () => {},
		});
		expect(fake.dataListenerCount()).toBe(1);
		expect(fake.exitListenerCount()).toBe(1);

		stream.dispose();
		expect(fake.dataListenerCount()).toBe(0);
		expect(fake.exitListenerCount()).toBe(0);

		fake.emitData({ sessionId: SESSION_ID, sequence: 0, bytes: bytes("a") });
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
				onData: () => {},
				onExit: () => {},
			}),
		).rejects.toEqual({
			code: "WORKSPACE_NOT_TRUSTED",
			message: "not trusted",
		});
		expect(fake.dataListenerCount()).toBe(0);
		expect(fake.exitListenerCount()).toBe(0);
	});

	it("write/resize/ack become no-ops after dispose but kill still forwards", async () => {
		const fake = createFakeTransport();
		const stream = await openTerminalStream(fake.transport, startRequest, {
			onData: () => {},
			onExit: () => {},
		});
		stream.dispose();
		await stream.write(bytes("x"));
		await stream.resize(1, 1);
		await stream.ack(1);
		expect(fake.inputCalls).toEqual([]);
		expect(fake.resizeCalls).toEqual([]);
		expect(fake.ackCalls).toEqual([]);

		await stream.kill(false);
		expect(fake.killCalls).toEqual([
			{ sessionId: SESSION_ID, immediate: false },
		]);
	});
});
