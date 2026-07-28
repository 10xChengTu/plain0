import type {
	GitBlameCommitHeader,
	GitBlameCommitMessagesResult,
	GitBlameFileResult,
	GitBlameLineEntry,
	GitBlameLineRange,
	GitBlamePrevious,
	GitBlobRev,
	GitBranch,
	GitBranchUpstream,
	GitDiffFileEntry,
	GitDiffFilesResult,
	GitDiffStatusKind,
	GitGraphNode,
	GitHistoryEntry,
	GitHistoryListResult,
	GitLineHistoryDetail,
	GitLogGraphResult,
	GitLogLineRange,
	GitNetworkOperation,
	GitNetworkPreviewResult,
	GitRefEntry,
	GitRefKind,
	GitRefsListResult,
	GitRenameOrCopyKind,
	GitShowBlobResult,
	GitShowCommitResult,
	GitStashApplyOutcome,
	GitStashEntry,
	GitStashListResult,
	GitStashPushOutcome,
	GitStashShowResult,
	GitStatusEntry,
	GitStatusResult,
	GitSubmoduleState,
	GitWorktreeAddOutcome,
	GitWorktreeEntry,
	GitWorktreeHeadState,
	GitWorktreeListResult,
	GitWorktreeRemoveOutcome,
} from "./contracts";

// Defensive decode-side ceilings — git itself imposes no hard length limit
// on a repository path or entry count, so these exist only to reject a
// structurally hostile/runaway payload, mirroring `search-codec.ts`'s own
// "hostile-input ceiling, not an expected value" precedent.
const MAX_GIT_STATUS_ENTRIES = 200_000;
const MAX_GIT_PATH_CHARS = 65_536;
const MAX_GIT_SHOW_BLOB_PATH_CHARS = 4_096;
/** Mirrors `git::diff::MAX_GIT_SHOW_BLOB_BYTES` — see
 * `src-tauri/src/git/diff.rs`. */
const MAX_GIT_SHOW_BLOB_BYTES = 8 * 1_024 * 1_024;

const CONTRACT_ERROR_MESSAGE =
	"Native IPC returned a payload that violates the Plain git contract.";

class GitIpcContractViolation extends Error {
	readonly code = "IPC_CONTRACT_VIOLATION";

	constructor() {
		super(CONTRACT_ERROR_MESSAGE);
		this.name = "GitIpcContractViolation";
	}
}

function violation(): never {
	throw new GitIpcContractViolation();
}

function requestViolation(code: string, message: string): never {
	throw Object.freeze({ code, message });
}

function sanitizedDecode<T>(decoder: () => T): T {
	try {
		return decoder();
	} catch {
		return violation();
	}
}

function rejectProxyObject(value: object): void {
	// The caller has already proved every accepted field is a scalar own data
	// property. Structured clone can therefore serve only as a Proxy brand
	// check and cannot traverse attacker-controlled nested payloads.
	structuredClone(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
): boolean {
	const keys = Reflect.ownKeys(value);
	return (
		keys.length === expected.length &&
		keys.every((key) => typeof key === "string" && expected.includes(key))
	);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function decodeGitPath(value: unknown): string {
	if (typeof value !== "string" || value.length > MAX_GIT_PATH_CHARS) {
		return violation();
	}
	return value;
}

function decodeGitSubmoduleState(value: unknown): GitSubmoduleState {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, [
			"isSubmodule",
			"commitChanged",
			"trackedChanged",
			"untrackedChanged",
		])
	) {
		return violation();
	}
	if (
		typeof value.isSubmodule !== "boolean" ||
		typeof value.commitChanged !== "boolean" ||
		typeof value.trackedChanged !== "boolean" ||
		typeof value.untrackedChanged !== "boolean"
	) {
		return violation();
	}
	rejectProxyObject(value);
	return Object.freeze({
		isSubmodule: value.isSubmodule,
		commitChanged: value.commitChanged,
		trackedChanged: value.trackedChanged,
		untrackedChanged: value.untrackedChanged,
	});
}

function decodeGitBranchUpstream(value: unknown): GitBranchUpstream {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["name", "ahead", "behind"])
	) {
		return violation();
	}
	if (
		typeof value.name !== "string" ||
		!isSafeNonNegativeInteger(value.ahead) ||
		!isSafeNonNegativeInteger(value.behind)
	) {
		return violation();
	}
	rejectProxyObject(value);
	return Object.freeze({
		name: value.name,
		ahead: value.ahead,
		behind: value.behind,
	});
}

function decodeGitBranch(value: unknown): GitBranch {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["oid", "head", "upstream"])
	) {
		return violation();
	}
	if (typeof value.oid !== "string" || typeof value.head !== "string") {
		return violation();
	}
	const upstream =
		value.upstream === null ? null : decodeGitBranchUpstream(value.upstream);
	rejectProxyObject(value);
	return Object.freeze({ oid: value.oid, head: value.head, upstream });
}

const GIT_RENAME_OR_COPY_KINDS = new Set<GitRenameOrCopyKind>([
	"rename",
	"copy",
]);

function isGitRenameOrCopyKind(value: unknown): value is GitRenameOrCopyKind {
	return (
		typeof value === "string" &&
		GIT_RENAME_OR_COPY_KINDS.has(value as GitRenameOrCopyKind)
	);
}

function decodeSingleCharStatus(value: unknown): string {
	if (typeof value !== "string" || value.length !== 1) {
		return violation();
	}
	return value;
}

function decodeGitStatusEntry(value: unknown): GitStatusEntry {
	if (!isPlainObject(value) || typeof value.type !== "string") {
		return violation();
	}
	if (value.type === "ordinary") {
		if (
			!hasExactKeys(value, [
				"type",
				"indexStatus",
				"worktreeStatus",
				"submodule",
				"modeHead",
				"modeIndex",
				"modeWorktree",
				"hashHead",
				"hashIndex",
				"path",
			]) ||
			typeof value.modeHead !== "string" ||
			typeof value.modeIndex !== "string" ||
			typeof value.modeWorktree !== "string" ||
			typeof value.hashHead !== "string" ||
			typeof value.hashIndex !== "string"
		) {
			return violation();
		}
		const entry = {
			type: "ordinary" as const,
			indexStatus: decodeSingleCharStatus(value.indexStatus),
			worktreeStatus: decodeSingleCharStatus(value.worktreeStatus),
			submodule: decodeGitSubmoduleState(value.submodule),
			modeHead: value.modeHead,
			modeIndex: value.modeIndex,
			modeWorktree: value.modeWorktree,
			hashHead: value.hashHead,
			hashIndex: value.hashIndex,
			path: decodeGitPath(value.path),
		};
		rejectProxyObject(value);
		return Object.freeze(entry);
	}
	if (value.type === "renameOrCopy") {
		if (
			!hasExactKeys(value, [
				"type",
				"indexStatus",
				"worktreeStatus",
				"submodule",
				"modeHead",
				"modeIndex",
				"modeWorktree",
				"hashHead",
				"hashIndex",
				"renameOrCopyKind",
				"similarity",
				"path",
				"origPath",
			]) ||
			typeof value.modeHead !== "string" ||
			typeof value.modeIndex !== "string" ||
			typeof value.modeWorktree !== "string" ||
			typeof value.hashHead !== "string" ||
			typeof value.hashIndex !== "string" ||
			!isGitRenameOrCopyKind(value.renameOrCopyKind) ||
			!isSafeNonNegativeInteger(value.similarity) ||
			value.similarity > 100
		) {
			return violation();
		}
		const entry = {
			type: "renameOrCopy" as const,
			indexStatus: decodeSingleCharStatus(value.indexStatus),
			worktreeStatus: decodeSingleCharStatus(value.worktreeStatus),
			submodule: decodeGitSubmoduleState(value.submodule),
			modeHead: value.modeHead,
			modeIndex: value.modeIndex,
			modeWorktree: value.modeWorktree,
			hashHead: value.hashHead,
			hashIndex: value.hashIndex,
			renameOrCopyKind: value.renameOrCopyKind,
			similarity: value.similarity,
			path: decodeGitPath(value.path),
			origPath: decodeGitPath(value.origPath),
		};
		rejectProxyObject(value);
		return Object.freeze(entry);
	}
	if (value.type === "unmerged") {
		if (
			!hasExactKeys(value, [
				"type",
				"indexStatus",
				"worktreeStatus",
				"submodule",
				"modeStage1",
				"modeStage2",
				"modeStage3",
				"modeWorktree",
				"hashStage1",
				"hashStage2",
				"hashStage3",
				"path",
			]) ||
			typeof value.modeStage1 !== "string" ||
			typeof value.modeStage2 !== "string" ||
			typeof value.modeStage3 !== "string" ||
			typeof value.modeWorktree !== "string" ||
			typeof value.hashStage1 !== "string" ||
			typeof value.hashStage2 !== "string" ||
			typeof value.hashStage3 !== "string"
		) {
			return violation();
		}
		const entry = {
			type: "unmerged" as const,
			indexStatus: decodeSingleCharStatus(value.indexStatus),
			worktreeStatus: decodeSingleCharStatus(value.worktreeStatus),
			submodule: decodeGitSubmoduleState(value.submodule),
			modeStage1: value.modeStage1,
			modeStage2: value.modeStage2,
			modeStage3: value.modeStage3,
			modeWorktree: value.modeWorktree,
			hashStage1: value.hashStage1,
			hashStage2: value.hashStage2,
			hashStage3: value.hashStage3,
			path: decodeGitPath(value.path),
		};
		rejectProxyObject(value);
		return Object.freeze(entry);
	}
	if (value.type === "untracked") {
		if (!hasExactKeys(value, ["type", "path"])) {
			return violation();
		}
		const entry = {
			type: "untracked" as const,
			path: decodeGitPath(value.path),
		};
		rejectProxyObject(value);
		return Object.freeze(entry);
	}
	if (value.type === "ignored") {
		if (!hasExactKeys(value, ["type", "path"])) {
			return violation();
		}
		const entry = { type: "ignored" as const, path: decodeGitPath(value.path) };
		rejectProxyObject(value);
		return Object.freeze(entry);
	}
	return violation();
}

/**
 * Validates and freezes an own-data array whose elements are each decoded by
 * `decodeElement` — the same own-data rigor (exact `Array.prototype`,
 * exact-count property descriptors, no getters) `search-codec.ts`'s
 * `ownObjectArraySnapshot` already establishes for a different domain.
 */
function ownObjectArraySnapshot<T>(
	value: unknown,
	maxLength: number,
	decodeElement: (element: unknown) => T,
): readonly T[] {
	if (typeof value !== "object" || value === null || !Array.isArray(value)) {
		return violation();
	}
	if (Object.getPrototypeOf(value) !== Array.prototype) {
		return violation();
	}
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
	if (
		lengthDescriptor === undefined ||
		!("value" in lengthDescriptor) ||
		!Number.isSafeInteger(lengthDescriptor.value) ||
		(lengthDescriptor.value as number) < 0 ||
		(lengthDescriptor.value as number) > maxLength
	) {
		return violation();
	}
	const length = lengthDescriptor.value as number;
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Reflect.ownKeys(descriptors).length !== length + 1) {
		return violation();
	}

	const items: T[] = [];
	for (let index = 0; index < length; index += 1) {
		const descriptor = (descriptors as Record<string, PropertyDescriptor>)[
			String(index)
		];
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			descriptor.get !== undefined ||
			descriptor.set !== undefined
		) {
			return violation();
		}
		items.push(decodeElement(descriptor.value));
	}
	rejectProxyObject(value);
	return Object.freeze(items);
}

/**
 * Decodes a `git_status` response: an own-data, exactly
 * `{ branch, entries }` object.
 */
export function decodeGitStatusResult(value: unknown): GitStatusResult {
	return sanitizedDecode(() => {
		if (!isPlainObject(value) || !hasExactKeys(value, ["branch", "entries"])) {
			return violation();
		}
		const branch = decodeGitBranch(value.branch);
		const entries = ownObjectArraySnapshot(
			value.entries,
			MAX_GIT_STATUS_ENTRIES,
			decodeGitStatusEntry,
		);
		rejectProxyObject(value);
		return Object.freeze({ branch, entries });
	});
}

const GIT_DIFF_STATUS_KINDS = new Set<GitDiffStatusKind>([
	"added",
	"copied",
	"deleted",
	"modified",
	"renamed",
	"typeChanged",
	"unmerged",
	"unknown",
]);

function isGitDiffStatusKind(value: unknown): value is GitDiffStatusKind {
	return (
		typeof value === "string" &&
		GIT_DIFF_STATUS_KINDS.has(value as GitDiffStatusKind)
	);
}

function decodeOptionalCount(value: unknown): number | null {
	if (value === null) {
		return null;
	}
	if (!isSafeNonNegativeInteger(value)) {
		return violation();
	}
	return value;
}

function decodeGitDiffFileEntry(value: unknown): GitDiffFileEntry {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, [
			"kind",
			"similarity",
			"path",
			"origPath",
			"added",
			"deleted",
			"binary",
		])
	) {
		return violation();
	}
	if (!isGitDiffStatusKind(value.kind) || typeof value.binary !== "boolean") {
		return violation();
	}
	if (
		value.similarity !== null &&
		(!isSafeNonNegativeInteger(value.similarity) || value.similarity > 100)
	) {
		return violation();
	}
	if (value.origPath !== null && typeof value.origPath !== "string") {
		return violation();
	}
	const entry = {
		kind: value.kind,
		similarity: value.similarity as number | null,
		path: decodeGitPath(value.path),
		origPath: value.origPath === null ? null : decodeGitPath(value.origPath),
		added: decodeOptionalCount(value.added),
		deleted: decodeOptionalCount(value.deleted),
		binary: value.binary,
	};
	rejectProxyObject(value);
	return Object.freeze(entry);
}

/** Decodes a `git_diff_files` response: an own-data, exactly `{ entries }`
 * object. */
export function decodeGitDiffFilesResult(value: unknown): GitDiffFilesResult {
	return sanitizedDecode(() => {
		if (!isPlainObject(value) || !hasExactKeys(value, ["entries"])) {
			return violation();
		}
		const entries = ownObjectArraySnapshot(
			value.entries,
			MAX_GIT_STATUS_ENTRIES,
			decodeGitDiffFileEntry,
		);
		rejectProxyObject(value);
		return Object.freeze({ entries });
	});
}

export function frozenGitDiffFilesRequest(
	cached: unknown,
): Readonly<{ cached: boolean }> {
	if (typeof cached !== "boolean") {
		return requestViolation(
			"GIT_DIFF_FILES_INVALID_REQUEST",
			"The git diff files request is invalid.",
		);
	}
	return Object.freeze({ cached });
}

const GIT_BLOB_REVS = new Set<GitBlobRev>(["head", "index"]);

function isGitBlobRev(value: unknown): value is GitBlobRev {
	return typeof value === "string" && GIT_BLOB_REVS.has(value as GitBlobRev);
}

export function frozenGitShowBlobRequest(
	rev: unknown,
	path: unknown,
): Readonly<{ rev: GitBlobRev; path: string }> {
	if (!isGitBlobRev(rev)) {
		return requestViolation(
			"GIT_SHOW_BLOB_INVALID_REQUEST",
			"The git show blob request is invalid.",
		);
	}
	if (
		typeof path !== "string" ||
		path.length === 0 ||
		path.length > MAX_GIT_SHOW_BLOB_PATH_CHARS
	) {
		return requestViolation(
			"GIT_SHOW_BLOB_INVALID_REQUEST",
			"The git show blob request is invalid.",
		);
	}
	return Object.freeze({ rev, path });
}

function decodeGitShowBlobContent(value: unknown): Uint8Array {
	if (typeof value !== "object" || value === null || !Array.isArray(value)) {
		return violation();
	}
	if (Object.getPrototypeOf(value) !== Array.prototype) {
		return violation();
	}
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
	if (
		lengthDescriptor === undefined ||
		!("value" in lengthDescriptor) ||
		!Number.isSafeInteger(lengthDescriptor.value) ||
		(lengthDescriptor.value as number) < 0 ||
		(lengthDescriptor.value as number) > MAX_GIT_SHOW_BLOB_BYTES
	) {
		return violation();
	}
	const length = lengthDescriptor.value as number;
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Reflect.ownKeys(descriptors).length !== length + 1) {
		return violation();
	}
	const bytes = new Uint8Array(length);
	for (let index = 0; index < length; index += 1) {
		const descriptor = (descriptors as Record<string, PropertyDescriptor>)[
			String(index)
		];
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			descriptor.get !== undefined ||
			descriptor.set !== undefined ||
			typeof descriptor.value !== "number" ||
			!Number.isInteger(descriptor.value) ||
			descriptor.value < 0 ||
			descriptor.value > 255
		) {
			return violation();
		}
		bytes[index] = descriptor.value;
	}
	rejectProxyObject(value);
	return bytes;
}

/** Decodes a `git_show_blob` response: an own-data, exactly `{ content }`
 * object, `content` being a byte array or `null` (see `GitShowBlobResult`'s
 * own doc comment for why `null` is a normal outcome, not an error). */
export function decodeGitShowBlobResult(value: unknown): GitShowBlobResult {
	return sanitizedDecode(() => {
		if (!isPlainObject(value) || !hasExactKeys(value, ["content"])) {
			return violation();
		}
		const content =
			value.content === null ? null : decodeGitShowBlobContent(value.content);
		rejectProxyObject(value);
		return Object.freeze({ content });
	});
}

/**
 * Builds a frozen `git_show_blob` response directly, for the browser mock
 * (which has no wire boundary to round-trip through).
 */
export function frozenGitShowBlobResult(
	content: Uint8Array | null,
): GitShowBlobResult {
	return decodeGitShowBlobResult({
		content: content === null ? null : Array.from(content),
	});
}

// --- F080 S3 write commands --------------------------------------------

// Defensive ceilings mirroring the Rust-side ones exactly (see
// `src-tauri/src/git/dto.rs`'s `MAX_GIT_MUTATE_PATHS`/
// `MAX_GIT_MUTATE_PATH_BYTES`/`MAX_GIT_STAGE_BLOB_BYTES`/
// `MAX_GIT_COMMIT_MESSAGE_BYTES`) — Rust is the authoritative validator
// (including the `..`/absolute-path rejection this TypeScript layer does not
// duplicate); these exist only to reject a structurally hostile/runaway
// argument before it is ever sent over IPC.
const MAX_GIT_MUTATE_PATHS = 4_096;
const MAX_GIT_MUTATE_PATH_CHARS = 4_096;
const MAX_GIT_STAGE_BLOB_CONTENT_BYTES = 8 * 1_024 * 1_024;
const MAX_GIT_COMMIT_MESSAGE_CHARS = 100_000;

function gitMutatePathsInvalid(): never {
	return requestViolation(
		"GIT_MUTATE_PATHS_INVALID_REQUEST",
		"The path list is empty, too large, or contains an invalid path.",
	);
}

function isValidGitMutatePath(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= MAX_GIT_MUTATE_PATH_CHARS
	);
}

/**
 * Shared by `frozenGitStagePathsRequest`/`frozenGitUnstagePathsRequest`/
 * `frozenGitDiscardPathsRequest` — validates `paths` is a real (non-Proxy,
 * non-sparse, no accessor properties) own-data array of 1..
 * `MAX_GIT_MUTATE_PATHS` non-empty strings, the same rigor
 * `ownObjectArraySnapshot` above already establishes for a *read* response
 * array, applied here to a *write* request array.
 */
function frozenGitMutatePathsRequest(
	paths: unknown,
): Readonly<{ paths: readonly string[] }> {
	if (typeof paths !== "object" || paths === null || !Array.isArray(paths)) {
		return gitMutatePathsInvalid();
	}
	if (Object.getPrototypeOf(paths) !== Array.prototype) {
		return gitMutatePathsInvalid();
	}
	const lengthDescriptor = Object.getOwnPropertyDescriptor(paths, "length");
	if (
		lengthDescriptor === undefined ||
		!("value" in lengthDescriptor) ||
		!Number.isSafeInteger(lengthDescriptor.value) ||
		(lengthDescriptor.value as number) < 1 ||
		(lengthDescriptor.value as number) > MAX_GIT_MUTATE_PATHS
	) {
		return gitMutatePathsInvalid();
	}
	const length = lengthDescriptor.value as number;
	const descriptors = Object.getOwnPropertyDescriptors(paths);
	if (Reflect.ownKeys(descriptors).length !== length + 1) {
		return gitMutatePathsInvalid();
	}
	const collected: string[] = [];
	for (let index = 0; index < length; index += 1) {
		const descriptor = (descriptors as Record<string, PropertyDescriptor>)[
			String(index)
		];
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			descriptor.get !== undefined ||
			descriptor.set !== undefined ||
			!isValidGitMutatePath(descriptor.value)
		) {
			return gitMutatePathsInvalid();
		}
		collected.push(descriptor.value);
	}
	try {
		// A default-trap Proxy over a real array is transparent to every
		// check above (`Array.isArray`, prototype, own property descriptors
		// all pass through unchanged) — only `structuredClone` inside
		// `rejectProxyObject` actually distinguishes it, and does so by
		// throwing a raw, un-coded `DataCloneError` rather than returning a
		// boolean. That raw error must never escape this request-builder
		// boundary as anything other than the same structured
		// `GIT_MUTATE_PATHS_INVALID_REQUEST` every other rejection above
		// already uses.
		rejectProxyObject(paths);
	} catch {
		return gitMutatePathsInvalid();
	}
	return Object.freeze({ paths: Object.freeze(collected) });
}

export function frozenGitStagePathsRequest(
	paths: unknown,
): Readonly<{ paths: readonly string[] }> {
	return frozenGitMutatePathsRequest(paths);
}

export function frozenGitUnstagePathsRequest(
	paths: unknown,
): Readonly<{ paths: readonly string[] }> {
	return frozenGitMutatePathsRequest(paths);
}

export function frozenGitDiscardPathsRequest(
	paths: unknown,
): Readonly<{ paths: readonly string[] }> {
	return frozenGitMutatePathsRequest(paths);
}

function gitStageBlobRequestInvalid(): never {
	return requestViolation(
		"GIT_STAGE_BLOB_INVALID_REQUEST",
		"The git stage blob request is invalid.",
	);
}

/**
 * `content` is accepted only as a real `Uint8Array` (never a Proxy, never a
 * plain array standing in for one) and converted to a plain `number[]` for
 * the wire — `Vec<u8>` on the Rust side serializes as a JSON array of
 * numbers, matching `GitShowBlobResult.content`'s own encoding.
 */
export function frozenGitStageBlobRequest(
	path: unknown,
	content: unknown,
): Readonly<{ path: string; content: readonly number[] }> {
	if (!isValidGitMutatePath(path)) {
		return gitStageBlobRequestInvalid();
	}
	if (!(content instanceof Uint8Array)) {
		return gitStageBlobRequestInvalid();
	}
	if (content.byteLength > MAX_GIT_STAGE_BLOB_CONTENT_BYTES) {
		return gitStageBlobRequestInvalid();
	}
	return Object.freeze({
		path,
		content: Object.freeze(Array.from(content)),
	});
}

function gitCommitRequestInvalid(): never {
	return requestViolation(
		"GIT_COMMIT_INVALID_REQUEST",
		"The commit message is empty or too large.",
	);
}

export function frozenGitCommitRequest(
	message: unknown,
	amend: unknown,
): Readonly<{ message: string; amend: boolean }> {
	if (
		typeof message !== "string" ||
		message.trim().length === 0 ||
		message.length > MAX_GIT_COMMIT_MESSAGE_CHARS
	) {
		return gitCommitRequestInvalid();
	}
	if (typeof amend !== "boolean") {
		return gitCommitRequestInvalid();
	}
	return Object.freeze({ message, amend });
}

/** Decodes a `git_stage_paths`/`git_unstage_paths`/`git_stage_blob`/
 * `git_commit`/`git_discard_paths`/`git_fetch`/`git_pull`/`git_push`/
 * `git_network_cancel` response — every one of these Rust commands returns
 * `Result<(), CommandError>`, which serializes to the JSON literal `null` on
 * success (mirrors `decodeWorkspaceVoid`/`decodeTerminalVoid`'s identical
 * contract for this codebase's other void-returning write commands). */
export function decodeGitVoid(value: unknown): void {
	return sanitizedDecode(() => {
		if (value !== null) {
			return violation();
		}
	});
}

// --- F080 S4: git_network_preview / git_fetch / git_pull / git_push -------

const GIT_NETWORK_OPERATIONS = new Set<GitNetworkOperation>([
	"fetch",
	"pull",
	"push",
]);

function isGitNetworkOperation(value: unknown): value is GitNetworkOperation {
	return (
		typeof value === "string" &&
		GIT_NETWORK_OPERATIONS.has(value as GitNetworkOperation)
	);
}

function gitNetworkPreviewRequestInvalid(): never {
	return requestViolation(
		"GIT_NETWORK_PREVIEW_INVALID_REQUEST",
		"The git network preview request is invalid.",
	);
}

export function frozenGitNetworkPreviewRequest(
	operation: unknown,
): Readonly<{ operation: GitNetworkOperation }> {
	if (!isGitNetworkOperation(operation)) {
		return gitNetworkPreviewRequestInvalid();
	}
	return Object.freeze({ operation });
}

function decodeOptionalAheadBehindCount(value: unknown): number | null {
	if (value === null) {
		return null;
	}
	if (!isSafeNonNegativeInteger(value)) {
		return violation();
	}
	return value;
}

/** Decodes a `git_network_preview` response: an own-data, exactly
 * `{ upstream, ahead, behind }` object — `upstream` is a non-empty string or
 * `null`, `ahead`/`behind` are each a safe non-negative integer or `null`,
 * and all three are `null` together or none of them are (this codec only
 * validates each field's own shape; `GitNetworkPreviewResult`'s own doc
 * comment explains why the three are only ever jointly null). */
export function decodeGitNetworkPreviewResult(
	value: unknown,
): GitNetworkPreviewResult {
	return sanitizedDecode(() => {
		if (
			!isPlainObject(value) ||
			!hasExactKeys(value, ["upstream", "ahead", "behind"])
		) {
			return violation();
		}
		if (value.upstream !== null && typeof value.upstream !== "string") {
			return violation();
		}
		const result = {
			upstream: value.upstream as string | null,
			ahead: decodeOptionalAheadBehindCount(value.ahead),
			behind: decodeOptionalAheadBehindCount(value.behind),
		};
		rejectProxyObject(value);
		return Object.freeze(result);
	});
}

function gitPushRequestInvalid(): never {
	return requestViolation(
		"GIT_PUSH_INVALID_REQUEST",
		"The git push request is invalid.",
	);
}

export function frozenGitPushRequest(
	force: unknown,
): Readonly<{ force: boolean }> {
	if (typeof force !== "boolean") {
		return gitPushRequestInvalid();
	}
	return Object.freeze({ force });
}

// --- F090 S0: git blame (blame core + age heatmap) --------------------------

// Defensive ceilings — mirrors `MAX_GIT_STATUS_ENTRIES`'s own "reject a
// structurally hostile/runaway payload" rationale for this domain's other
// arrays; a real blame response is bounded far below these in practice by
// `src-tauri/src/git/exec.rs`'s 10 MB per-invocation output cap.
const MAX_GIT_BLAME_ENTRIES = 2_000_000;
const MAX_GIT_BLAME_COMMITS = 2_000_000;
const MAX_GIT_BLAME_COMMIT_MESSAGE_SHAS = 4_096;
/** A git sha1 is always exactly 40 lowercase hex characters — both
 * `commitSha`/`previous.sha` on the read side and every entry of a
 * `gitBlameCommitMessages` request on the write side are validated against
 * this exact pattern (not merely "a 40-character string" — an all-digit or
 * uppercase-hex string of the right length is not a real sha), mirroring
 * `MAX_GIT_SHOW_BLOB_PATH_CHARS`'s own "a defensive ceiling that happens to
 * be exact for a fixed-format field" precedent. */
const GIT_BLAME_SHA_PATTERN = /^[0-9a-f]{40}$/;

function isGitBlameSha(value: unknown): value is string {
	return typeof value === "string" && GIT_BLAME_SHA_PATTERN.test(value);
}

function gitBlameFileRequestInvalid(): never {
	return requestViolation(
		"GIT_BLAME_FILE_INVALID_REQUEST",
		"The git blame file request is invalid.",
	);
}

function isValidGitBlameRange(value: unknown): value is GitBlameLineRange {
	return (
		isPlainObject(value) &&
		hasExactKeys(value, ["start", "end"]) &&
		isSafeNonNegativeInteger(value.start) &&
		isSafeNonNegativeInteger(value.end) &&
		value.start >= 1 &&
		value.end >= value.start
	);
}

/** Builds a frozen `git_blame_file` request. `range` is `null` for
 * whole-file blame — see `GitBlameLineRange`'s own doc comment. */
export function frozenGitBlameFileRequest(
	path: unknown,
	range: unknown,
): Readonly<{ path: string; range: GitBlameLineRange | null }> {
	if (
		typeof path !== "string" ||
		path.length === 0 ||
		path.length > MAX_GIT_MUTATE_PATH_CHARS
	) {
		return gitBlameFileRequestInvalid();
	}
	if (range !== null && !isValidGitBlameRange(range)) {
		return gitBlameFileRequestInvalid();
	}
	return Object.freeze({
		path,
		range:
			range === null
				? null
				: Object.freeze({ start: range.start, end: range.end }),
	});
}

function decodeGitBlamePrevious(value: unknown): GitBlamePrevious {
	if (!isPlainObject(value) || !hasExactKeys(value, ["sha", "path"])) {
		return violation();
	}
	if (!isGitBlameSha(value.sha)) {
		return violation();
	}
	const previous = { sha: value.sha, path: decodeGitPath(value.path) };
	rejectProxyObject(value);
	return Object.freeze(previous);
}

function decodeGitBlameLineEntry(value: unknown): GitBlameLineEntry {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, [
			"commitSha",
			"isUncommitted",
			"origLine",
			"finalLine",
			"isBoundary",
			"filename",
			"previous",
		])
	) {
		return violation();
	}
	if (
		!isGitBlameSha(value.commitSha) ||
		typeof value.isUncommitted !== "boolean" ||
		typeof value.isBoundary !== "boolean" ||
		!isSafeNonNegativeInteger(value.origLine) ||
		!isSafeNonNegativeInteger(value.finalLine) ||
		(value.previous !== null && !isPlainObject(value.previous))
	) {
		return violation();
	}
	const entry = {
		commitSha: value.commitSha,
		isUncommitted: value.isUncommitted,
		origLine: value.origLine,
		finalLine: value.finalLine,
		isBoundary: value.isBoundary,
		filename: decodeGitPath(value.filename),
		previous:
			value.previous === null ? null : decodeGitBlamePrevious(value.previous),
	};
	rejectProxyObject(value);
	return Object.freeze(entry);
}

function decodeGitBlameCommitHeader(value: unknown): GitBlameCommitHeader {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, [
			"author",
			"authorMail",
			"authorTime",
			"authorTz",
			"committer",
			"committerMail",
			"committerTime",
			"committerTz",
			"summary",
		])
	) {
		return violation();
	}
	if (
		typeof value.author !== "string" ||
		typeof value.authorMail !== "string" ||
		typeof value.authorTz !== "string" ||
		typeof value.committer !== "string" ||
		typeof value.committerMail !== "string" ||
		typeof value.committerTz !== "string" ||
		typeof value.summary !== "string" ||
		typeof value.authorTime !== "number" ||
		!Number.isSafeInteger(value.authorTime) ||
		typeof value.committerTime !== "number" ||
		!Number.isSafeInteger(value.committerTime)
	) {
		return violation();
	}
	const header = {
		author: value.author,
		authorMail: value.authorMail,
		authorTime: value.authorTime,
		authorTz: value.authorTz,
		committer: value.committer,
		committerMail: value.committerMail,
		committerTime: value.committerTime,
		committerTz: value.committerTz,
		summary: value.summary,
	};
	rejectProxyObject(value);
	return Object.freeze(header);
}

/** Own-data, non-Proxy, string-keyed record snapshot with a per-value
 * decoder and a hostile-input entry-count ceiling — the dictionary-shaped
 * analogue of `ownObjectArraySnapshot` above (that one validates a real
 * array's own numeric-index descriptors; a `HashMap<String, _>` on the Rust
 * side instead serializes as a plain object with arbitrary string keys, so
 * this walks `Reflect.ownKeys`/`Object.getOwnPropertyDescriptors` directly,
 * mirroring `workspace-codec.ts`'s `ownPlainDataSnapshot` for a different
 * domain's own dynamic-key object). */
function ownGitRecordSnapshot<T>(
	value: unknown,
	maxEntries: number,
	decodeValue: (entry: unknown) => T,
): Readonly<Record<string, T>> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return violation();
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		return violation();
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Reflect.ownKeys(descriptors);
	if (keys.length > maxEntries) {
		return violation();
	}
	const snapshot: Record<string, T> = Object.create(null);
	for (const key of keys) {
		if (typeof key !== "string") {
			return violation();
		}
		const descriptor = descriptors[key];
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			descriptor.get !== undefined ||
			descriptor.set !== undefined
		) {
			return violation();
		}
		snapshot[key] = decodeValue(descriptor.value);
	}
	return Object.freeze(snapshot);
}

/** Decodes a `git_blame_file` response: an own-data, exactly
 * `{ entries, commits }` object. */
export function decodeGitBlameFileResult(value: unknown): GitBlameFileResult {
	return sanitizedDecode(() => {
		if (!isPlainObject(value) || !hasExactKeys(value, ["entries", "commits"])) {
			return violation();
		}
		const entries = ownObjectArraySnapshot(
			value.entries,
			MAX_GIT_BLAME_ENTRIES,
			decodeGitBlameLineEntry,
		);
		const commits = ownGitRecordSnapshot(
			value.commits,
			MAX_GIT_BLAME_COMMITS,
			decodeGitBlameCommitHeader,
		);
		rejectProxyObject(value);
		return Object.freeze({ entries, commits });
	});
}

function gitBlameCommitMessagesRequestInvalid(): never {
	return requestViolation(
		"GIT_BLAME_COMMIT_MESSAGES_INVALID_REQUEST",
		"The commit sha list is empty, too large, or contains an invalid entry.",
	);
}

/** Builds a frozen `git_blame_commit_messages` request — same
 * non-Proxy/non-sparse/no-accessor rigor as `frozenGitMutatePathsRequest`,
 * applied to a sha list rather than a path list (and, unlike that one, an
 * empty list is valid here — see `PlainBridge.gitBlameCommitMessages`'s own
 * doc comment). */
export function frozenGitBlameCommitMessagesRequest(
	shas: unknown,
): Readonly<{ shas: readonly string[] }> {
	if (typeof shas !== "object" || shas === null || !Array.isArray(shas)) {
		return gitBlameCommitMessagesRequestInvalid();
	}
	if (Object.getPrototypeOf(shas) !== Array.prototype) {
		return gitBlameCommitMessagesRequestInvalid();
	}
	const lengthDescriptor = Object.getOwnPropertyDescriptor(shas, "length");
	if (
		lengthDescriptor === undefined ||
		!("value" in lengthDescriptor) ||
		!Number.isSafeInteger(lengthDescriptor.value) ||
		(lengthDescriptor.value as number) < 0 ||
		(lengthDescriptor.value as number) > MAX_GIT_BLAME_COMMIT_MESSAGE_SHAS
	) {
		return gitBlameCommitMessagesRequestInvalid();
	}
	const length = lengthDescriptor.value as number;
	const descriptors = Object.getOwnPropertyDescriptors(shas);
	if (Reflect.ownKeys(descriptors).length !== length + 1) {
		return gitBlameCommitMessagesRequestInvalid();
	}
	const collected: string[] = [];
	for (let index = 0; index < length; index += 1) {
		const descriptor = (descriptors as Record<string, PropertyDescriptor>)[
			String(index)
		];
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			descriptor.get !== undefined ||
			descriptor.set !== undefined ||
			!isGitBlameSha(descriptor.value)
		) {
			return gitBlameCommitMessagesRequestInvalid();
		}
		collected.push(descriptor.value);
	}
	try {
		// See `frozenGitMutatePathsRequest`'s identical try/catch for why a
		// Proxy-detection failure must be re-coded as this request builder's
		// own structured violation rather than letting a raw
		// `DataCloneError` escape.
		rejectProxyObject(shas);
	} catch {
		return gitBlameCommitMessagesRequestInvalid();
	}
	return Object.freeze({ shas: Object.freeze(collected) });
}

/** Decodes a `git_blame_commit_messages` response: an own-data, exactly
 * `{ messages }` object whose `messages` value is itself a string-keyed
 * record of sha -> full commit message body. */
export function decodeGitBlameCommitMessagesResult(
	value: unknown,
): GitBlameCommitMessagesResult {
	return sanitizedDecode(() => {
		if (!isPlainObject(value) || !hasExactKeys(value, ["messages"])) {
			return violation();
		}
		const messages = ownGitRecordSnapshot(
			value.messages,
			MAX_GIT_BLAME_COMMIT_MESSAGE_SHAS,
			(entry) => {
				if (typeof entry !== "string") {
					return violation();
				}
				return entry;
			},
		);
		rejectProxyObject(value);
		return Object.freeze({ messages });
	});
}

// --- F090 S1: git file/line history (`git::log`) ----------------------------

// Defensive decode-side ceiling — a real response is already capped
// server-side by `src-tauri/src/git/log.rs`'s own `MAX_HISTORY_ENTRIES`
// (500), so this exists only to reject a structurally hostile/runaway
// payload with generous headroom, mirroring `MAX_GIT_BLAME_ENTRIES`'s own
// "far above the real ceiling" rationale.
const MAX_GIT_HISTORY_ENTRIES = 10_000;
/** Mirrors `src-tauri/src/git/exec.rs`'s `GIT_EXEC_OUTPUT_CAP_BYTES` — a
 * `gitLineHistoryDetail` response's `diffText` can never exceed one
 * invocation's own captured-output cap. */
const MAX_GIT_LINE_HISTORY_DETAIL_DIFF_TEXT_CHARS = 10_000_000;

function gitFileHistoryRequestInvalid(): never {
	return requestViolation(
		"GIT_LOG_INVALID_REQUEST",
		"The git file history request is invalid.",
	);
}

/** Builds a frozen `git_file_history` request. */
export function frozenGitFileHistoryRequest(
	path: unknown,
): Readonly<{ path: string }> {
	if (
		typeof path !== "string" ||
		path.length === 0 ||
		path.length > MAX_GIT_MUTATE_PATH_CHARS
	) {
		return gitFileHistoryRequestInvalid();
	}
	return Object.freeze({ path });
}

function isValidGitLogLineRange(value: unknown): value is GitLogLineRange {
	return (
		isPlainObject(value) &&
		hasExactKeys(value, ["start", "end"]) &&
		isSafeNonNegativeInteger(value.start) &&
		isSafeNonNegativeInteger(value.end) &&
		value.start >= 1 &&
		value.end >= value.start
	);
}

function gitLineHistoryListRequestInvalid(): never {
	return requestViolation(
		"GIT_LOG_INVALID_REQUEST",
		"The git line history list request is invalid.",
	);
}

/** Builds a frozen `git_line_history_list` request — unlike
 * `frozenGitBlameFileRequest`'s `range`, this one is never `null`: line
 * history has no whole-file mode (that is `gitFileHistory`). */
export function frozenGitLineHistoryListRequest(
	path: unknown,
	range: unknown,
): Readonly<{ path: string; range: GitLogLineRange }> {
	if (
		typeof path !== "string" ||
		path.length === 0 ||
		path.length > MAX_GIT_MUTATE_PATH_CHARS
	) {
		return gitLineHistoryListRequestInvalid();
	}
	if (!isValidGitLogLineRange(range)) {
		return gitLineHistoryListRequestInvalid();
	}
	return Object.freeze({
		path,
		range: Object.freeze({ start: range.start, end: range.end }),
	});
}

function gitLineHistoryDetailRequestInvalid(): never {
	return requestViolation(
		"GIT_LOG_INVALID_REQUEST",
		"The git line history detail request is invalid.",
	);
}

/** Builds a frozen `git_line_history_detail` request. `skip` must be a safe
 * non-negative integer (the zero-based position within a previously-fetched
 * `gitLineHistoryList` call's own result order — never an arbitrary index);
 * `expectedSha` must be a real, exactly 40-lowercase-hex commit id (the sha
 * that same list entry reported) — see `PlainBridge.gitLineHistoryDetail`'s
 * own doc comment for why this is required, not optional. */
export function frozenGitLineHistoryDetailRequest(
	path: unknown,
	range: unknown,
	skip: unknown,
	expectedSha: unknown,
): Readonly<{
	path: string;
	range: GitLogLineRange;
	skip: number;
	expectedSha: string;
}> {
	if (
		typeof path !== "string" ||
		path.length === 0 ||
		path.length > MAX_GIT_MUTATE_PATH_CHARS
	) {
		return gitLineHistoryDetailRequestInvalid();
	}
	if (!isValidGitLogLineRange(range)) {
		return gitLineHistoryDetailRequestInvalid();
	}
	if (!isSafeNonNegativeInteger(skip)) {
		return gitLineHistoryDetailRequestInvalid();
	}
	if (!isGitBlameSha(expectedSha)) {
		return gitLineHistoryDetailRequestInvalid();
	}
	return Object.freeze({
		path,
		range: Object.freeze({ start: range.start, end: range.end }),
		skip,
		expectedSha,
	});
}

function decodeGitHistoryEntry(value: unknown): GitHistoryEntry {
	if (!isPlainObject(value) || !hasExactKeys(value, ["sha", "message"])) {
		return violation();
	}
	if (!isGitBlameSha(value.sha) || typeof value.message !== "string") {
		return violation();
	}
	const entry = { sha: value.sha, message: value.message };
	rejectProxyObject(value);
	return Object.freeze(entry);
}

/** Decodes a `git_file_history`/`git_line_history_list` response — both
 * commands share this one result shape (see `GitHistoryListResult`'s own
 * doc comment). */
export function decodeGitHistoryListResult(
	value: unknown,
): GitHistoryListResult {
	return sanitizedDecode(() => {
		if (
			!isPlainObject(value) ||
			!hasExactKeys(value, ["entries", "truncated"])
		) {
			return violation();
		}
		if (typeof value.truncated !== "boolean") {
			return violation();
		}
		const entries = ownObjectArraySnapshot(
			value.entries,
			MAX_GIT_HISTORY_ENTRIES,
			decodeGitHistoryEntry,
		);
		rejectProxyObject(value);
		return Object.freeze({ entries, truncated: value.truncated });
	});
}

/** Decodes a `git_line_history_detail` response. */
export function decodeGitLineHistoryDetailResult(
	value: unknown,
): GitLineHistoryDetail {
	return sanitizedDecode(() => {
		if (!isPlainObject(value) || !hasExactKeys(value, ["sha", "diffText"])) {
			return violation();
		}
		if (
			!isGitBlameSha(value.sha) ||
			typeof value.diffText !== "string" ||
			value.diffText.length > MAX_GIT_LINE_HISTORY_DETAIL_DIFF_TEXT_CHARS
		) {
			return violation();
		}
		const result = { sha: value.sha, diffText: value.diffText };
		rejectProxyObject(value);
		return Object.freeze(result);
	});
}

// --- F090 S2: git commit detail (`git::show_commit`) ------------------------

function gitShowCommitRequestInvalid(): never {
	return requestViolation(
		"GIT_SHOW_COMMIT_INVALID_REQUEST",
		"The git show commit request is invalid.",
	);
}

/** Builds a frozen `git_show_commit` request. `sha` must be a real, exactly
 * 40-lowercase-hex commit id — mirrors `frozenGitLineHistoryDetailRequest`'s
 * own `expectedSha` validation via the same `isGitBlameSha` check. */
export function frozenGitShowCommitRequest(
	sha: unknown,
): Readonly<{ sha: string }> {
	if (!isGitBlameSha(sha)) {
		return gitShowCommitRequestInvalid();
	}
	return Object.freeze({ sha });
}

/** Decodes a `git_show_commit` response: an own-data, exactly
 * `{ sha, parentSha, files }` object. `files` reuses the exact same
 * `decodeGitDiffFileEntry` element decoder `decodeGitDiffFilesResult` already
 * uses — see `GitShowCommitResult`'s own doc comment for why the wire shape
 * is identical. */
export function decodeGitShowCommitResult(value: unknown): GitShowCommitResult {
	return sanitizedDecode(() => {
		if (
			!isPlainObject(value) ||
			!hasExactKeys(value, ["sha", "parentSha", "files"])
		) {
			return violation();
		}
		if (
			!isGitBlameSha(value.sha) ||
			(value.parentSha !== null && !isGitBlameSha(value.parentSha))
		) {
			return violation();
		}
		const files = ownObjectArraySnapshot(
			value.files,
			MAX_GIT_STATUS_ENTRIES,
			decodeGitDiffFileEntry,
		);
		rejectProxyObject(value);
		return Object.freeze({
			sha: value.sha,
			parentSha: value.parentSha,
			files,
		});
	});
}

function gitShowCommitBlobRequestInvalid(): never {
	return requestViolation(
		"GIT_SHOW_COMMIT_BLOB_INVALID_REQUEST",
		"The git show commit blob request is invalid.",
	);
}

/** Builds a frozen `git_show_commit_blob` request. Its response is decoded
 * through the existing `decodeGitShowBlobResult` (identical `{ content }`
 * wire shape to `git_show_blob`) — never a near-duplicate decoder. */
export function frozenGitShowCommitBlobRequest(
	sha: unknown,
	path: unknown,
): Readonly<{ sha: string; path: string }> {
	if (!isGitBlameSha(sha)) {
		return gitShowCommitBlobRequestInvalid();
	}
	if (
		typeof path !== "string" ||
		path.length === 0 ||
		path.length > MAX_GIT_MUTATE_PATH_CHARS
	) {
		return gitShowCommitBlobRequestInvalid();
	}
	return Object.freeze({ sha, path });
}

// --- F090 S3: graph (`git::log::log_graph`) ---------------------------------

/** Mirrors `src-tauri/src/git/log.rs`'s own `MAX_GRAPH_MAX_COUNT` and
 * `dto.rs`'s own independent wire-layer copy `MAX_GIT_LOG_GRAPH_MAX_COUNT` —
 * this frontend codec keeps its own third independent copy for the same
 * "defense in depth, each layer re-validates" reason `isValidGitLogLineRange`
 * above validates a range the Rust side will also independently reject. */
const MAX_GIT_LOG_GRAPH_MAX_COUNT = 5_000;
/** Defensive decode-side ceiling on how many nodes a single response can
 * report — a real response is already capped server-side by the caller's
 * own requested `maxCount` (itself bounded by `MAX_GIT_LOG_GRAPH_MAX_COUNT`
 * above), so this exists only to reject a structurally hostile/runaway
 * payload with generous headroom, mirroring `MAX_GIT_HISTORY_ENTRIES`'s own
 * "far above the real ceiling" rationale. */
const MAX_GIT_GRAPH_NODES = 10_000;
/** Defensive decode-side ceiling on how many parents a single node's
 * `parents` array can report — real git has no fixed limit on an octopus
 * merge's parent count, so this exists only to reject a structurally
 * hostile/runaway payload. */
const MAX_GIT_GRAPH_PARENTS_PER_NODE = 1_000;

function gitLogGraphRequestInvalid(): never {
	return requestViolation(
		"GIT_LOG_GRAPH_INVALID_REQUEST",
		"The git log graph request is invalid.",
	);
}

/** Builds a frozen `git_log_graph` request. `maxCount` must be a positive
 * safe integer no greater than `MAX_GIT_LOG_GRAPH_MAX_COUNT`. */
export function frozenGitLogGraphRequest(
	maxCount: unknown,
): Readonly<{ maxCount: number }> {
	if (
		!isSafeNonNegativeInteger(maxCount) ||
		maxCount === 0 ||
		maxCount > MAX_GIT_LOG_GRAPH_MAX_COUNT
	) {
		return gitLogGraphRequestInvalid();
	}
	return Object.freeze({ maxCount });
}

function decodeGitGraphNode(value: unknown): GitGraphNode {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["sha", "parents", "subject"])
	) {
		return violation();
	}
	if (!isGitBlameSha(value.sha) || typeof value.subject !== "string") {
		return violation();
	}
	const parents = ownObjectArraySnapshot(
		value.parents,
		MAX_GIT_GRAPH_PARENTS_PER_NODE,
		(parent) => (isGitBlameSha(parent) ? parent : violation()),
	);
	const node = { sha: value.sha, parents, subject: value.subject };
	rejectProxyObject(value);
	return Object.freeze(node);
}

/** Decodes a `git_log_graph` response: an own-data, exactly
 * `{ nodes, truncated }` object. */
export function decodeGitLogGraphResult(value: unknown): GitLogGraphResult {
	return sanitizedDecode(() => {
		if (!isPlainObject(value) || !hasExactKeys(value, ["nodes", "truncated"])) {
			return violation();
		}
		if (typeof value.truncated !== "boolean") {
			return violation();
		}
		const nodes = ownObjectArraySnapshot(
			value.nodes,
			MAX_GIT_GRAPH_NODES,
			decodeGitGraphNode,
		);
		const result = { nodes, truncated: value.truncated };
		rejectProxyObject(value);
		return Object.freeze(result);
	});
}

// --- F090 S3: refs (`git::refs::list_refs`) ---------------------------------

/** Mirrors `src-tauri/src/git/refs.rs`'s own `MAX_REF_ENTRIES` (10,000) —
 * this decode-side ceiling exists only to reject a structurally hostile/
 * runaway payload, with generous headroom above the real server-side cap,
 * mirroring `MAX_GIT_GRAPH_NODES`'s identical rationale just above. */
const MAX_GIT_REFS_ENTRIES = 20_000;
/** Defensive decode-side ceiling on a single ref name's/upstream's length —
 * git itself imposes no fixed limit, mirroring `MAX_GIT_PATH_CHARS`'s own
 * "hostile-input ceiling, not an expected value" precedent for this
 * domain's path fields. */
const MAX_GIT_REF_NAME_CHARS = 65_536;

function isGitRefKind(value: unknown): value is GitRefKind {
	return value === "branch" || value === "remoteBranch" || value === "tag";
}

function isValidGitRefName(value: unknown): value is string {
	return typeof value === "string" && value.length <= MAX_GIT_REF_NAME_CHARS;
}

function decodeGitRefEntry(value: unknown): GitRefEntry {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, [
			"kind",
			"fullName",
			"shortName",
			"targetSha",
			"isAnnotatedTag",
			"peeledSha",
			"upstream",
			"isHead",
		])
	) {
		return violation();
	}
	if (
		!isGitRefKind(value.kind) ||
		!isValidGitRefName(value.fullName) ||
		!isValidGitRefName(value.shortName) ||
		!isGitBlameSha(value.targetSha) ||
		typeof value.isAnnotatedTag !== "boolean" ||
		(value.peeledSha !== null && !isGitBlameSha(value.peeledSha)) ||
		(value.upstream !== null && !isValidGitRefName(value.upstream)) ||
		typeof value.isHead !== "boolean"
	) {
		return violation();
	}
	const entry = {
		kind: value.kind,
		fullName: value.fullName,
		shortName: value.shortName,
		targetSha: value.targetSha,
		isAnnotatedTag: value.isAnnotatedTag,
		peeledSha: value.peeledSha,
		upstream: value.upstream,
		isHead: value.isHead,
	};
	rejectProxyObject(value);
	return Object.freeze(entry);
}

/** Decodes a `git_refs_list` response: an own-data, exactly
 * `{ entries, truncated }` object. `git_refs_list` itself takes no request
 * payload at all (mirrors `git_fetch`/`git_pull`/`git_network_cancel`'s own
 * `{}` shape) — there is no corresponding `frozenGitRefsListRequest`. */
export function decodeGitRefsListResult(value: unknown): GitRefsListResult {
	return sanitizedDecode(() => {
		if (
			!isPlainObject(value) ||
			!hasExactKeys(value, ["entries", "truncated"])
		) {
			return violation();
		}
		if (typeof value.truncated !== "boolean") {
			return violation();
		}
		const entries = ownObjectArraySnapshot(
			value.entries,
			MAX_GIT_REFS_ENTRIES,
			decodeGitRefEntry,
		);
		const result = { entries, truncated: value.truncated };
		rejectProxyObject(value);
		return Object.freeze(result);
	});
}

// --- F090 S4: stash (`git::stash`) -------------------------------------------

/** Mirrors `src-tauri/src/git/stash.rs`'s own `MAX_STASH_ENTRIES` (10,000) —
 * this decode-side ceiling exists only to reject a structurally hostile/
 * runaway payload, with generous headroom above the real server-side cap,
 * mirroring `MAX_GIT_REFS_ENTRIES`'s identical rationale. */
const MAX_GIT_STASH_ENTRIES = 20_000;
/** Mirrors `stash::MAX_GIT_STASH_MESSAGE_BYTES`/`dto.rs`'s own independent
 * copy — this frontend codec keeps its own third independent copy, the same
 * "defense in depth, each layer re-validates" reason `MAX_GIT_COMMIT_MESSAGE_CHARS`
 * above validates a message the Rust side will also independently reject. */
const MAX_GIT_STASH_MESSAGE_CHARS = 100_000;
/** Defensive ceiling on how many conflicted paths one `gitStashApply`/
 * `gitStashPop` conflict outcome can report — mirrors `MAX_GIT_MUTATE_PATHS`'s
 * own "bound a pathological response size" rationale. */
const MAX_GIT_STASH_CONFLICTED_PATHS = 200_000;

/** `committerTime` is a Unix timestamp that, unlike every other integer
 * field this codec validates, is not constrained to be non-negative (git
 * itself does not forbid an author/committer date before 1970) — its own
 * type predicate, distinct from `isSafeNonNegativeInteger`. */
function isSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value);
}

function decodeGitStashEntry(value: unknown): GitStashEntry {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["index", "sha", "committerTime", "message"])
	) {
		return violation();
	}
	if (
		!isSafeNonNegativeInteger(value.index) ||
		!isGitBlameSha(value.sha) ||
		!isSafeInteger(value.committerTime) ||
		typeof value.message !== "string"
	) {
		return violation();
	}
	const entry = {
		index: value.index,
		sha: value.sha,
		committerTime: value.committerTime,
		message: value.message,
	};
	rejectProxyObject(value);
	return Object.freeze(entry);
}

/** Decodes a `git_stash_list` response: an own-data, exactly
 * `{ entries, truncated }` object. `git_stash_list` itself takes no request
 * payload at all (mirrors `git_refs_list`'s own `{}` shape) — there is no
 * corresponding `frozenGitStashListRequest`. */
export function decodeGitStashListResult(value: unknown): GitStashListResult {
	return sanitizedDecode(() => {
		if (
			!isPlainObject(value) ||
			!hasExactKeys(value, ["entries", "truncated"])
		) {
			return violation();
		}
		if (typeof value.truncated !== "boolean") {
			return violation();
		}
		const entries = ownObjectArraySnapshot(
			value.entries,
			MAX_GIT_STASH_ENTRIES,
			decodeGitStashEntry,
		);
		const result = { entries, truncated: value.truncated };
		rejectProxyObject(value);
		return Object.freeze(result);
	});
}

function gitStashShowRequestInvalid(): never {
	return requestViolation(
		"GIT_STASH_SHOW_INVALID_REQUEST",
		"The git stash show request is invalid.",
	);
}

/** Builds a frozen `git_stash_show` request. `sha` must be a real, exactly
 * 40-lowercase-hex commit id — mirrors `frozenGitShowCommitRequest`'s own
 * validation via the same `isGitBlameSha` check. */
export function frozenGitStashShowRequest(
	sha: unknown,
): Readonly<{ sha: string }> {
	if (!isGitBlameSha(sha)) {
		return gitStashShowRequestInvalid();
	}
	return Object.freeze({ sha });
}

/** Decodes a `git_stash_show` response: an own-data, exactly
 * `{ sha, parentSha, files }` object — reuses the exact same
 * `decodeGitDiffFileEntry` element decoder `decodeGitShowCommitResult`
 * already uses (see `GitStashShowResult`'s own doc comment for why the wire
 * shape is identical). */
export function decodeGitStashShowResult(value: unknown): GitStashShowResult {
	return sanitizedDecode(() => {
		if (
			!isPlainObject(value) ||
			!hasExactKeys(value, ["sha", "parentSha", "files"])
		) {
			return violation();
		}
		if (
			!isGitBlameSha(value.sha) ||
			(value.parentSha !== null && !isGitBlameSha(value.parentSha))
		) {
			return violation();
		}
		const files = ownObjectArraySnapshot(
			value.files,
			MAX_GIT_STATUS_ENTRIES,
			decodeGitDiffFileEntry,
		);
		rejectProxyObject(value);
		return Object.freeze({
			sha: value.sha,
			parentSha: value.parentSha,
			files,
		});
	});
}

function gitStashPushRequestInvalid(): never {
	return requestViolation(
		"GIT_STASH_PUSH_INVALID_REQUEST",
		"The stash message is empty or too large.",
	);
}

/** Builds a frozen `git_stash_push` request — mirrors `frozenGitCommitRequest`'s
 * own message validation (non-empty after trimming, bounded length), with
 * `includeUntracked` in place of `amend`. */
export function frozenGitStashPushRequest(
	message: unknown,
	includeUntracked: unknown,
): Readonly<{ message: string; includeUntracked: boolean }> {
	if (
		typeof message !== "string" ||
		message.trim().length === 0 ||
		message.length > MAX_GIT_STASH_MESSAGE_CHARS
	) {
		return gitStashPushRequestInvalid();
	}
	if (typeof includeUntracked !== "boolean") {
		return gitStashPushRequestInvalid();
	}
	return Object.freeze({ message, includeUntracked });
}

const GIT_STASH_PUSH_OUTCOMES = new Set<GitStashPushOutcome>([
	"created",
	"noLocalChanges",
]);

/** Decodes a `git_stash_push` response: a bare own-data string, one of the
 * exact two audited outcomes — mirrors `GitRefKindWire`'s own "fieldless enum
 * serializes as a plain string" convention (unlike `GitStashApplyOutcomeWire`,
 * neither variant carries data, so there is no `"kind"` tag object here). */
export function decodeGitStashPushOutcome(value: unknown): GitStashPushOutcome {
	return sanitizedDecode(() => {
		if (
			typeof value !== "string" ||
			!GIT_STASH_PUSH_OUTCOMES.has(value as GitStashPushOutcome)
		) {
			return violation();
		}
		return value as GitStashPushOutcome;
	});
}

function gitStashApplyRequestInvalid(): never {
	return requestViolation(
		"GIT_STASH_APPLY_INVALID_REQUEST",
		"The git stash apply request is invalid.",
	);
}

export function frozenGitStashApplyRequest(
	sha: unknown,
	useIndex: unknown,
): Readonly<{ sha: string; useIndex: boolean }> {
	if (!isGitBlameSha(sha)) {
		return gitStashApplyRequestInvalid();
	}
	if (typeof useIndex !== "boolean") {
		return gitStashApplyRequestInvalid();
	}
	return Object.freeze({ sha, useIndex });
}

function gitStashPopRequestInvalid(): never {
	return requestViolation(
		"GIT_STASH_POP_INVALID_REQUEST",
		"The git stash pop request is invalid.",
	);
}

/** Unlike `frozenGitStashApplyRequest`, the field is named `expectedSha` (not
 * `sha`) — mirrors `GitStashPopRequest`'s identical naming choice server-side
 * (see `src-tauri/src/git/dto.rs`'s own doc comment on that field). */
export function frozenGitStashPopRequest(
	expectedSha: unknown,
	useIndex: unknown,
): Readonly<{ expectedSha: string; useIndex: boolean }> {
	if (!isGitBlameSha(expectedSha)) {
		return gitStashPopRequestInvalid();
	}
	if (typeof useIndex !== "boolean") {
		return gitStashPopRequestInvalid();
	}
	return Object.freeze({ expectedSha, useIndex });
}

function gitStashDropRequestInvalid(): never {
	return requestViolation(
		"GIT_STASH_DROP_INVALID_REQUEST",
		"The git stash drop request is invalid.",
	);
}

export function frozenGitStashDropRequest(
	expectedSha: unknown,
): Readonly<{ expectedSha: string }> {
	if (!isGitBlameSha(expectedSha)) {
		return gitStashDropRequestInvalid();
	}
	return Object.freeze({ expectedSha });
}

/** Decodes a `git_stash_apply`/`git_stash_pop` response — an own-data,
 * exactly `{ kind: "applied" }` or `{ kind: "conflict", conflictedPaths }`
 * object (mirrors `decodeGitStatusEntry`'s own `"type"`-discriminated-union
 * decoding technique, applied here to the `"kind"` tag
 * `GitStashApplyOutcomeWire` uses instead). Shared by both bridge methods —
 * see `GitStashApplyOutcome`'s own doc comment for why the wire shape is
 * identical for both. */
export function decodeGitStashApplyOutcome(
	value: unknown,
): GitStashApplyOutcome {
	return sanitizedDecode(() => {
		if (!isPlainObject(value) || typeof value.kind !== "string") {
			return violation();
		}
		if (value.kind === "applied") {
			if (!hasExactKeys(value, ["kind"])) {
				return violation();
			}
			rejectProxyObject(value);
			return Object.freeze({ kind: "applied" as const });
		}
		if (value.kind === "conflict") {
			if (!hasExactKeys(value, ["kind", "conflictedPaths"])) {
				return violation();
			}
			const conflictedPaths = ownObjectArraySnapshot(
				value.conflictedPaths,
				MAX_GIT_STASH_CONFLICTED_PATHS,
				(path) => (typeof path === "string" ? path : violation()),
			);
			const outcome = { kind: "conflict" as const, conflictedPaths };
			rejectProxyObject(value);
			return Object.freeze(outcome);
		}
		return violation();
	});
}

// --- F090 S5: worktree (`git::worktree`) -------------------------------------

/** Mirrors `src-tauri/src/git/worktree.rs`'s own `MAX_WORKTREE_ENTRIES`
 * (10,000) — this decode-side ceiling exists only to reject a structurally
 * hostile/runaway payload, with generous headroom above the real server-side
 * cap, mirroring `MAX_GIT_STASH_ENTRIES`'s identical rationale. */
const MAX_GIT_WORKTREE_ENTRIES = 20_000;
/** Mirrors `worktree::MAX_WORKTREE_COMMIT_ISH_BYTES`/`dto.rs`'s own
 * independent copy — this frontend codec's own third independent copy, the
 * same "defense in depth, each layer re-validates" reason
 * `MAX_GIT_STASH_MESSAGE_CHARS` above validates a field the Rust side will
 * also independently reject. */
const MAX_GIT_WORKTREE_COMMIT_ISH_CHARS = 4_096;
/** Mirrors `path_policy::MAX_RELATIVE_PATH_BYTES`/`dto.rs`'s own
 * `MAX_WORKTREE_CHILD_SEGMENT_BYTES` — this codec's own independent copy. */
const MAX_GIT_WORKTREE_CHILD_SEGMENT_CHARS = 4_096;
/** Mirrors `dto.rs`'s own `MAX_WORKTREE_PATH_BYTES` — worktree paths are
 * absolute filesystem paths, not repository-relative, so `MAX_GIT_PATH_CHARS`
 * (sized for a tracked file path) is not reused here; this is its own,
 * differently-scoped ceiling. */
const MAX_GIT_WORKTREE_PATH_CHARS = 4_096;

function decodeGitWorktreeHeadState(value: unknown): GitWorktreeHeadState {
	if (!isPlainObject(value) || typeof value.kind !== "string") {
		return violation();
	}
	if (value.kind === "branch") {
		if (!hasExactKeys(value, ["kind", "refName"])) {
			return violation();
		}
		if (
			typeof value.refName !== "string" ||
			value.refName.length > MAX_GIT_PATH_CHARS
		) {
			return violation();
		}
		const state = { kind: "branch" as const, refName: value.refName };
		rejectProxyObject(value);
		return Object.freeze(state);
	}
	if (value.kind === "detached") {
		if (!hasExactKeys(value, ["kind"])) {
			return violation();
		}
		rejectProxyObject(value);
		return Object.freeze({ kind: "detached" as const });
	}
	if (value.kind === "bare") {
		if (!hasExactKeys(value, ["kind"])) {
			return violation();
		}
		rejectProxyObject(value);
		return Object.freeze({ kind: "bare" as const });
	}
	return violation();
}

function decodeGitWorktreeEntry(value: unknown): GitWorktreeEntry {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, [
			"path",
			"headSha",
			"headState",
			"lockReason",
			"prunableReason",
			"isMain",
		])
	) {
		return violation();
	}
	if (
		typeof value.path !== "string" ||
		value.path.length > MAX_GIT_WORKTREE_PATH_CHARS
	) {
		return violation();
	}
	if (value.headSha !== null && !isGitBlameSha(value.headSha)) {
		return violation();
	}
	if (value.lockReason !== null && typeof value.lockReason !== "string") {
		return violation();
	}
	if (
		value.prunableReason !== null &&
		typeof value.prunableReason !== "string"
	) {
		return violation();
	}
	if (typeof value.isMain !== "boolean") {
		return violation();
	}
	const headState = decodeGitWorktreeHeadState(value.headState);
	const entry = {
		path: value.path,
		headSha: value.headSha,
		headState,
		lockReason: value.lockReason,
		prunableReason: value.prunableReason,
		isMain: value.isMain,
	};
	rejectProxyObject(value);
	return Object.freeze(entry);
}

/** Decodes a `git_worktree_list` response: an own-data, exactly
 * `{ entries, truncated }` object. `git_worktree_list` itself takes no
 * request payload at all (mirrors `git_refs_list`'s/`git_stash_list`'s own
 * `{}` shape) — there is no corresponding `frozenGitWorktreeListRequest`. */
export function decodeGitWorktreeListResult(
	value: unknown,
): GitWorktreeListResult {
	return sanitizedDecode(() => {
		if (
			!isPlainObject(value) ||
			!hasExactKeys(value, ["entries", "truncated"])
		) {
			return violation();
		}
		if (typeof value.truncated !== "boolean") {
			return violation();
		}
		const entries = ownObjectArraySnapshot(
			value.entries,
			MAX_GIT_WORKTREE_ENTRIES,
			decodeGitWorktreeEntry,
		);
		const result = { entries, truncated: value.truncated };
		rejectProxyObject(value);
		return Object.freeze(result);
	});
}

function gitWorktreeAddRequestInvalid(): never {
	return requestViolation(
		"GIT_WORKTREE_ADD_INVALID_REQUEST",
		"The new worktree's folder name or requested revision is invalid.",
	);
}

/** Builds a frozen `git_worktree_add` request. `childSegment` must be a
 * non-empty, bounded-length string with no `/` (a genuinely single path
 * segment — see `src-tauri/src/git/worktree.rs`'s own doc comment for why
 * this check happens here *and* again server-side); `commitIsh`, when not
 * `null`, must be non-empty, bounded, and must not begin with `-` (mirrors
 * `worktree::validate_worktree_commit_ish`'s own defense-in-depth check
 * against the exact injection surface that module's own doc comment
 * describes). */
export function frozenGitWorktreeAddRequest(
	childSegment: unknown,
	detach: unknown,
	commitIsh: unknown,
): Readonly<{
	childSegment: string;
	detach: boolean;
	commitIsh: string | null;
}> {
	if (
		typeof childSegment !== "string" ||
		childSegment.length === 0 ||
		childSegment.length > MAX_GIT_WORKTREE_CHILD_SEGMENT_CHARS ||
		childSegment.includes("/")
	) {
		return gitWorktreeAddRequestInvalid();
	}
	if (typeof detach !== "boolean") {
		return gitWorktreeAddRequestInvalid();
	}
	if (commitIsh !== null) {
		if (
			typeof commitIsh !== "string" ||
			commitIsh.length === 0 ||
			commitIsh.length > MAX_GIT_WORKTREE_COMMIT_ISH_CHARS ||
			commitIsh.startsWith("-")
		) {
			return gitWorktreeAddRequestInvalid();
		}
	}
	return Object.freeze({ childSegment, detach, commitIsh });
}

/** Decodes a `git_worktree_add` response — an own-data, exactly
 * `{ kind: "added", path }` or `{ kind: "pickerCancelled" }` object, mirroring
 * `decodeGitStashApplyOutcome`'s own `"kind"`-discriminated decoding
 * technique. */
export function decodeGitWorktreeAddOutcome(
	value: unknown,
): GitWorktreeAddOutcome {
	return sanitizedDecode(() => {
		if (!isPlainObject(value) || typeof value.kind !== "string") {
			return violation();
		}
		if (value.kind === "added") {
			if (!hasExactKeys(value, ["kind", "path"])) {
				return violation();
			}
			if (
				typeof value.path !== "string" ||
				value.path.length > MAX_GIT_WORKTREE_PATH_CHARS
			) {
				return violation();
			}
			const outcome = { kind: "added" as const, path: value.path };
			rejectProxyObject(value);
			return Object.freeze(outcome);
		}
		if (value.kind === "pickerCancelled") {
			if (!hasExactKeys(value, ["kind"])) {
				return violation();
			}
			rejectProxyObject(value);
			return Object.freeze({ kind: "pickerCancelled" as const });
		}
		return violation();
	});
}

function gitWorktreeRemoveRequestInvalid(): never {
	return requestViolation(
		"GIT_WORKTREE_REMOVE_INVALID_REQUEST",
		"The worktree path is empty or too large.",
	);
}

export function frozenGitWorktreeRemoveRequest(
	path: unknown,
	force: unknown,
): Readonly<{ path: string; force: boolean }> {
	if (
		typeof path !== "string" ||
		path.length === 0 ||
		path.length > MAX_GIT_WORKTREE_PATH_CHARS
	) {
		return gitWorktreeRemoveRequestInvalid();
	}
	if (typeof force !== "boolean") {
		return gitWorktreeRemoveRequestInvalid();
	}
	return Object.freeze({ path, force });
}

const GIT_WORKTREE_REMOVE_OUTCOMES = new Set<GitWorktreeRemoveOutcome>([
	"removed",
	"needsForce",
]);

/** Decodes a `git_worktree_remove` response: a bare own-data string, one of
 * the exact two audited outcomes — mirrors `decodeGitStashPushOutcome`'s own
 * "fieldless outcome serializes as a plain string" convention. */
export function decodeGitWorktreeRemoveOutcome(
	value: unknown,
): GitWorktreeRemoveOutcome {
	return sanitizedDecode(() => {
		if (
			typeof value !== "string" ||
			!GIT_WORKTREE_REMOVE_OUTCOMES.has(value as GitWorktreeRemoveOutcome)
		) {
			return violation();
		}
		return value as GitWorktreeRemoveOutcome;
	});
}
