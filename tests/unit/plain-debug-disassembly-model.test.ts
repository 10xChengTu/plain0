import { describe, expect, it } from "vitest";

import {
	DISASSEMBLY_WINDOW_SIZE,
	disassemblySessionAvailability,
	isCurrentInstructionRow,
	nextDisassemblyOffset,
} from "../../app/features/debug/plain-debug-disassembly-model";
import type { DebugSessionState } from "../../app/features/debug/plain-debug-session";

function stateFixture(
	overrides: Partial<DebugSessionState> = {},
): DebugSessionState {
	return {
		sessionId: "session-1",
		rootId: "11111111-1111-4111-8111-111111111111",
		capabilities: {},
		stoppedThreadId: null,
		lastKnownThreadId: null,
		...overrides,
	};
}

describe("disassemblySessionAvailability", () => {
	it("reports 'Not debugging.' for a null state", () => {
		expect(disassemblySessionAvailability(null)).toEqual({
			reason: "Not debugging.",
		});
	});

	it("reports 'Running…' for a live session that is not stopped", () => {
		const state = stateFixture({
			stoppedThreadId: null,
			capabilities: { supportsDisassembleRequest: true },
		});
		expect(disassemblySessionAvailability(state)).toEqual({
			reason: "Running…",
		});
	});

	it("reports capability-missing for a stopped session that does not advertise supportsDisassembleRequest", () => {
		const state = stateFixture({ stoppedThreadId: 1, capabilities: {} });
		expect(disassemblySessionAvailability(state)).toEqual({
			reason: "The current debug adapter does not support disassembly.",
		});

		const explicitFalse = stateFixture({
			stoppedThreadId: 1,
			capabilities: { supportsDisassembleRequest: false },
		});
		expect(disassemblySessionAvailability(explicitFalse)).toEqual({
			reason: "The current debug adapter does not support disassembly.",
		});
	});

	it("returns the stopped threadId with no reason once stopped and supported", () => {
		const state = stateFixture({
			stoppedThreadId: 4,
			capabilities: { supportsDisassembleRequest: true },
		});
		expect(disassemblySessionAvailability(state)).toEqual({
			reason: undefined,
			threadId: 4,
		});
	});
});

describe("nextDisassemblyOffset", () => {
	it("moves one window before the anchor for 'up'", () => {
		expect(nextDisassemblyOffset(0, "up")).toBe(-DISASSEMBLY_WINDOW_SIZE);
		expect(nextDisassemblyOffset(-100, "up")).toBe(-200);
	});

	it("moves one window after the anchor for 'down'", () => {
		expect(nextDisassemblyOffset(0, "down")).toBe(DISASSEMBLY_WINDOW_SIZE);
		expect(nextDisassemblyOffset(100, "down")).toBe(200);
	});
});

describe("isCurrentInstructionRow", () => {
	it("is true only for the row whose absolute offset is exactly zero", () => {
		expect(isCurrentInstructionRow(0, 0)).toBe(true);
		expect(isCurrentInstructionRow(0, 1)).toBe(false);
		expect(isCurrentInstructionRow(-50, 50)).toBe(true);
		expect(isCurrentInstructionRow(-50, 49)).toBe(false);
		expect(isCurrentInstructionRow(100, 0)).toBe(false);
	});
});
