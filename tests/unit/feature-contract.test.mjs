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
/** The exact `progress.md` WIP line the contract requires for the current
 * state, rebuilt from `features.json` for the same reason. `F130` completing
 * leaves every feature `complete` and `ACTIVE_INDEX` at -1 (there is no
 * `in_progress` feature left at all) -- the real, expected terminal state
 * once every feature in the list is done -- so the line the contract
 * requires in that state is the explicit "no WIP" sentinel rather than a
 * feature reference. */
const WIP_LINE =
	ACTIVE_INDEX === -1
		? "- WIP：无。"
		: `- WIP：\`${featureDocument.features[ACTIVE_INDEX].id}\` ${featureDocument.features[ACTIVE_INDEX].name}。`;

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

		/** Derived, not hardcoded, for the same reason `ACTIVE_INDEX` is: once
		 * every feature is `complete` (`F130`'s own terminal state) there is no
		 * `in_progress`/`blocked` feature left and the real active count is 0,
		 * not the 1 every prior feature's own WIP slice had. */
		const expectedActiveCount = featureDocument.features.filter(
			(feature) =>
				feature.status === "in_progress" || feature.status === "blocked",
		).length;
		expect(result).toEqual({ failures: [], activeCount: expectedActiveCount });
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
				if (ACTIVE_INDEX !== -1) {
					document.features[ACTIVE_INDEX].status = "planned";
					delete document.features[ACTIVE_INDEX].evidence;
				}
				document.currentPhase = 0;
			},
			progressDocument.replace(WIP_LINE, "- WIP：无。"),
		);

		/** Blocked and between-items both need *some* real feature to
		 * synthetically toggle away from `complete`, to keep exercising the
		 * same invariants once every feature in the list really is complete
		 * (`ACTIVE_INDEX === -1`, `F130`'s own terminal state, with no
		 * `in_progress` feature left to reuse directly). Falls back to the
		 * last feature: its phase already equals `currentPhase`, so flipping
		 * just its own status can never itself trip the phase-derivation or
		 * phase-regression checks exercised elsewhere in this file. Deleting
		 * `evidence` unconditionally is safe either way -- a no-op when the
		 * feature was already non-`complete` (the pre-`F130` in_progress
		 * case), and required when it was `complete` (the post-`F130` case). */
		const syntheticIndex =
			ACTIVE_INDEX === -1 ? featureDocument.features.length - 1 : ACTIVE_INDEX;

		const blocked = cloneDocument();
		blocked.features[syntheticIndex].status = "blocked";
		delete blocked.features[syntheticIndex].evidence;
		blocked.features[syntheticIndex].blocker =
			"Waiting for an explicit external decision.";
		const blockedProgress =
			ACTIVE_INDEX === -1
				? progressDocument.replace(
						WIP_LINE,
						`- WIP：\`${blocked.features[syntheticIndex].id}\` ${blocked.features[syntheticIndex].name}。`,
					)
				: progressDocument;
		expect(validateFeatureContract(blocked, blockedProgress)).toMatchObject({
			failures: [],
			activeCount: 1,
		});
		blocked.features[syntheticIndex].blocker = " ";
		expect(
			validateFeatureContract(blocked, blockedProgress).failures.length,
		).toBeGreaterThan(0);

		const betweenItems = cloneDocument();
		betweenItems.features[syntheticIndex].status = "planned";
		delete betweenItems.features[syntheticIndex].evidence;
		const betweenItemsProgress = progressDocument.replace(
			WIP_LINE,
			"- WIP：无。",
		);
		expect(
			validateFeatureContract(betweenItems, betweenItemsProgress),
		).toMatchObject({ failures: [], activeCount: 0 });

		for (const progress of [
			ACTIVE_INDEX === -1
				? progressDocument.replace(
						"- WIP：无。",
						`- WIP：\`${featureDocument.features[0].id}\` ${featureDocument.features[0].name}。`,
					)
				: progressDocument.replace(
						`\`${featureDocument.features[ACTIVE_INDEX].id}\``,
						`\`${featureDocument.features[ACTIVE_INDEX - 1].id}\``,
					),
			ACTIVE_INDEX === -1
				? progressDocument.replace("- WIP：无。", "- WIP：无")
				: progressDocument.replace(WIP_LINE, "- WIP：无。"),
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
