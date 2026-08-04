/**
 * `F200` S1: two small, dependency-free pure functions extracted out of
 * `plain-search-view.ts` specifically so they are vitest-unit-testable.
 * `plain-search-view.ts` imports `@codingame/monaco-vscode-api/vscode/vs/
 * base/browser/dom` (for `addDisposableListener`), which reads the global
 * `window` at module-import time — fine inside the real Chromium/WKWebView
 * this app actually runs in (and inside `tests/browser/*.spec.ts`'s real
 * browser), but fatal to `import` from a plain Node `vitest` unit test (this
 * repository's `vitest.config.ts` pins `environment: "node"` and has no
 * `jsdom` dependency — DOM-heavy views are deliberately Browser-E2E-only
 * coverage, not vitest coverage). Neither function below imports anything
 * DOM- or Monaco-shaped, so this module stays importable from a plain Node
 * test (see `tests/unit/plain-search-view-toggles.test.ts`).
 */

/**
 * Flips a toggle button's boolean on/off state from its current
 * `aria-pressed` attribute value. `plain-search-view.ts`'s case-sensitivity
 * and whole-word toggle click handlers (and the terminal find widget's own,
 * textually identical `Aa` toggle — see `plain-terminal-pane.ts`'s
 * `#buildFindWidget`) call this so "on" (`"true"`) versus every other value
 * (`"false"`, `null` before the attribute is ever set) has a single,
 * unit-tested definition rather than each call site re-deriving it inline.
 */
export function toggleAriaPressed(current: string | null): boolean {
	return current !== "true";
}

/**
 * The pure pattern → `ITextQuery["contentPattern"]` mapping
 * `plain-search-view.ts`'s three toolbar toggles (regex/case/word) feed into
 * `ISearchService.textSearch`. This is the one place a toggle's on-screen
 * state turns into the wire-visible `isCaseSensitive`/`isWordMatch` request
 * fields `PlainSearchResultProvider.textSearch` (`plain-search-service.ts`)
 * reads. All three toggles default to `false` here exactly as their buttons
 * default to `aria-pressed="false"` in `renderBody`, so a caller that never
 * touches any toggle reproduces the pre-F200 request body byte-for-byte
 * (`{ pattern, isRegExp }` with the two new fields implicitly `false`) — the
 * "开关默认关闭时行为与现状完全一致" regression contract.
 */
export function buildSearchContentPattern(
	pattern: string,
	toggles: {
		readonly isRegExp: boolean;
		readonly isCaseSensitive: boolean;
		readonly isWordMatch: boolean;
	},
): {
	pattern: string;
	isRegExp: boolean;
	isCaseSensitive: boolean;
	isWordMatch: boolean;
} {
	return {
		pattern,
		isRegExp: toggles.isRegExp,
		isCaseSensitive: toggles.isCaseSensitive,
		isWordMatch: toggles.isWordMatch,
	};
}
