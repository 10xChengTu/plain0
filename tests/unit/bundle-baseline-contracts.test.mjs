import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
	categories,
	classifyDebtSources,
	evaluateBundleBaseline,
	normalizeSource,
} from "../../scripts/plain/bundle-baseline-contracts.mjs";

const root = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);

async function realBaseline() {
	return JSON.parse(
		await readFile(path.join(root, "docs/bundle-baseline.json"), "utf8"),
	);
}

describe("normalizeSource", () => {
	it("strips pnpm's nested node_modules/.pnpm hashed segment and leading ../", () => {
		expect(
			normalizeSource(
				"../../node_modules/.pnpm/@codingame+monaco-vscode-api@35.0.1_patch_hash=abc/node_modules/@codingame/monaco-vscode-api/vscode/src/vs/workbench/contrib/chat/common/chatService.js",
			),
		).toBe(
			"node_modules/@codingame/monaco-vscode-api/vscode/src/vs/workbench/contrib/chat/common/chatService.js",
		);
	});

	it("normalizes backslashes", () => {
		expect(normalizeSource("a\\b\\c.js")).toBe("a/b/c.js");
	});
});

describe("new F110 S0 category classification (docs/research/2026-07-28-legacy-retirement.md decision point 4)", () => {
	it("classifies a notebook path under notebook, including the search-contribution outlier", () => {
		expect(
			categories.notebook(
				"node_modules/@codingame/monaco-vscode-api/vscode/src/vs/workbench/contrib/notebook/common/notebookService.js",
			),
		).toBe(true);
		expect(
			categories.notebook(
				"node_modules/@codingame/monaco-vscode-api/vscode/src/vs/workbench/contrib/search/common/notebookSearch.service.js",
			),
		).toBe(true);
	});

	it("classifies a tasks path under tasks", () => {
		expect(
			categories.tasks(
				"node_modules/@codingame/monaco-vscode-api/vscode/src/vs/workbench/contrib/tasks/common/taskService.service.js",
			),
		).toBe(true);
	});

	it("classifies a testing path under testing", () => {
		expect(
			categories.testing(
				"node_modules/@codingame/monaco-vscode-api/vscode/src/vs/workbench/contrib/testing/common/testService.service.js",
			),
		).toBe(true);
	});

	it("classifies real remote-development/tunnel paths under remote", () => {
		expect(
			categories.remote(
				"node_modules/@codingame/monaco-vscode-api/vscode/src/vs/platform/remote/common/remoteAuthorityResolver.js",
			),
		).toBe(true);
		expect(
			categories.remote(
				"node_modules/@codingame/monaco-vscode-api/vscode/src/vs/workbench/services/remote/common/tunnelModel.js",
			),
		).toBe(true);
		expect(
			categories.remote(
				"node_modules/@codingame/monaco-vscode-api/vscode/src/vs/workbench/services/userDataProfile/common/remoteUserDataProfiles.service.js",
			),
		).toBe(true);
	});

	it("does NOT classify remoteCodingAgentsService.service.js under remote -- its content is AI/Agent, not remote development", () => {
		const source =
			"node_modules/@codingame/monaco-vscode-api/vscode/src/vs/workbench/contrib/remoteCodingAgents/common/remoteCodingAgentsService.service.js";
		expect(categories.remote(source)).toBe(false);
		expect(categories.chatAgent(source)).toBe(true);
	});

	it("does NOT classify configuration-service-override's recentRemoteFolderPruner.js under remote -- it is a real, currently-depended-on contribution, not remote-development debt", () => {
		const source =
			"node_modules/@codingame/monaco-vscode-configuration-service-override/vscode/src/vs/workbench/contrib/workspaces/browser/recentRemoteFolderPruner.js";
		for (const [name, matches] of Object.entries(categories)) {
			expect(matches(source), `expected ${name} not to match ${source}`).toBe(
				false,
			);
		}
	});

	it("classifies languagePacks, languageDetection and treeSitter paths, including the standalone treeSitter filename outlier", () => {
		expect(
			categories.languagePacks(
				"node_modules/@codingame/monaco-vscode-api/vscode/src/vs/platform/languagePacks/common/languagePacks.service.js",
			),
		).toBe(true);
		expect(
			categories.languageDetection(
				"node_modules/@codingame/monaco-vscode-api/vscode/src/vs/workbench/services/languageDetection/common/languageDetectionWorkerService.js",
			),
		).toBe(true);
		expect(
			categories.treeSitter(
				"node_modules/@codingame/monaco-vscode-api/vscode/src/vs/editor/common/model/tokens/treeSitter/treeSitterTree.js",
			),
		).toBe(true);
		expect(
			categories.treeSitter(
				"node_modules/@codingame/monaco-vscode-api/vscode/src/vs/editor/standalone/browser/standaloneTreeSitterLibraryService.js",
			),
		).toBe(true);
	});

	it("does not let any new category collide with an ordinary, unrelated source path", () => {
		const ordinary =
			"node_modules/@codingame/monaco-vscode-search-service-override/vscode/src/vs/workbench/contrib/search/browser/searchView.js";
		for (const [name, matches] of Object.entries(categories)) {
			expect(
				matches(ordinary),
				`expected ${name} not to match ${ordinary}`,
			).toBe(false);
		}
	});
});

describe("classifyDebtSources", () => {
	it("matches the real, checked-in baseline exactly (F110 S0 measurement)", async () => {
		const baseline = await realBaseline();
		const sortedSources = baseline.debtSources
			.map((entry) => entry.source)
			.sort();
		const { byCategory, debtSources } = classifyDebtSources(sortedSources);
		expect(debtSources).toEqual(sortedSources);
		for (const [name, ceiling] of Object.entries(baseline.categoryCeilings)) {
			expect(byCategory[name]).toHaveLength(ceiling);
		}
	});
});

describe("evaluateBundleBaseline ratchet (docs/research/2026-07-28-legacy-retirement.md decision point 5)", () => {
	it("passes against the real, unmodified baseline with zero failures", async () => {
		const baseline = await realBaseline();
		const sortedSources = baseline.debtSources
			.map((entry) => entry.source)
			.sort();
		const { failures } = evaluateBundleBaseline(sortedSources, baseline);
		expect(failures).toEqual([]);
	});

	it("fails when a category gains a source path never catalogued in debtSources -- a same-count swap is not enough to hide it", async () => {
		const baseline = await realBaseline();
		const sortedSources = baseline.debtSources
			.map((entry) => entry.source)
			.sort();
		// Simulate a category "rising": one previously-untracked chatAgent-
		// shaped source appears in the real bundle. Also drop one already-known
		// chatAgent source so the raw *count* stays exactly the same as the
		// baseline ceiling -- proving this is caught by set membership, not
		// just by a numeric ceiling comparison. (F110 S3 cleared `mcp` to a
		// ceiling of 0, so it no longer has a member to swap out this way;
		// `chatAgent` is the category this same scenario now exercises, and
		// still has a real member set thanks to its own non-zero floor.)
		const knownChatAgentSource = baseline.debtSources.find(
			(entry) => entry.category === "chatAgent",
		).source;
		const grownSources = sortedSources
			.filter((source) => source !== knownChatAgentSource)
			.concat(
				"node_modules/@codingame/monaco-vscode-api/vscode/src/vs/workbench/contrib/chat/common/chatNeverSeenBefore.service.js",
			)
			.sort();
		const { failures, actual } = evaluateBundleBaseline(grownSources, baseline);
		expect(actual.categoryCounts.chatAgent).toBe(
			baseline.categoryCeilings.chatAgent,
		);
		expect(failures).toContain(
			"bundle baseline chatAgent contains an untracked debt source: node_modules/@codingame/monaco-vscode-api/vscode/src/vs/workbench/contrib/chat/common/chatNeverSeenBefore.service.js",
		);
	});

	it("fails when a category's real count exceeds its recorded ceiling", async () => {
		const baseline = await realBaseline();
		const sortedSources = baseline.debtSources
			.map((entry) => entry.source)
			.sort();
		const shrunkCeilingBaseline = {
			...baseline,
			categoryCeilings: {
				...baseline.categoryCeilings,
				chatAgent: baseline.categoryCeilings.chatAgent - 1,
			},
		};
		const { failures } = evaluateBundleBaseline(
			sortedSources,
			shrunkCeilingBaseline,
		);
		expect(failures).toContain(
			`bundle baseline chatAgent ceiling exceeded: expected <= ${
				baseline.categoryCeilings.chatAgent - 1
			}, got ${baseline.categoryCeilings.chatAgent}`,
		);
	});

	it("passes a category decrease with zero failures and no baseline edit required", async () => {
		const baseline = await realBaseline();
		const sortedSources = baseline.debtSources
			.map((entry) => entry.source)
			.sort();
		// `notebook` (not `testing`/`tasks`, both zeroed out by F110 S6, which
		// would leave nothing to remove) is used here purely as an example
		// category that still has both a positive ceiling and at least one
		// catalogued debt source to drop -- the assertion below is generic to
		// any such category, not specific to notebooks.
		const knownNotebookSource = baseline.debtSources.find(
			(entry) => entry.category === "notebook",
		).source;
		const shrunkSources = sortedSources.filter(
			(source) => source !== knownNotebookSource,
		);
		// Deliberately reuse the unmodified real baseline -- decision point 5:
		// "下降则无需改基线即可通过".
		const { failures, actual } = evaluateBundleBaseline(
			shrunkSources,
			baseline,
		);
		expect(failures).toEqual([]);
		expect(actual.categoryCounts.notebook).toBe(
			baseline.categoryCeilings.notebook - 1,
		);
	});

	it("fails when a real category has no recorded ceiling at all", async () => {
		const baseline = await realBaseline();
		const sortedSources = baseline.debtSources
			.map((entry) => entry.source)
			.sort();
		const { categoryCeilings, ...rest } = baseline;
		const { chatAgent: _omitted, ...remainingCeilings } = categoryCeilings;
		const { failures } = evaluateBundleBaseline(sortedSources, {
			...rest,
			categoryCeilings: remainingCeilings,
		});
		expect(failures).toContain(
			"bundle baseline is missing a categoryCeilings entry for category: chatAgent",
		);
	});
});
