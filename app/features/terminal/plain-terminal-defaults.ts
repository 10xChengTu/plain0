/**
 * `F190` S2 "future-tab defaults UI": the configuration keys, the pure
 * front-end cwd validity state machine, and the frozen-per-tab defaults
 * shape `PlainTerminalView`/`TerminalTabsModel`/`TerminalPaneController`
 * share. Deliberately DOM/IPC/monaco-free — like `plain-terminal-tabs.ts`
 * and `plain-terminal-scroll.ts` — so it stays trivially unit-testable
 * without a Workbench fixture; `PlainTerminalView` is the only caller that
 * ever touches `IConfigurationService` itself.
 *
 * # Front-end validation is feedback only, never authority
 *
 * `docs/research/2026-08-03-complete-terminal.md`'s "架构裁定 §1" is explicit:
 * cwd containment is re-verified inside the already-selected root by Rust's
 * own `terminal::service::resolve_cwd` (canonicalize + `starts_with` —
 * see that function's doc comment in `src-tauri/src/terminal/service.rs`).
 * {@link validateFutureTabCwdInput} exists purely to give the settings UI
 * immediate, in-browser feedback (and to avoid an obviously-doomed
 * `terminal_start` round trip for a plainly-malformed default), and
 * deliberately mirrors — rather than replaces — the same shape of rejection
 * `terminal-codec.ts`'s `frozenCwd` already enforces at the wire boundary:
 * no absolute path, no embedded NUL, no oversized string. It additionally
 * rejects any literal `..` path segment — *stricter* than Rust's own
 * canonicalize-then-`starts_with` check (which would actually accept a `..`
 * segment that still resolves back inside the root, e.g. `foo/../foo`).
 * A plain string validator with no live filesystem to canonicalize against
 * cannot tell whether a given `..` usage stays inside the root or not, so
 * refusing all of them up front is the conservative, honest choice for
 * "immediate feedback" — never a claim that Rust would reject the exact
 * same string.
 */

/** Registered by `terminal-contribution.ts`'s `registerConfiguration` call
 * and read/written by `PlainTerminalView` through the ordinary
 * `IConfigurationService` — the same `settings.json`-backed
 * `IConfigurationService` `F170` S1 wired up (see
 * `app/features/preferences/user-data-file-system-provider.ts`), not a new
 * persistence channel. */
export const TERMINAL_DEFAULT_PROFILE_CONFIG_KEY =
	"plain.terminal.defaultProfile";
export const TERMINAL_DEFAULT_CWD_CONFIG_KEY = "plain.terminal.cwd";

/** Mirrors `src-tauri/src/terminal/shell.rs`'s `SYSTEM_DEFAULT_PROFILE_ID` —
 * the one profile id guaranteed to exist in every `terminal_profiles`
 * snapshot (see that module's doc comment). Used as the configuration
 * schema's default value and as this module's own safe fallback whenever a
 * configured profile id is missing or not a string (e.g. before the
 * `terminal_profiles` round trip has completed, or a hand-edited
 * `settings.json`). */
export const TERMINAL_DEFAULT_PROFILE_FALLBACK_ID = "systemDefault";

/** Mirrors `terminal-codec.ts`'s `MAX_TERMINAL_CWD_BYTES`. This validator
 * runs on a JS string (UTF-16 length, not UTF-8 bytes) rather than the wire
 * codec's exact byte count, but the same round number is more than generous
 * for any real workspace-relative path — keeping the two bounds visibly
 * related is more useful here than picking an unrelated number. */
const MAX_FUTURE_TAB_CWD_LENGTH = 4_096;

export type TerminalCwdInputState =
	| { readonly kind: "valid"; readonly cwd: string | null }
	| { readonly kind: "invalid"; readonly reason: string };

function splitPathSegments(value: string): readonly string[] {
	return value.split(/[\\/]+/).filter((segment) => segment.length > 0);
}

/**
 * Validates one future-tab-default cwd candidate as the user types it (or
 * as read back from a persisted/hand-edited configuration value). Empty
 * (after trimming) or exactly `.` both mean "no override — start in the
 * selected root itself", represented as `cwd: null` — the same value
 * `TerminalStartRequest.cwd` uses for that case. Anything else must be a
 * plain, non-absolute, `..`-free relative path.
 */
export function validateFutureTabCwdInput(raw: string): TerminalCwdInputState {
	const trimmed = raw.trim();
	if (trimmed.length === 0 || trimmed === ".") {
		return Object.freeze({ kind: "valid", cwd: null });
	}
	if (trimmed.length > MAX_FUTURE_TAB_CWD_LENGTH || trimmed.includes("\0")) {
		return Object.freeze({
			kind: "invalid",
			reason: "This is not a valid working directory.",
		});
	}
	if (
		trimmed.startsWith("/") ||
		trimmed.startsWith("\\") ||
		/^[A-Za-z]:[\\/]/.test(trimmed)
	) {
		return Object.freeze({
			kind: "invalid",
			reason: "Must be relative to the workspace root, not an absolute path.",
		});
	}
	if (splitPathSegments(trimmed).some((segment) => segment === "..")) {
		return Object.freeze({
			kind: "invalid",
			reason: 'Cannot use ".." to leave the workspace root.',
		});
	}
	return Object.freeze({ kind: "valid", cwd: trimmed });
}

/**
 * One tab's frozen profile/cwd identity — computed exactly once, at
 * tab-creation (or split) time, from whatever `PlainTerminalView`'s two
 * future-tab-default controls currently hold, and never re-read afterward.
 * This is what makes "已经运行的 tab/pane 必须冻结自己的 root/profile/cwd,
 * 选择器变化不得重定向已运行会话" (`docs/research/2026-08-03-complete-terminal.md`)
 * hold: `TerminalTabsModel` stores exactly this value per tab, split
 * inherits the active tab's own copy of it, and `TerminalPaneController`
 * only ever consults the copy it was constructed with.
 *
 * `kind: "invalidCwd"` means the configured cwd default failed
 * {@link validateFutureTabCwdInput} at the moment this tab/pane was
 * created (only reachable via a hand-edited `settings.json` — the settings
 * UI itself never persists an invalid value, see `plain-terminal-view.ts`'s
 * cwd input `change` listener, which only calls `updateValue` when
 * `validateFutureTabCwdInput` reports `"valid"`). A pane built with this
 * defaults value must never call `terminal_start` at all — see
 * `TerminalPaneController`'s own doc comment — and must instead show
 * `reason` (a fixed, safe string that never interpolates the malformed
 * configured value, so it can never leak an absolute path into the UI).
 */
export type TerminalFutureTabDefaults =
	| {
			readonly kind: "ok";
			readonly profileId: string;
			readonly cwd: string | null;
	  }
	| {
			readonly kind: "invalidCwd";
			readonly profileId: string;
			readonly reason: string;
	  };

/** The defaults every terminal tab used before this slice existed —
 * `TerminalTabsModel.createTab`'s own fallback when a caller does not pass
 * an explicit `defaults` (every pre-existing call site except
 * `PlainTerminalView`'s), so this slice never has to touch every existing
 * `TerminalTabsModel`/`TerminalPaneController` test call site just to keep
 * compiling. */
export const DEFAULT_TERMINAL_FUTURE_TAB_DEFAULTS: TerminalFutureTabDefaults =
	Object.freeze({
		kind: "ok",
		profileId: TERMINAL_DEFAULT_PROFILE_FALLBACK_ID,
		cwd: null,
	});
