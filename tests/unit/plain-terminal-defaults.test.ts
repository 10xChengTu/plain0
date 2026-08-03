import { describe, expect, it } from "vitest";

import {
	DEFAULT_TERMINAL_FUTURE_TAB_DEFAULTS,
	TERMINAL_DEFAULT_CWD_CONFIG_KEY,
	TERMINAL_DEFAULT_PROFILE_CONFIG_KEY,
	TERMINAL_DEFAULT_PROFILE_FALLBACK_ID,
	validateFutureTabCwdInput,
} from "../../app/features/terminal/plain-terminal-defaults";

describe("validateFutureTabCwdInput", () => {
	it('treats an empty string as valid, meaning "use the root itself"', () => {
		expect(validateFutureTabCwdInput("")).toEqual({
			kind: "valid",
			cwd: null,
		});
	});

	it("treats whitespace-only input the same as empty", () => {
		expect(validateFutureTabCwdInput("   ")).toEqual({
			kind: "valid",
			cwd: null,
		});
	});

	it('treats exactly "." as valid, meaning "use the root itself"', () => {
		expect(validateFutureTabCwdInput(".")).toEqual({
			kind: "valid",
			cwd: null,
		});
	});

	it("accepts a plain workspace-relative path", () => {
		expect(validateFutureTabCwdInput("nested/project")).toEqual({
			kind: "valid",
			cwd: "nested/project",
		});
	});

	it("trims surrounding whitespace off an otherwise-valid path", () => {
		expect(validateFutureTabCwdInput("  nested/project  ")).toEqual({
			kind: "valid",
			cwd: "nested/project",
		});
	});

	it("rejects a Unix absolute path", () => {
		const result = validateFutureTabCwdInput("/etc/passwd");
		expect(result.kind).toBe("invalid");
	});

	it("rejects a leading-backslash absolute path", () => {
		const result = validateFutureTabCwdInput("\\Windows\\System32");
		expect(result.kind).toBe("invalid");
	});

	it("rejects a Windows drive-letter absolute path", () => {
		const result = validateFutureTabCwdInput("C:\\Windows\\System32");
		expect(result.kind).toBe("invalid");
	});

	it("rejects a Windows drive-letter absolute path using forward slashes", () => {
		const result = validateFutureTabCwdInput("C:/Windows/System32");
		expect(result.kind).toBe("invalid");
	});

	it('rejects a leading ".." traversal segment', () => {
		const result = validateFutureTabCwdInput("../outside");
		expect(result.kind).toBe("invalid");
	});

	it('rejects a ".." segment anywhere in the middle of the path', () => {
		const result = validateFutureTabCwdInput("nested/../escape");
		expect(result.kind).toBe("invalid");
	});

	it('rejects a bare ".."', () => {
		const result = validateFutureTabCwdInput("..");
		expect(result.kind).toBe("invalid");
	});

	it("rejects an embedded NUL byte", () => {
		const result = validateFutureTabCwdInput("nested\0project");
		expect(result.kind).toBe("invalid");
	});

	it("rejects an oversized path", () => {
		const result = validateFutureTabCwdInput("a".repeat(5_000));
		expect(result.kind).toBe("invalid");
	});

	it("never interpolates the malformed raw value into the rejection reason (no absolute-path leak)", () => {
		const secret = "/Users/someone/very-secret-directory-name";
		const result = validateFutureTabCwdInput(secret);
		expect(result.kind).toBe("invalid");
		if (result.kind === "invalid") {
			expect(result.reason).not.toContain(secret);
			expect(result.reason).not.toContain("/Users");
		}
	});

	it('accepts a name that merely contains ".." as a substring, not a path segment', () => {
		// "..foo" is one path segment, not the traversal token "..".
		expect(validateFutureTabCwdInput("..foo")).toEqual({
			kind: "valid",
			cwd: "..foo",
		});
	});
});

describe("DEFAULT_TERMINAL_FUTURE_TAB_DEFAULTS", () => {
	it("is the systemDefault profile starting in the root itself", () => {
		expect(DEFAULT_TERMINAL_FUTURE_TAB_DEFAULTS).toEqual({
			kind: "ok",
			profileId: TERMINAL_DEFAULT_PROFILE_FALLBACK_ID,
			cwd: null,
		});
	});

	it("is frozen (cannot be mutated by a careless caller)", () => {
		expect(Object.isFrozen(DEFAULT_TERMINAL_FUTURE_TAB_DEFAULTS)).toBe(true);
	});
});

describe("configuration key constants", () => {
	it("are namespaced under plain.terminal.*", () => {
		expect(TERMINAL_DEFAULT_PROFILE_CONFIG_KEY).toBe(
			"plain.terminal.defaultProfile",
		);
		expect(TERMINAL_DEFAULT_CWD_CONFIG_KEY).toBe("plain.terminal.cwd");
	});
});
