import type {
	GitBlobRev,
	GitBranch,
	GitBranchUpstream,
	GitDiffFileEntry,
	GitDiffFilesResult,
	GitDiffStatusKind,
	GitNetworkOperation,
	GitNetworkPreviewResult,
	GitRenameOrCopyKind,
	GitShowBlobResult,
	GitStatusEntry,
	GitStatusResult,
	GitSubmoduleState,
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
