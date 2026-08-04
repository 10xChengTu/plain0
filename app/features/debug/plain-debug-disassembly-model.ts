/**
 * `F210` S5 — pure availability/windowing logic for the read-only
 * disassembly view (`plain-debug-disassembly-view.ts`). Kept dependency-free
 * (no DOM/monaco import) so it is directly vitest-testable, mirroring
 * `plain-debug-step-in-target-pick.ts`'s own "pure logic, no DOM/monaco
 * dependency" precedent.
 *
 * `disassemblySessionAvailability` implements the S5 contract's own "仅在
 * stopped 且 supportsDisassembleRequest 时...填充；非 stopped/能力缺失...时
 * 给出准确占位文案" gate — checked in the order a user would naturally reason
 * about it (is there even a session → is it stopped → does the adapter
 * support this request at all). The fourth contract case ("无
 * instructionPointerReference") is deliberately not modeled here: unlike the
 * first three, which are knowable from `DebugSessionState` alone with zero
 * IPC, whether the current stopped (top) frame actually reports an
 * `instructionPointerReference` can only be learned from a real
 * `debugStackTrace` response — see `plain-debug-disassembly-view.ts`'s own
 * `#refreshAnchor` for that async half of the same gate, and
 * `DISASSEMBLY_NO_INSTRUCTION_POINTER_MESSAGE` for its exact placeholder
 * text.
 */

import type { DebugSessionState } from "./plain-debug-session";

/** Fixed request window, in instructions — `docs/research/2026-08-04-complete-debug.md`'s
 * own "架构裁定 §5" caps a single `disassemble` request at 200 instructions
 * (`src-tauri/src/debug/dto.rs`'s own
 * `MAX_DEBUG_DISASSEMBLE_INSTRUCTION_COUNT`); this view requests a window
 * comfortably under that cap so both the initial load and every Up/Down page
 * stay a single, bounded request. */
export const DISASSEMBLY_WINDOW_SIZE = 100;

/** The exact placeholder text shown when the current stopped (top) frame
 * reports no `instructionPointerReference` at all — the one S5 contract
 * placeholder case this module cannot decide on its own (see the module doc
 * comment). */
export const DISASSEMBLY_NO_INSTRUCTION_POINTER_MESSAGE =
	"No instruction pointer is available for the current frame.";

export type DisassemblyPageDirection = "up" | "down";

export type DisassemblySessionAvailability =
	| { readonly reason: string }
	| { readonly reason: undefined; readonly threadId: number };

/** Whether the disassembly view can populate from `state` alone, with zero
 * IPC — `reason` is the exact placeholder text to show when it cannot;
 * `threadId` (only present when `reason` is `undefined`) is the stopped
 * thread a caller should next fetch the top frame's own
 * `instructionPointerReference` for. */
export function disassemblySessionAvailability(
	state: DebugSessionState | null,
): DisassemblySessionAvailability {
	if (state === null) {
		return { reason: "Not debugging." };
	}
	if (state.stoppedThreadId === null) {
		return { reason: "Running…" };
	}
	if (state.capabilities.supportsDisassembleRequest !== true) {
		return {
			reason: "The current debug adapter does not support disassembly.",
		};
	}
	return { reason: undefined, threadId: state.stoppedThreadId };
}

/** The next request's `instructionOffset`, given the currently loaded
 * window's own base offset — Up moves one window further *before* the
 * anchor (a more negative offset), Down moves one window further *after* it,
 * per the S5 contract's own "以当前锚为基准 instructionOffset ± 窗口". */
export function nextDisassemblyOffset(
	currentBaseOffset: number,
	direction: DisassemblyPageDirection,
): number {
	return direction === "up"
		? currentBaseOffset - DISASSEMBLY_WINDOW_SIZE
		: currentBaseOffset + DISASSEMBLY_WINDOW_SIZE;
}

/** `true` for the one row (if any) in the currently loaded window whose
 * absolute instruction offset — `baseOffset + index` — is exactly `0`, DAP's
 * own anchor instruction (the stopped frame's real program counter). Relies
 * on `src-tauri/src/debug/dto.rs`'s own `parse_disassemble_response`
 * rejecting a response reporting more instructions than requested (never
 * silently reindexing), so `index` always names the same offset the adapter
 * was actually asked for. */
export function isCurrentInstructionRow(
	baseOffset: number,
	index: number,
): boolean {
	return baseOffset + index === 0;
}
