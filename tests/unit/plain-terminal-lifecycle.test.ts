import { describe, expect, it } from "vitest";

import {
	formatTerminalExitStatus,
	formatTerminalNonRestorableNotice,
} from "../../app/features/terminal/plain-terminal-lifecycle";

describe("formatTerminalExitStatus", () => {
	it("describes a normal exit by its real exit code", () => {
		expect(formatTerminalExitStatus(0, null)).toBe(
			"The shell process exited with code 0. This session has ended and cannot be resumed — close this pane when you are done with it.",
		);
		expect(formatTerminalExitStatus(130, null)).toContain(
			"exited with code 130",
		);
	});

	/** `F190` S6: `exitCode` alone is misleading for a signal-terminated
	 * process (`portable_pty::ExitStatus::exit_code()` is hardcoded to `1`
	 * whenever `signal` is set — see `TerminalExitEvent.signal`'s own doc
	 * comment) — the banner must lead with the real signal, not the
	 * meaningless placeholder code. */
	it("describes a signal-terminated exit by its real signal, not the placeholder exit code", () => {
		const message = formatTerminalExitStatus(1, "Killed: 9");
		expect(message).toContain("was terminated (Killed: 9)");
		expect(message).not.toContain("exited with code");
	});

	it("never mentions a filesystem path", () => {
		for (const message of [
			formatTerminalExitStatus(0, null),
			formatTerminalExitStatus(1, "Killed: 9"),
			formatTerminalExitStatus(255, "Segmentation fault"),
		]) {
			expect(message).not.toMatch(/[/\\]/);
		}
	});
});

describe("formatTerminalNonRestorableNotice", () => {
	it("uses singular wording for exactly one session", () => {
		expect(formatTerminalNonRestorableNotice(1)).toBe(
			"1 previous terminal session ended without being explicitly closed and could not be restored.",
		);
	});

	it("uses plural wording for more than one session", () => {
		expect(formatTerminalNonRestorableNotice(3)).toBe(
			"3 previous terminal sessions ended without being explicitly closed and could not be restored.",
		);
	});

	it("never mentions a filesystem path", () => {
		expect(formatTerminalNonRestorableNotice(1)).not.toMatch(/[/\\]/);
		expect(formatTerminalNonRestorableNotice(7)).not.toMatch(/[/\\]/);
	});
});
