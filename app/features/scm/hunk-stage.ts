import { linesDiffComputers } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/diff/linesDiffComputers";

/**
 * `F080` S3 hunk-level stage: computes "the file's complete content after
 * applying one selected hunk" using Monaco's own diff engine — the exact
 * architecture `docs/research/2026-07-25-core-git.md` documents upstream
 * (`extensions/git`) using, and that `src-tauri/src/git/stage.rs`'s
 * `stage_blob` (`hash-object` + `update-index`) is built to consume: this
 * module never parses or applies a unified-diff patch itself, it only ever
 * asks Monaco's real line-diff algorithm "what changed between these two
 * versions" and copies one changed range across.
 *
 * This slice's own front-end path (see `plain-scm-commands.ts`'s
 * `plain.scm.stageActiveFileFirstHunk`) always diffs the **index** version
 * against the **working-tree** (on-disk) version — matching real
 * `git add -p`'s own quick-diff semantics (staging is always relative to
 * what is currently in the index, not `HEAD`) — and always targets hunk
 * index `0` (the first changed range). Selecting an arbitrary hunk from a
 * gutter click is real Workbench UI (`IQuickDiffService` gutter decorations)
 * this slice does not build; see that command's own module doc comment for
 * the full, explicitly-recorded scope note.
 */

const MAX_HUNK_STAGE_DIFF_TIME_MS = 5_000;

/** Splits text into lines the same way `ITextModel.getLinesContent()` would
 * (no trailing empty element for a final trailing newline is handled by the
 * caller reassembling with `"\n"`, matching how `linesDiffComputers.getDefault()`
 * itself expects `string[]` input with no line terminators baked in). */
function splitLines(text: string): string[] {
	return text.split("\n");
}

/**
 * Computes "apply the `hunkIndex`-th changed line range from `originalText`
 * to `modifiedText`, onto `originalText`" — i.e. the full file content that
 * results from staging *only* that one hunk. Returns `undefined` when there
 * is no such hunk (fewer than `hunkIndex + 1` changed ranges — including the
 * common "the file has no changes at all" case, which is not an error, just
 * nothing to stage).
 */
export function computeContentAfterApplyingHunk(
	originalText: string,
	modifiedText: string,
	hunkIndex: number,
): string | undefined {
	const originalLines = splitLines(originalText);
	const modifiedLines = splitLines(modifiedText);
	const diff = linesDiffComputers
		.getDefault()
		.computeDiff(originalLines, modifiedLines, {
			ignoreTrimWhitespace: false,
			maxComputationTimeMs: MAX_HUNK_STAGE_DIFF_TIME_MS,
			computeMoves: false,
		});
	const hunk = diff.changes[hunkIndex];
	if (hunk === undefined) {
		return undefined;
	}
	const before = originalLines.slice(0, hunk.original.startLineNumber - 1);
	const after = originalLines.slice(hunk.original.endLineNumberExclusive - 1);
	const replacement = modifiedLines.slice(
		hunk.modified.startLineNumber - 1,
		hunk.modified.endLineNumberExclusive - 1,
	);
	return [...before, ...replacement, ...after].join("\n");
}

/** The number of distinct changed hunks Monaco's diff engine finds between
 * `originalText` and `modifiedText` — used by callers to decide whether
 * there is anything left to stage at all. */
export function countHunks(originalText: string, modifiedText: string): number {
	const diff = linesDiffComputers
		.getDefault()
		.computeDiff(splitLines(originalText), splitLines(modifiedText), {
			ignoreTrimWhitespace: false,
			maxComputationTimeMs: MAX_HUNK_STAGE_DIFF_TIME_MS,
			computeMoves: false,
		});
	return diff.changes.length;
}

/**
 * Decodes `bytes` as UTF-8 only when doing so is provably lossless — i.e.
 * re-encoding the decoded string reproduces `bytes` exactly, byte for byte.
 * Returns `undefined` otherwise, rather than silently corrupting content the
 * way a plain `new TextDecoder().decode(bytes)` would: the default decoder
 * both strips a leading UTF-8 BOM and replaces invalid byte sequences with
 * U+FFFD, and either transformation is irreversible once the result is later
 * re-encoded and written back out (as `plain-scm-commands.ts`'s hunk-stage
 * path does, via `bridge.gitStageBlob`).
 *
 * `ignoreBOM: true` is what makes this safe for BOM-prefixed files: it makes
 * a leading BOM decode into an ordinary U+FEFF character *in* the returned
 * string (instead of the default's silent-eat behavior), so re-encoding
 * reproduces the original 3 BOM bytes instead of dropping them.
 *
 * `fatal: true` makes the decoder throw on any invalid UTF-8 byte sequence
 * — including non-standard WTF-8-style lone-surrogate encodings — instead of
 * substituting U+FFFD, so this function can catch that and refuse instead of
 * corrupting. The byte-for-byte round-trip check after a successful decode
 * is a second, independent safety net (in principle every string a strict
 * UTF-8 decoder can produce re-encodes byte-identically, but checking rather
 * than assuming keeps this function honest against edge cases in either
 * platform's implementation).
 */
export function decodeLosslessUtf8(bytes: Uint8Array): string | undefined {
	let decoded: string;
	try {
		decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
			bytes,
		);
	} catch {
		return undefined;
	}
	const reencoded = new TextEncoder().encode(decoded);
	if (reencoded.length !== bytes.length) {
		return undefined;
	}
	for (let i = 0; i < reencoded.length; i++) {
		if (reencoded[i] !== bytes[i]) {
			return undefined;
		}
	}
	return decoded;
}
