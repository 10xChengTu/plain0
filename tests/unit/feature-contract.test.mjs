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

/** Index of the single `in_progress` feature, and of the first `planned` one
 * after it. Derived rather than hard-coded: every WIP advance used to require
 * hand-bumping the literal indices in the WIP/blocked cases below, and
 * forgetting to do so failed this file in a way that looks like a real
 * contract regression but is only a stale fixture (it happened again when
 * `F080` closed and `F090` opened). Deriving them keeps each assertion
 * exactly as strong while making it survive the next advance. */
const ACTIVE_INDEX = featureDocument.features.findIndex(
	(feature) => feature.status === "in_progress",
);
const NEXT_PLANNED_INDEX_AFTER_ACTIVE = featureDocument.features.findIndex(
	(feature, index) => index > ACTIVE_INDEX && feature.status === "planned",
);
/** `F120`'s own closeout is the first time the active feature (`F130`) is
 * also the last entry in the whole list -- there is no `planned` feature
 * left after it to find. When that happens, fall back to any other real
 * feature index instead of crashing on `features[-1]`: the fixture below
 * only needs a *second* feature to flip to `in_progress` to exercise "more
 * than one active feature exceeds wipLimit", and that assertion does not
 * depend on the second feature's prior status. */
const NEXT_PLANNED_INDEX =
	NEXT_PLANNED_INDEX_AFTER_ACTIVE === -1
		? ACTIVE_INDEX === 0
			? 1
			: 0
		: NEXT_PLANNED_INDEX_AFTER_ACTIVE;
/** The exact `progress.md` WIP line the contract requires for the currently
 * active feature, rebuilt from `features.json` for the same reason. */
const WIP_LINE = `- WIP：\`${featureDocument.features[ACTIVE_INDEX].id}\` ${featureDocument.features[ACTIVE_INDEX].name}。`;

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
			document.currentPhase = 2;
		});
		expectRejected((document) => {
			document.features[NEXT_PLANNED_INDEX].status = "in_progress";
		});
		expectRejected(
			(document) => {
				document.features[0].status = "planned";
				delete document.features[0].evidence;
				document.features[ACTIVE_INDEX].status = "planned";
				document.currentPhase = 0;
			},
			progressDocument.replace(
				`- WIP：\`${featureDocument.features[ACTIVE_INDEX].id}\` ${featureDocument.features[ACTIVE_INDEX].name}。`,
				"- WIP：无。",
			),
		);

		const blocked = cloneDocument();
		blocked.features[ACTIVE_INDEX].status = "blocked";
		blocked.features[ACTIVE_INDEX].blocker =
			"Waiting for an explicit external decision.";
		const blockedProgress = progressDocument;
		expect(validateFeatureContract(blocked, blockedProgress)).toMatchObject({
			failures: [],
			activeCount: 1,
		});
		blocked.features[ACTIVE_INDEX].blocker = " ";
		expect(
			validateFeatureContract(blocked, blockedProgress).failures.length,
		).toBeGreaterThan(0);

		const betweenItems = cloneDocument();
		betweenItems.features[ACTIVE_INDEX].status = "planned";
		const betweenItemsProgress = progressDocument.replace(
			WIP_LINE,
			"- WIP：无。",
		);
		expect(
			validateFeatureContract(betweenItems, betweenItemsProgress),
		).toMatchObject({ failures: [], activeCount: 0 });

		for (const progress of [
			progressDocument.replace(
				`\`${featureDocument.features[ACTIVE_INDEX].id}\``,
				`\`${featureDocument.features[ACTIVE_INDEX - 1].id}\``,
			),
			progressDocument.replace(WIP_LINE, "- WIP：无。"),
			progressDocument.replace("- WIP：", "- WIP:"),
			progressDocument.replace(WIP_LINE, `${WIP_LINE}\n${WIP_LINE}`),
			progressDocument.replace("## 当前状态", "## 当前状态\n\n## 当前状态"),
		]) {
			expect(
				validateFeatureContract(featureDocument, progress).failures.length,
			).toBeGreaterThan(0);
		}
	});
});
