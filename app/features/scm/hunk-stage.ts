import { linesDiffComputers } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/diff/linesDiffComputers";

/**
 * `F180` S5 keeps hunk selection in the WebView deliberately narrow: Monaco's
 * own line-diff engine computes bounded change ranges between one index
 * snapshot and one on-disk workspace snapshot, while Rust remains the only
 * writer (`hash-object --stdin -w --path` + `update-index`). No unified patch
 * parser, interactive `git add -p`, shell command or editor-buffer content is
 * involved.
 */

const MAX_HUNK_STAGE_DIFF_TIME_MS = 5_000;
const MAX_HUNK_SUMMARY_CODE_UNITS = 96;
const MAX_HUNK_SUMMARY_LINES = 2;
export const MAX_SELECTABLE_HUNKS = 256;

export interface SelectableHunk {
	readonly index: number;
	readonly originalStartLineNumber: number;
	readonly originalEndLineNumberExclusive: number;
	readonly modifiedStartLineNumber: number;
	readonly modifiedEndLineNumberExclusive: number;
	readonly label: string;
	readonly description: string;
	readonly detail: string;
}

export interface HunkSelectionPlan {
	readonly hunks: readonly SelectableHunk[];
	readonly totalHunkCount: number;
	readonly truncated: boolean;
	readonly hitTimeout: boolean;
}

interface PlainHunkStagePickItem {
	readonly label: string;
	readonly description: string;
	readonly detail: string;
	readonly hunkIndex: number;
}

export interface PlainHunkStageSnapshot {
	readonly indexBytes: Uint8Array | null;
	readonly worktreeBytes: Uint8Array;
}

export interface PlainHunkStageServices {
	readonly readSnapshot: () => Promise<PlainHunkStageSnapshot>;
	readonly quickInput: {
		pick(
			items: readonly PlainHunkStagePickItem[],
			options: Readonly<{
				title: string;
				placeHolder: string;
				prompt: string;
				canPickMany: true;
				matchOnDescription: true;
				matchOnDetail: true;
			}>,
		): Promise<readonly PlainHunkStagePickItem[] | undefined>;
	};
	readonly notifications: {
		info(message: string): void;
		error(message: string): void;
	};
	readonly stage: (content: Uint8Array) => Promise<void>;
}

function splitLines(text: string): string[] {
	return text.split("\n");
}

function computeDiff(originalText: string, modifiedText: string) {
	return linesDiffComputers
		.getDefault()
		.computeDiff(splitLines(originalText), splitLines(modifiedText), {
			ignoreTrimWhitespace: false,
			maxComputationTimeMs: MAX_HUNK_STAGE_DIFF_TIME_MS,
			computeMoves: false,
		});
}

function lineRangeLabel(start: number, endExclusive: number): string {
	if (start === endExclusive) {
		return `before L${start}`;
	}
	if (endExclusive === start + 1) {
		return `L${start}`;
	}
	return `L${start}-${endExclusive - 1}`;
}

function boundedLineSummary(
	lines: readonly string[],
	start: number,
	endExclusive: number,
): string {
	if (start === endExclusive) {
		return "(no lines)";
	}
	const summary = lines
		.slice(
			start - 1,
			Math.min(endExclusive - 1, start - 1 + MAX_HUNK_SUMMARY_LINES),
		)
		.map((line) => line.trim().replaceAll(/\s+/g, " "))
		.join(" ⏎ ");
	const withRemainder =
		endExclusive - start > MAX_HUNK_SUMMARY_LINES ? `${summary} …` : summary;
	if (withRemainder.length <= MAX_HUNK_SUMMARY_CODE_UNITS) {
		return withRemainder;
	}
	return `${withRemainder.slice(0, MAX_HUNK_SUMMARY_CODE_UNITS - 1)}…`;
}

/**
 * Returns at most 256 immutable Quick Pick summaries while retaining the
 * total hunk count. A timed-out Monaco diff is never treated as a usable
 * approximation: callers must refuse the write and ask the user to retry.
 */
export function createHunkSelectionPlan(
	originalText: string,
	modifiedText: string,
): HunkSelectionPlan {
	const originalLines = splitLines(originalText);
	const modifiedLines = splitLines(modifiedText);
	const diff = computeDiff(originalText, modifiedText);
	if (diff.hitTimeout) {
		return Object.freeze({
			hunks: Object.freeze([]),
			totalHunkCount: diff.changes.length,
			truncated: false,
			hitTimeout: true,
		});
	}
	const hunks = diff.changes
		.slice(0, MAX_SELECTABLE_HUNKS)
		.map((change, index) => {
			const originalCount =
				change.original.endLineNumberExclusive -
				change.original.startLineNumber;
			const modifiedCount =
				change.modified.endLineNumberExclusive -
				change.modified.startLineNumber;
			return Object.freeze({
				index,
				originalStartLineNumber: change.original.startLineNumber,
				originalEndLineNumberExclusive: change.original.endLineNumberExclusive,
				modifiedStartLineNumber: change.modified.startLineNumber,
				modifiedEndLineNumberExclusive: change.modified.endLineNumberExclusive,
				label: `Change ${index + 1}: ${lineRangeLabel(
					change.original.startLineNumber,
					change.original.endLineNumberExclusive,
				)} → ${lineRangeLabel(
					change.modified.startLineNumber,
					change.modified.endLineNumberExclusive,
				)}`,
				description: `-${originalCount} +${modifiedCount}`,
				detail: `Index: ${boundedLineSummary(
					originalLines,
					change.original.startLineNumber,
					change.original.endLineNumberExclusive,
				)} → Working tree: ${boundedLineSummary(
					modifiedLines,
					change.modified.startLineNumber,
					change.modified.endLineNumberExclusive,
				)}`,
			});
		});
	return Object.freeze({
		hunks: Object.freeze(hunks),
		totalHunkCount: diff.changes.length,
		truncated: diff.changes.length > MAX_SELECTABLE_HUNKS,
		hitTimeout: false,
	});
}

/**
 * Applies exactly the explicitly selected Monaco change ranges to the index
 * text and returns the complete staged blob. Empty, duplicate, non-integer or
 * out-of-range selections fail closed with `undefined`.
 */
export function computeContentAfterApplyingSelectedHunks(
	originalText: string,
	modifiedText: string,
	selectedIndices: readonly number[],
): string | undefined {
	if (
		selectedIndices.length === 0 ||
		selectedIndices.length > MAX_SELECTABLE_HUNKS
	) {
		return undefined;
	}
	const diff = computeDiff(originalText, modifiedText);
	if (diff.hitTimeout) {
		return undefined;
	}
	const selected = new Set<number>();
	for (const index of selectedIndices) {
		if (
			!Number.isInteger(index) ||
			index < 0 ||
			index >= diff.changes.length ||
			index >= MAX_SELECTABLE_HUNKS ||
			selected.has(index)
		) {
			return undefined;
		}
		selected.add(index);
	}

	const originalLines = splitLines(originalText);
	const modifiedLines = splitLines(modifiedText);
	const result: string[] = [];
	let originalCursor = 0;
	for (let index = 0; index < diff.changes.length; index++) {
		const change = diff.changes[index]!;
		const originalStart = change.original.startLineNumber - 1;
		const originalEnd = change.original.endLineNumberExclusive - 1;
		result.push(...originalLines.slice(originalCursor, originalStart));
		if (selected.has(index)) {
			result.push(
				...modifiedLines.slice(
					change.modified.startLineNumber - 1,
					change.modified.endLineNumberExclusive - 1,
				),
			);
		} else {
			result.push(...originalLines.slice(originalStart, originalEnd));
		}
		originalCursor = originalEnd;
	}
	result.push(...originalLines.slice(originalCursor));
	return result.join("\n");
}

/**
 * Decodes only the conservative text subset supported by explicit hunk
 * staging. UTF-8 BOMs, NUL-bearing binary payloads and invalid UTF-8 all
 * return `undefined`; callers can still stage such files as whole files.
 */
export function decodeHunkStageText(bytes: Uint8Array): string | undefined {
	if (
		(bytes.length >= 3 &&
			bytes[0] === 0xef &&
			bytes[1] === 0xbb &&
			bytes[2] === 0xbf) ||
		bytes.includes(0)
	) {
		return undefined;
	}
	let decoded: string;
	try {
		decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
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

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}

function sameSnapshot(
	left: PlainHunkStageSnapshot,
	right: PlainHunkStageSnapshot,
): boolean {
	const sameIndex =
		left.indexBytes === null
			? right.indexBytes === null
			: right.indexBytes !== null &&
				bytesEqual(left.indexBytes, right.indexBytes);
	return sameIndex && bytesEqual(left.worktreeBytes, right.worktreeBytes);
}

/** Testable explicit-selection workflow. It reads exactly one initial
 * index/worktree snapshot, waits for a multi-selection, then re-reads both
 * byte sources immediately before staging. Any stale, empty or invalid
 * selection therefore produces zero `stage` calls. */
export async function stageExplicitHunks(
	relativePath: string,
	services: PlainHunkStageServices,
): Promise<"staged" | "not-staged"> {
	const initial = await services.readSnapshot();
	const originalText = decodeHunkStageText(
		initial.indexBytes ?? new Uint8Array(),
	);
	const modifiedText = decodeHunkStageText(initial.worktreeBytes);
	if (originalText === undefined || modifiedText === undefined) {
		services.notifications.error(
			`Plain: cannot stage selected changes in "${relativePath}" — hunk staging does not accept binary content, a byte-order mark, a non-UTF-8 encoding, or invalid UTF-8 bytes. Stage the whole file instead.`,
		);
		return "not-staged";
	}

	const plan = createHunkSelectionPlan(originalText, modifiedText);
	if (plan.hitTimeout) {
		services.notifications.error(
			`Plain: could not finish computing changes for "${relativePath}" within the safety limit. Retry after reducing the file's size.`,
		);
		return "not-staged";
	}
	if (plan.hunks.length === 0) {
		services.notifications.info(
			`Plain: no changes to stage in "${relativePath}".`,
		);
		return "not-staged";
	}

	const items = Object.freeze(
		plan.hunks.map((hunk) =>
			Object.freeze({
				label: hunk.label,
				description: hunk.description,
				detail: hunk.detail,
				hunkIndex: hunk.index,
			}),
		),
	);
	const shown = plan.truncated
		? `${items.length} of ${plan.totalHunkCount} changes are shown at the safety limit.`
		: `${items.length} change${items.length === 1 ? " is" : "s are"} available.`;
	const selectedItems = await services.quickInput.pick(items, {
		title: `Stage Selected Changes: ${relativePath}`,
		placeHolder: "Select one or more changes, then choose OK",
		prompt: `${shown} Nothing is staged until you explicitly select at least one change.`,
		canPickMany: true,
		matchOnDescription: true,
		matchOnDetail: true,
	});
	if (selectedItems === undefined || selectedItems.length === 0) {
		return "not-staged";
	}

	const selectableIndices = new Set(items.map(({ hunkIndex }) => hunkIndex));
	const selectedIndices = selectedItems.map(({ hunkIndex }) => hunkIndex);
	if (selectedIndices.some((index) => !selectableIndices.has(index))) {
		services.notifications.error(
			`Plain: refused an invalid hunk selection for "${relativePath}".`,
		);
		return "not-staged";
	}
	const content = computeContentAfterApplyingSelectedHunks(
		originalText,
		modifiedText,
		selectedIndices,
	);
	if (content === undefined) {
		services.notifications.error(
			`Plain: refused an empty, duplicate, or out-of-range hunk selection for "${relativePath}".`,
		);
		return "not-staged";
	}

	const current = await services.readSnapshot();
	if (!sameSnapshot(initial, current)) {
		services.notifications.info(
			`Plain: "${relativePath}" or its Git index changed while changes were being selected. Nothing was staged; review the refreshed file and try again.`,
		);
		return "not-staged";
	}

	await services.stage(new TextEncoder().encode(content));
	return "staged";
}
