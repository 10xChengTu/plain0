import type { CancellationToken } from "@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation";
import type { IMarkdownString } from "@codingame/monaco-vscode-api/vscode/vs/base/common/htmlContent";
import type { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import type { Position } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/core/position";
import type {
	Hover,
	HoverProvider,
} from "@codingame/monaco-vscode-api/vscode/vs/editor/common/languages";
import type {
	IModelDeltaDecoration,
	ITextModel,
} from "@codingame/monaco-vscode-api/vscode/vs/editor/common/model";

import type {
	GitBlameCommitHeader,
	GitBlameCommitMessagesResult,
	GitBlameFileResult,
	GitBlameLineEntry,
	GitBlameLineRange,
} from "../../platform/tauri/contracts";

/**
 * `F090` S0 — inline blame decoration, hover and the age heatmap
 * (`docs/research/2026-07-26-git-history.md`'s slice 1). Self-built, never
 * consuming `@codingame/monaco-vscode-scm-service-override`'s own history
 * machinery or `ISCMProvider.historyProvider` — the same "自建视图/装饰"
 * decision the frozen research doc records (`PlainScmProvider.historyProvider`
 * stays `constObservable(undefined)`, per `F080` S2's own finding that
 * nothing reachable ever reads it). The inline-decoration mechanism itself
 * (`IModelDeltaDecoration`'s `after.content`) mirrors the *technique* Code
 * OSS's own MIT-licensed `extensions/git/src/blame.ts` uses — a public,
 * generic Monaco/VS Code decoration API, not GitLens code — see this
 * module's own report for the "never reference GitLens" boundary this
 * stays inside of.
 *
 * Every piece of logic that can be pure and unit-tested is: age-bucket
 * computation, relative-time formatting, inline-text formatting, hover
 * markdown formatting, and the per-file line index. Only
 * [`PlainGitBlameEditorController`]/[`PlainGitBlameHoverProvider`] touch a
 * live editor/model, and even those only through the narrow structural
 * interfaces declared here — mirroring `PlainScmProvider`'s own
 * narrow-interface-for-testability discipline
 * (`PlainScmProviderBridge`/`PlainScmEditorOpener`/`PlainScmModelFactory`).
 */
export interface PlainGitBlameBridge {
	gitBlameFile(
		path: string,
		range: GitBlameLineRange | null,
		rootId?: string,
	): Promise<GitBlameFileResult>;
	gitBlameCommitMessages(
		shas: readonly string[],
		rootId?: string,
	): Promise<GitBlameCommitMessagesResult>;
}

// --- age heatmap + relative time (pure) --------------------------------------

/** Six fixed buckets (`--plain-git-blame-age-0`..`-5` in `app/styles.css`),
 * warm (bucket `0`, most recently touched) to cool (bucket `5`, oldest) —
 * see this feature's own CSS section for why a small fixed palette was
 * chosen over an unbounded set of dynamically interpolated inline colors. */
export const DEFAULT_BLAME_AGE_BUCKET_COUNT = 6;

/**
 * Maps `commitUnixSeconds` to a `0`..`bucketCount - 1` bucket index, relative
 * to the file's own oldest/newest commit times currently visible in a blame
 * response — a *relative* heatmap (this file's own age spread), not an
 * absolute calendar-age scale, matching the interactive convention the
 * frozen research doc cites as a design *reference* (never GitLens's actual
 * palette values or code — see this module's own doc comment). Bucket `0`
 * (warmest) is always returned when every line shares the same commit time
 * (a brand-new file, or `newestUnixSeconds <= oldestUnixSeconds` for any
 * other reason) — there is no meaningful spread to bucket.
 */
export function blameAgeBucketIndex(
	commitUnixSeconds: number,
	oldestUnixSeconds: number,
	newestUnixSeconds: number,
	bucketCount: number = DEFAULT_BLAME_AGE_BUCKET_COUNT,
): number {
	if (bucketCount <= 1) {
		return 0;
	}
	if (newestUnixSeconds <= oldestUnixSeconds) {
		return 0;
	}
	const clamped = Math.min(
		Math.max(commitUnixSeconds, oldestUnixSeconds),
		newestUnixSeconds,
	);
	const fraction =
		(newestUnixSeconds - clamped) / (newestUnixSeconds - oldestUnixSeconds);
	const bucket = Math.floor(fraction * bucketCount);
	return Math.min(Math.max(bucket, 0), bucketCount - 1);
}

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * 60;
const SECONDS_PER_DAY = SECONDS_PER_HOUR * 24;
const SECONDS_PER_WEEK = SECONDS_PER_DAY * 7;
/** Average Gregorian month (`365.25 / 12` days) — good enough for a
 * "N months ago" label, not used for anything exact. */
const SECONDS_PER_MONTH = Math.round(SECONDS_PER_DAY * 30.44);
const SECONDS_PER_YEAR = Math.round(SECONDS_PER_DAY * 365.25);

/** Formats `unixSeconds` (a commit's `authorTime`) relative to `nowMs`, e.g.
 * `"3 days ago"`. A commit time at or after `nowMs` (clock skew, or the
 * caller passing a stale `nowMs`) is floored to `0` seconds elapsed rather
 * than reporting a negative/nonsensical duration. */
export function formatRelativeTime(unixSeconds: number, nowMs: number): string {
	const deltaSeconds = Math.max(0, Math.floor(nowMs / 1000) - unixSeconds);
	if (deltaSeconds < SECONDS_PER_MINUTE) {
		return "just now";
	}
	if (deltaSeconds < SECONDS_PER_HOUR) {
		return pluralAgo(Math.floor(deltaSeconds / SECONDS_PER_MINUTE), "minute");
	}
	if (deltaSeconds < SECONDS_PER_DAY) {
		return pluralAgo(Math.floor(deltaSeconds / SECONDS_PER_HOUR), "hour");
	}
	if (deltaSeconds < SECONDS_PER_WEEK) {
		return pluralAgo(Math.floor(deltaSeconds / SECONDS_PER_DAY), "day");
	}
	if (deltaSeconds < SECONDS_PER_MONTH) {
		return pluralAgo(Math.floor(deltaSeconds / SECONDS_PER_WEEK), "week");
	}
	if (deltaSeconds < SECONDS_PER_YEAR) {
		return pluralAgo(Math.floor(deltaSeconds / SECONDS_PER_MONTH), "month");
	}
	return pluralAgo(Math.floor(deltaSeconds / SECONDS_PER_YEAR), "year");
}

function pluralAgo(count: number, unit: string): string {
	return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

/** The short line of text `IModelDeltaDecoration.after.content` injects
 * after a line — e.g. `"Author Name, 3 days ago • fix off-by-one"`. */
export function formatInlineBlameText(
	header: GitBlameCommitHeader,
	isUncommitted: boolean,
	nowMs: number,
): string {
	if (isUncommitted) {
		return "Uncommitted changes";
	}
	const author =
		header.author.trim().length > 0 ? header.author.trim() : "Unknown";
	const relative = formatRelativeTime(header.authorTime, nowMs);
	const summary = header.summary.trim();
	return summary.length > 0
		? `${author}, ${relative} • ${summary}`
		: `${author}, ${relative}`;
}

/** The hover tooltip's full markdown body — `fullBody` is the batch
 * `gitBlameCommitMessages` result for this line's commit (`undefined` when
 * not yet fetched, or when the line `isUncommitted` and there is no commit
 * to fetch a body for at all). Falls back to `header.summary` alone when
 * `fullBody` is unavailable, so a hover is never empty while a background
 * fetch is still in flight. */
export function formatBlameHoverMarkdown(
	entry: GitBlameLineEntry,
	header: GitBlameCommitHeader,
	fullBody: string | undefined,
	nowMs: number,
): string {
	if (entry.isUncommitted) {
		return "**Uncommitted changes**\n\nThis line has not been committed yet.";
	}
	const author =
		header.author.trim().length > 0 ? header.author.trim() : "Unknown";
	const relative = formatRelativeTime(header.authorTime, nowMs);
	const shortSha = entry.commitSha.slice(0, 7);
	const body = fullBody?.trim();
	const message =
		body !== undefined && body.length > 0 ? body : header.summary.trim();
	return `**${author}** · ${relative}\n\n\`${shortSha}\`\n\n${message}`;
}

// --- per-file blame index (pure state, no editor/model dependency) ---------

interface PlainGitBlameLineLookup {
	readonly entry: GitBlameLineEntry;
	readonly header: GitBlameCommitHeader | undefined;
}

/** Holds one `gitBlameFile` response and the derived per-line/age-range
 * lookups both the decoration builder and the hover provider need — a plain
 * data structure with no editor/model dependency of its own, so it can be
 * unit-tested (and reused across a decoration refresh and a hover request)
 * without any Monaco object in play. */
export class PlainGitBlameFileIndex {
	#result: GitBlameFileResult = Object.freeze({ entries: [], commits: {} });
	#rootId: string | undefined;
	#byFinalLine = new Map<number, GitBlameLineEntry>();
	#oldestAuthorTime = 0;
	#newestAuthorTime = 0;

	setResult(result: GitBlameFileResult, rootId?: string): void {
		this.#result = result;
		this.#rootId = rootId;
		this.#byFinalLine = new Map(
			result.entries.map((entry) => [entry.finalLine, entry]),
		);
		let oldest = Number.POSITIVE_INFINITY;
		let newest = Number.NEGATIVE_INFINITY;
		for (const header of Object.values(result.commits)) {
			oldest = Math.min(oldest, header.authorTime);
			newest = Math.max(newest, header.authorTime);
		}
		this.#oldestAuthorTime = Number.isFinite(oldest) ? oldest : 0;
		this.#newestAuthorTime = Number.isFinite(newest) ? newest : 0;
	}

	get result(): GitBlameFileResult {
		return this.#result;
	}

	get rootId(): string | undefined {
		return this.#rootId;
	}

	lineLookup(lineNumber: number): PlainGitBlameLineLookup | undefined {
		const entry = this.#byFinalLine.get(lineNumber);
		if (entry === undefined) {
			return undefined;
		}
		return { entry, header: this.#result.commits[entry.commitSha] };
	}

	ageBucket(
		lineNumber: number,
		bucketCount: number = DEFAULT_BLAME_AGE_BUCKET_COUNT,
	): number | undefined {
		const lookup = this.lineLookup(lineNumber);
		if (lookup?.header === undefined) {
			return undefined;
		}
		return blameAgeBucketIndex(
			lookup.header.authorTime,
			this.#oldestAuthorTime,
			this.#newestAuthorTime,
			bucketCount,
		);
	}
}

// --- decoration building (pure) ---------------------------------------------

/** `description` is required by `IModelDecorationOptions` (an internal
 * debug label, never user-visible) — a single fixed string identifies every
 * decoration this feature ever creates. */
const BLAME_DECORATION_DESCRIPTION = "plain-git-blame-inline";

/** Builds one `after`-injected-text decoration per line the index has an
 * entry for, up to `totalLines` (the model's current line count — a stale
 * index from before an edit may otherwise reference a line number beyond
 * the model's current length). Colored via a fixed CSS class
 * (`plain-git-blame-age-<bucket>`, see `app/styles.css`) rather than an
 * inline `style` attribute — keeps the actual color values in one
 * auditable, themeable place instead of scattered across decoration
 * objects.
 */
export function buildBlameDecorations(
	index: PlainGitBlameFileIndex,
	totalLines: number,
	nowMs: number,
	bucketCount: number = DEFAULT_BLAME_AGE_BUCKET_COUNT,
): IModelDeltaDecoration[] {
	const decorations: IModelDeltaDecoration[] = [];
	for (let line = 1; line <= totalLines; line += 1) {
		const lookup = index.lineLookup(line);
		if (lookup?.header === undefined) {
			continue;
		}
		const { entry, header } = lookup;
		const bucket = index.ageBucket(line, bucketCount) ?? 0;
		decorations.push({
			range: {
				startLineNumber: line,
				startColumn: Number.MAX_SAFE_INTEGER,
				endLineNumber: line,
				endColumn: Number.MAX_SAFE_INTEGER,
			},
			options: {
				description: BLAME_DECORATION_DESCRIPTION,
				// This decoration's own range is always zero-width by
				// construction (`Position(line, MAX_SAFE_INTEGER)` clamps both
				// ends to the same real end-of-line column) — `ITextModel`'s
				// injected-text query (`getInjectedTextInInterval`, consulted by
				// the view on every render) unconditionally drops any decoration
				// whose range `isEmpty()` *unless* `showIfCollapsed` is set, even
				// when it carries a real `after`/`before` payload. Omitting this
				// left the inline blame decoration silently invisible in the
				// real DOM despite `ITextModel.deltaDecorations` reporting a
				// successful, well-formed decoration id — this feature's own
				// first-ever Browser E2E coverage (`F090` S6) is what caught it;
				// no unit test exercises a real `ITextModel`, so this went
				// unnoticed since `F090` S0.
				showIfCollapsed: true,
				after: {
					content: `  ${formatInlineBlameText(header, entry.isUncommitted, nowMs)}`,
					inlineClassName: `plain-git-blame-inline plain-git-blame-age-${bucket}`,
				},
			},
		});
	}
	return decorations;
}

// --- editor attachment (the one piece that touches a live editor) ----------

/** Only the one method of `URI` this feature ever calls — deliberately not
 * the real `URI` class type here (unlike [`PlainGitBlameHoverProvider`],
 * which must accept the real `ITextModel`/`Position` its `HoverProvider`
 * contract mandates): this interface is the one a hand-written fake editor
 * satisfies in a unit test with no Workbench object in play at all. A real
 * `URI` already has `toString()`, so it satisfies this structurally with no
 * adapter needed. */
export interface PlainGitBlameUriLike {
	toString(): string;
}

/** Structural subset of `ICodeEditor` this controller needs — kept narrow
 * for the same unit-testability reason as `PlainScmProvider`'s own bridge
 * interfaces (a fake satisfying this needs no DOM and no Workbench
 * bootstrap). The real `ICodeEditor` (`@codingame/monaco-vscode-api/vscode/
 * vs/editor/browser/editorBrowser`) already structurally satisfies this. */
export interface PlainGitBlameEditorLike {
	getModel(): {
		readonly uri: PlainGitBlameUriLike;
		getLineCount(): number;
	} | null;
	deltaDecorations(
		oldDecorationIds: readonly string[],
		newDecorations: readonly IModelDeltaDecoration[],
	): string[];
}

/**
 * Fetches whole-file blame for `relativePath` and applies inline decorations
 * to `editor` — one instance per attached editor. Always whole-file (no `-L`
 * viewport scoping): the Rust side's `-L` support (`F090` S0's own
 * `blame::BlameLineRange`) is implemented and tested, but wiring a
 * scroll-viewport-driven incremental fetch (decision 4's "更谨慎处理") is a
 * disclosed, deliberate scope cut for this slice — see this feature's own
 * report. `refresh` is safe to call repeatedly (e.g. on every
 * `onDidChangeModelContent`, debounced by the caller): each call replaces
 * this instance's own previously-applied decoration set via
 * `deltaDecorations`'s own "replace by id list" contract, never
 * accumulating stale decorations. `refresh`'s returned promise never
 * rejects — a `gitBlameFile` failure (untrusted workspace, no repository,
 * a path outside one) is caught and treated as "nothing to decorate", the
 * same best-effort discipline `PlainScmResource.open`'s own doc comment
 * establishes for this codebase's other passive, non-user-initiated calls;
 * a caller invoking this from a fire-and-forget `void controller.refresh(…)`
 * (as the real contribution wiring does, debounced on every keystroke) must
 * never risk an unhandled rejection.
 */
export class PlainGitBlameEditorController {
	#decorationIds: readonly string[] = [];
	readonly #index = new PlainGitBlameFileIndex();
	#modelKey: string | undefined;
	#refreshGeneration = 0;

	constructor(
		private readonly bridge: PlainGitBlameBridge,
		private readonly now: () => number = () => Date.now(),
	) {}

	get index(): PlainGitBlameFileIndex {
		return this.#index;
	}

	async refresh(
		editor: PlainGitBlameEditorLike,
		relativePath: string,
		rootId?: string,
	): Promise<void> {
		const model = editor.getModel();
		if (model === null) {
			return;
		}
		const modelKey = model.uri.toString();
		const generation = ++this.#refreshGeneration;
		if (this.#modelKey !== modelKey || this.#index.rootId !== rootId) {
			if (this.#decorationIds.length > 0) {
				this.#decorationIds = editor.deltaDecorations(this.#decorationIds, []);
			}
			this.#index.setResult(
				Object.freeze({ entries: [], commits: {} }),
				rootId,
			);
			this.#modelKey = modelKey;
		}
		let result: GitBlameFileResult;
		try {
			result =
				rootId === undefined
					? await this.bridge.gitBlameFile(relativePath, null)
					: await this.bridge.gitBlameFile(relativePath, null, rootId);
		} catch {
			// Best-effort, exactly like `PlainScmResource.open`'s identical
			// rationale: an untrusted workspace, a path outside any repository,
			// a workspace that stopped being a Git repository between edits, or
			// (in a test harness without a real git fixture wired up for this
			// call) an unrecognized command are all inert, non-actionable
			// outcomes from this decoration's own passive, non-user-initiated
			// perspective — never an unhandled rejection, and never a thrown
			// error that would otherwise surface as a page-level exception
			// for what the user experiences as "this file just has no blame
			// annotations".
			return;
		}
		const currentModel = editor.getModel();
		if (
			generation !== this.#refreshGeneration ||
			currentModel === null ||
			currentModel.uri.toString() !== modelKey
		) {
			// The editor's model changed while the fetch above was in flight
			// (e.g. the user switched files) — applying a now-stale file's
			// decorations to whatever model is current would be actively
			// wrong, not just outdated, so this refresh is simply abandoned.
			return;
		}
		this.#index.setResult(result, rootId);
		const decorations = buildBlameDecorations(
			this.#index,
			currentModel.getLineCount(),
			this.now(),
		);
		this.#decorationIds = editor.deltaDecorations(
			this.#decorationIds,
			decorations,
		);
	}

	clear(editor: PlainGitBlameEditorLike): void {
		this.#refreshGeneration += 1;
		this.#modelKey = undefined;
		this.#index.setResult(Object.freeze({ entries: [], commits: {} }));
		this.#decorationIds = editor.deltaDecorations(this.#decorationIds, []);
	}
}

// --- hover provider ----------------------------------------------------------

/**
 * `HoverProvider` implementation — registered globally (selector `"*"`) by
 * this feature's contribution wiring against `ILanguageFeaturesService.
 * hoverProvider`, and internally no-ops (`undefined`) for any model this
 * feature is not currently tracking blame for (looked up via
 * `indexForModel`), so one registration serves every open editor rather
 * than a per-editor register/dispose churn.
 */
export class PlainGitBlameHoverProvider implements HoverProvider {
	constructor(
		private readonly indexForModel: (
			uri: URI,
		) => PlainGitBlameFileIndex | undefined,
		private readonly bridge: PlainGitBlameBridge,
		private readonly now: () => number = () => Date.now(),
	) {}

	async provideHover(
		model: ITextModel,
		position: Position,
		_token: CancellationToken,
	): Promise<Hover | undefined> {
		const index = this.indexForModel(model.uri);
		if (index === undefined) {
			return undefined;
		}
		const lookup = index.lineLookup(position.lineNumber);
		if (lookup?.header === undefined) {
			return undefined;
		}
		const { entry, header } = lookup;
		let fullBody: string | undefined;
		if (!entry.isUncommitted) {
			try {
				const shas = [entry.commitSha];
				const messages =
					index.rootId === undefined
						? await this.bridge.gitBlameCommitMessages(shas)
						: await this.bridge.gitBlameCommitMessages(shas, index.rootId);
				fullBody = messages.messages[entry.commitSha];
			} catch {
				// A failed batch fetch (e.g. the workspace lost trust between
				// the decoration refresh and this hover) just falls back to
				// `header.summary` alone via `formatBlameHoverMarkdown`'s own
				// `fullBody === undefined` branch — never surfaces as a
				// broken/error hover for what is, from the user's
				// perspective, an inert tooltip.
			}
		}
		const value = formatBlameHoverMarkdown(entry, header, fullBody, this.now());
		const contents: IMarkdownString[] = [{ value }];
		return {
			contents,
			range: {
				startLineNumber: position.lineNumber,
				startColumn: 1,
				endLineNumber: position.lineNumber,
				endColumn: Number.MAX_SAFE_INTEGER,
			},
		};
	}
}
