import { describe, expect, it } from "vitest";

import { createBrowserMockBridge } from "../../app/platform/tauri/browser-mock";
import {
	decodeGitHistoryMutationOutcome,
	decodeGitHistoryPreview,
	decodeGitHistoryState,
	frozenGitCherryPickRequest,
	frozenGitHistoryAbortRequest,
	frozenGitHistoryContinueRequest,
	frozenGitHistoryPreviewRequest,
	frozenGitMergeRequest,
	frozenGitRebaseRequest,
	frozenGitResetRequest,
	frozenGitRevertRequest,
} from "../../app/platform/tauri/git-codec";

const TARGET_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const PREVIEW_TOKEN = "c".repeat(64);

function previewPayload() {
	return {
		operation: "resetHard",
		targetSha: TARGET_SHA,
		headSha: HEAD_SHA,
		ahead: 2,
		behind: 1,
		workingTreePaths: ["working.txt"],
		stagedPaths: ["staged.txt"],
		conflictedPaths: [],
		pathsTruncated: false,
		sequencer: null,
		previewToken: PREVIEW_TOKEN,
	};
}

describe("F180 history-operation codecs", () => {
	it("strictly decodes and deeply freezes preview, state and conflict outcomes", () => {
		const preview = decodeGitHistoryPreview(previewPayload());
		expect(preview).toEqual(previewPayload());
		expect(Object.isFrozen(preview)).toBe(true);
		expect(Object.isFrozen(preview.workingTreePaths)).toBe(true);

		const state = decodeGitHistoryState({
			headSha: HEAD_SHA,
			sequencer: {
				kind: "merge",
				conflictedPaths: ["conflict.txt"],
				pathsTruncated: false,
			},
		});
		expect(Object.isFrozen(state)).toBe(true);
		expect(Object.isFrozen(state.sequencer)).toBe(true);
		expect(Object.isFrozen(state.sequencer?.conflictedPaths)).toBe(true);

		const outcome = decodeGitHistoryMutationOutcome({
			kind: "conflicts",
			state,
		});
		expect(outcome.kind).toBe("conflicts");
		expect(outcome.state.sequencer?.kind).toBe("merge");
		expect(Object.isFrozen(outcome)).toBe(true);
	});

	it.each([
		["extra preview key", { ...previewPayload(), nativePath: "/secret" }],
		[
			"bad preview token",
			{ ...previewPayload(), previewToken: "A".repeat(64) },
		],
		[
			"too many paths",
			{
				...previewPayload(),
				workingTreePaths: Array.from(
					{ length: 257 },
					(_, index) => `p${index}`,
				),
			},
		],
		[
			"completed with a sequencer",
			{
				kind: "completed",
				state: {
					headSha: HEAD_SHA,
					sequencer: {
						kind: "rebase",
						conflictedPaths: [],
						pathsTruncated: false,
					},
				},
			},
		],
		[
			"conflict outcome without paths",
			{
				kind: "conflicts",
				state: {
					headSha: HEAD_SHA,
					sequencer: {
						kind: "revert",
						conflictedPaths: [],
						pathsTruncated: false,
					},
				},
			},
		],
	] as const)("rejects malformed history payloads: %s", (name, payload) => {
		const decoder =
			name.includes("outcome") || name.startsWith("completed")
				? decodeGitHistoryMutationOutcome
				: decodeGitHistoryPreview;
		expect(() => decoder(payload)).toThrowError(
			"Native IPC returned a payload that violates the Plain git contract.",
		);
	});

	it("freezes every request and rejects forged operations, kinds, hashes and tokens", () => {
		const requests = [
			frozenGitHistoryPreviewRequest("merge", TARGET_SHA),
			frozenGitMergeRequest(TARGET_SHA, PREVIEW_TOKEN),
			frozenGitRebaseRequest(TARGET_SHA, PREVIEW_TOKEN),
			frozenGitCherryPickRequest(TARGET_SHA, PREVIEW_TOKEN),
			frozenGitRevertRequest(TARGET_SHA, PREVIEW_TOKEN),
			frozenGitResetRequest(TARGET_SHA, "hard", PREVIEW_TOKEN),
			frozenGitHistoryContinueRequest("rebase"),
			frozenGitHistoryAbortRequest("rebase"),
		];
		expect(requests.every(Object.isFrozen)).toBe(true);
		for (const invoke of [
			() => frozenGitHistoryPreviewRequest("interactiveRebase", TARGET_SHA),
			() => frozenGitMergeRequest(TARGET_SHA.toUpperCase(), PREVIEW_TOKEN),
			() => frozenGitRebaseRequest(TARGET_SHA, "d".repeat(63)),
			() => frozenGitResetRequest(TARGET_SHA, "keep", PREVIEW_TOKEN),
			() => frozenGitHistoryContinueRequest("reset"),
		]) {
			expect(invoke).toThrow();
		}
	});
});

describe("F180 browser history-operation simulation", () => {
	it("requires its own preview token, reports a conflict, and keeps Abort kind-bound", async () => {
		const bridge = createBrowserMockBridge({
			gitFixtureForTest: {
				status: {
					branch: { oid: HEAD_SHA, head: "main", upstream: null },
					entries: [],
				},
				historyConflictForTest: { merge: ["conflict.txt"] },
			},
		});
		const picked = await bridge.workspacePickRoots("add");
		await bridge.workspaceTrustGrant();
		const rootId = picked.snapshot.roots[0]!.rootId;

		const prepared = await bridge.gitHistoryPreview(
			"merge",
			TARGET_SHA,
			rootId,
		);
		await expect(
			bridge.gitMerge(TARGET_SHA, "d".repeat(64), rootId),
		).rejects.toMatchObject({ code: "GIT_HISTORY_PREVIEW_STALE" });
		const conflict = await bridge.gitMerge(
			TARGET_SHA,
			prepared.previewToken,
			rootId,
		);
		expect(conflict).toEqual({
			kind: "conflicts",
			state: {
				headSha: HEAD_SHA,
				sequencer: {
					kind: "merge",
					conflictedPaths: ["conflict.txt"],
					pathsTruncated: false,
				},
			},
		});
		await expect(
			bridge.gitHistoryAbort("rebase", rootId),
		).rejects.toMatchObject({ code: "GIT_HISTORY_OPERATION_KIND_CHANGED" });
		expect(await bridge.gitHistoryAbort("merge", rootId)).toEqual({
			kind: "completed",
			state: { headSha: HEAD_SHA, sequencer: null },
		});
	});
});
