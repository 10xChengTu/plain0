import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { validateFeatureContract } from "../../scripts/plain/feature-contract.mjs";

const featureDocument = JSON.parse(
	await readFile(new URL("../../features.json", import.meta.url), "utf8"),
);
const progressDocument = await readFile(
	new URL("../../progress.md", import.meta.url),
	"utf8",
);

function cloneDocument() {
	return structuredClone(featureDocument);
}

function failuresAfter(mutate, progress = progressDocument) {
	const document = cloneDocument();
	mutate(document);
	return validateFeatureContract(document, progress).failures;
}

function expectRejected(mutate, progress) {
	expect(failuresAfter(mutate, progress).length).toBeGreaterThan(0);
}

describe("feature completion contract", () => {
	it("accepts the current schema v3 document and canonical progress WIP", () => {
		const result = validateFeatureContract(featureDocument, progressDocument);

		expect(result).toEqual({ failures: [], activeCount: 1 });
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.failures)).toBe(true);
	});

	it("rejects self-weakened roots, versions, WIP limits and invalid dates", () => {
		for (const value of [2, 4, "3", undefined]) {
			expectRejected((document) => {
				if (value === undefined) delete document.schemaVersion;
				else document.schemaVersion = value;
			});
		}
		for (const value of [0, 2, "1", undefined]) {
			expectRejected((document) => {
				if (value === undefined) delete document.wipLimit;
				else document.wipLimit = value;
			});
		}
		for (const value of [
			"",
			"2026-7-20",
			"2026-07-20T00:00:00Z",
			"2026-02-30",
			"2025-02-29",
		]) {
			expectRejected((document) => {
				document.updatedAt = value;
			});
		}
		expectRejected((document) => {
			document.completionEvidenceFields = ["commands"];
		});
		expect(
			validateFeatureContract(null, progressDocument).failures.length,
		).toBeGreaterThan(0);
		expect(
			validateFeatureContract([], progressDocument).failures.length,
		).toBeGreaterThan(0);
	});

	it("requires canonical unique feature metadata, acceptance and ordering", () => {
		for (const mutation of [
			(document) => {
				document.features[2].name = " ";
			},
			(document) => {
				document.features[2].name = document.features[1].name;
			},
			(document) => {
				document.features[2].acceptance[0] = " duplicate ";
			},
			(document) => {
				document.features[2].acceptance[1] = document.features[2].acceptance[0];
			},
			(document) => {
				document.features[2].extra = true;
			},
			(document) => {
				[document.features[2], document.features[3]] = [
					document.features[3],
					document.features[2],
				];
			},
			(document) => {
				document.features[2] = null;
			},
		]) {
			expectRejected(mutation);
		}
	});

	it("binds every complete acceptance to strict non-empty evidence", () => {
		for (const mutation of [
			(document) => {
				delete document.features[0].evidence.commands;
			},
			(document) => {
				document.features[0].evidence.commands = [];
			},
			(document) => {
				document.features[0].evidence.results[0] = " ";
			},
			(document) => {
				document.features[1].evidence.nativeScenarios = [];
			},
			(document) => {
				document.features[0].evidence.acceptanceResults.pop();
			},
			(document) => {
				document.features[0].evidence.acceptanceResults[0].acceptance =
					"A different exit condition";
			},
			(document) => {
				[
					document.features[0].acceptance[0],
					document.features[0].acceptance[1],
				] = [
					document.features[0].acceptance[1],
					document.features[0].acceptance[0],
				];
			},
			(document) => {
				document.features[0].evidence.acceptanceResults[0].result = "";
			},
			(document) => {
				document.features[0].evidence.acceptanceResults[0].extra = true;
			},
			(document) => {
				document.features[2].evidence = {};
			},
		]) {
			expectRejected(mutation);
		}

		const phaseZeroWithoutNative = cloneDocument();
		phaseZeroWithoutNative.features[0].evidence.nativeScenarios = [];
		expect(
			validateFeatureContract(phaseZeroWithoutNative, progressDocument)
				.failures,
		).toEqual([]);
		const noKnownPlatformGap = cloneDocument();
		noKnownPlatformGap.features[0].evidence.platformGaps = [];
		expect(
			validateFeatureContract(noKnownPlatformGap, progressDocument).failures,
		).toEqual([]);
	});

	it("derives phase, counts blocked work and requires the exact progress WIP", () => {
		expectRejected((document) => {
			document.currentPhase = 3;
		});
		expectRejected((document) => {
			document.features[5].status = "in_progress";
		});
		expectRejected(
			(document) => {
				document.features[0].status = "planned";
				delete document.features[0].evidence;
				document.features[4].status = "planned";
				document.currentPhase = 0;
			},
			progressDocument.replace(
				"- WIP：`F040` Quick Open, workspace search and replace。",
				"- WIP：无。",
			),
		);

		const blocked = cloneDocument();
		blocked.features[4].status = "blocked";
		blocked.features[4].blocker = "Waiting for an explicit external decision.";
		const blockedProgress = progressDocument;
		expect(validateFeatureContract(blocked, blockedProgress)).toMatchObject({
			failures: [],
			activeCount: 1,
		});
		blocked.features[4].blocker = " ";
		expect(
			validateFeatureContract(blocked, blockedProgress).failures.length,
		).toBeGreaterThan(0);

		const betweenItems = cloneDocument();
		betweenItems.features[4].status = "planned";
		const betweenItemsProgress = progressDocument.replace(
			"- WIP：`F040` Quick Open, workspace search and replace。",
			"- WIP：无。",
		);
		expect(
			validateFeatureContract(betweenItems, betweenItemsProgress),
		).toMatchObject({ failures: [], activeCount: 0 });

		for (const progress of [
			progressDocument.replace("`F040`", "`F050`"),
			progressDocument.replace(
				"- WIP：`F040` Quick Open, workspace search and replace。",
				"- WIP：无。",
			),
			progressDocument.replace("- WIP：", "- WIP:"),
			progressDocument.replace(
				"- WIP：`F040` Quick Open, workspace search and replace。",
				"- WIP：`F040` Quick Open, workspace search and replace。\n- WIP：`F040` Quick Open, workspace search and replace。",
			),
			progressDocument.replace("## 当前状态", "## 当前状态\n\n## 当前状态"),
		]) {
			expect(
				validateFeatureContract(featureDocument, progress).failures.length,
			).toBeGreaterThan(0);
		}
	});
});
