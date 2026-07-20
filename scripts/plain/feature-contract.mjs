const ROOT_KEYS = Object.freeze([
	"schemaVersion",
	"updatedAt",
	"currentPhase",
	"wipLimit",
	"features",
]);
const FEATURE_KEYS = Object.freeze([
	"id",
	"name",
	"phase",
	"status",
	"acceptance",
]);
const EVIDENCE_KEYS = Object.freeze([
	"commands",
	"results",
	"nativeScenarios",
	"platformGaps",
	"acceptanceResults",
]);
const ACCEPTANCE_RESULT_KEYS = Object.freeze(["acceptance", "result"]);
const STATUSES = new Set(["planned", "in_progress", "complete", "blocked"]);
const ACTIVE_STATUSES = new Set(["in_progress", "blocked"]);

function isRecord(value) {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

function checkExactKeys(value, expected, context, fail) {
	if (!isRecord(value)) {
		fail(`${context} must be an object`);
		return false;
	}

	const actual = Object.keys(value).sort();
	const required = [...expected].sort();
	if (
		actual.length !== required.length ||
		actual.some((key, index) => key !== required[index])
	) {
		fail(`${context} must contain exactly: ${expected.join(", ")}`);
		return false;
	}
	return true;
}

function isCanonicalString(value) {
	return (
		typeof value === "string" && value.length > 0 && value === value.trim()
	);
}

function checkStringArray(value, context, fail, { nonEmpty = false } = {}) {
	if (!Array.isArray(value)) {
		fail(`${context} must be an array`);
		return false;
	}
	if (nonEmpty && value.length === 0) {
		fail(`${context} must not be empty`);
	}
	let valid = true;
	for (let index = 0; index < value.length; index += 1) {
		if (!isCanonicalString(value[index])) {
			fail(`${context}[${index}] must be a non-empty trimmed string`);
			valid = false;
		}
	}
	return valid;
}

function isValidDate(value) {
	if (typeof value !== "string") {
		return false;
	}
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (match === null) {
		return false;
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}

function currentStatusSection(progressText, fail) {
	if (typeof progressText !== "string") {
		fail("progress.md must be text");
		return undefined;
	}
	const headings = [...progressText.matchAll(/^## 当前状态$/gm)];
	if (headings.length !== 1) {
		fail("progress.md must contain exactly one 当前状态 section");
		return undefined;
	}
	const start = headings[0].index + headings[0][0].length;
	const remainder = progressText.slice(start);
	const nextHeading = /^## /m.exec(remainder);
	return nextHeading === null
		? remainder
		: remainder.slice(0, nextHeading.index);
}

function validateProgressWip(progressText, activeFeatures, fail) {
	const section = currentStatusSection(progressText, fail);
	if (section === undefined) {
		return;
	}
	const candidates = section
		.split(/\r?\n/u)
		.filter((line) => /^\s*-\s*WIP/u.test(line));
	if (candidates.length !== 1) {
		fail("progress.md 当前状态 must contain exactly one WIP line");
		return;
	}

	const expected =
		activeFeatures.length === 0
			? "- WIP：无。"
			: `- WIP：\`${activeFeatures[0].id}\` ${activeFeatures[0].name}。`;
	if (candidates[0] !== expected) {
		fail(`progress.md WIP must be exactly: ${expected}`);
	}
}

export function validateFeatureContract(document, progressText) {
	const failures = [];
	const fail = (message) => failures.push(message);

	if (!checkExactKeys(document, ROOT_KEYS, "features.json root", fail)) {
		return Object.freeze({ failures: Object.freeze(failures), activeCount: 0 });
	}

	if (document.schemaVersion !== 3) {
		fail("schemaVersion must be exactly 3");
	}
	if (!isValidDate(document.updatedAt)) {
		fail("updatedAt must be a real YYYY-MM-DD date");
	}
	if (!Number.isInteger(document.currentPhase) || document.currentPhase < 0) {
		fail("currentPhase must be a non-negative integer");
	}
	if (document.wipLimit !== 1) {
		fail("wipLimit must be exactly 1");
	}
	if (!Array.isArray(document.features) || document.features.length === 0) {
		fail("features must be a non-empty array");
		return Object.freeze({ failures: Object.freeze(failures), activeCount: 0 });
	}

	const ids = new Set();
	const names = new Set();
	const activeFeatures = [];
	let previousPhase = -1;
	let previousId = "";

	for (let index = 0; index < document.features.length; index += 1) {
		const feature = document.features[index];
		const context = `features[${index}]`;
		if (!isRecord(feature)) {
			fail(`${context} must be an object`);
			continue;
		}

		const status = feature.status;
		const expectedKeys =
			status === "complete"
				? [...FEATURE_KEYS, "evidence"]
				: status === "blocked"
					? [...FEATURE_KEYS, "blocker"]
					: FEATURE_KEYS;
		checkExactKeys(feature, expectedKeys, context, fail);

		if (typeof feature.id !== "string" || !/^F\d{3}$/.test(feature.id)) {
			fail(`${context}.id must match Fddd`);
		} else if (ids.has(feature.id)) {
			fail(`duplicate feature id: ${feature.id}`);
		} else {
			ids.add(feature.id);
		}

		if (!isCanonicalString(feature.name)) {
			fail(`${context}.name must be a non-empty trimmed string`);
		} else if (names.has(feature.name)) {
			fail(`duplicate feature name: ${feature.name}`);
		} else {
			names.add(feature.name);
		}

		if (!Number.isInteger(feature.phase) || feature.phase < 0) {
			fail(`${context}.phase must be a non-negative integer`);
		}
		if (!STATUSES.has(status)) {
			fail(`${context}.status is unsupported`);
		}
		if (ACTIVE_STATUSES.has(status)) {
			activeFeatures.push(feature);
		}
		if (status === "blocked" && !isCanonicalString(feature.blocker)) {
			fail(`${context}.blocker must be a non-empty trimmed string`);
		}

		if (!Array.isArray(feature.acceptance) || feature.acceptance.length === 0) {
			fail(`${context}.acceptance must be a non-empty array`);
		} else {
			const acceptance = new Set();
			for (
				let acceptanceIndex = 0;
				acceptanceIndex < feature.acceptance.length;
				acceptanceIndex += 1
			) {
				const value = feature.acceptance[acceptanceIndex];
				if (!isCanonicalString(value)) {
					fail(
						`${context}.acceptance[${acceptanceIndex}] must be a non-empty trimmed string`,
					);
				} else if (acceptance.has(value)) {
					fail(`${context}.acceptance contains a duplicate: ${value}`);
				} else {
					acceptance.add(value);
				}
			}
		}

		if (
			Number.isInteger(feature.phase) &&
			(previousPhase > feature.phase ||
				(previousPhase === feature.phase && previousId > feature.id))
		) {
			fail(`${context} is not sorted by numeric phase and id`);
		}
		if (Number.isInteger(feature.phase)) {
			previousPhase = feature.phase;
			previousId = typeof feature.id === "string" ? feature.id : "";
		}

		if (status !== "complete") {
			continue;
		}
		if (
			!checkExactKeys(
				feature.evidence,
				EVIDENCE_KEYS,
				`${context}.evidence`,
				fail,
			)
		) {
			continue;
		}
		checkStringArray(
			feature.evidence.commands,
			`${context}.evidence.commands`,
			fail,
			{
				nonEmpty: true,
			},
		);
		checkStringArray(
			feature.evidence.results,
			`${context}.evidence.results`,
			fail,
			{
				nonEmpty: true,
			},
		);
		checkStringArray(
			feature.evidence.nativeScenarios,
			`${context}.evidence.nativeScenarios`,
			fail,
			{ nonEmpty: feature.phase > 0 },
		);
		checkStringArray(
			feature.evidence.platformGaps,
			`${context}.evidence.platformGaps`,
			fail,
		);

		const acceptanceResults = feature.evidence.acceptanceResults;
		if (!Array.isArray(acceptanceResults)) {
			fail(`${context}.evidence.acceptanceResults must be an array`);
		} else if (
			!Array.isArray(feature.acceptance) ||
			acceptanceResults.length !== feature.acceptance.length
		) {
			fail(`${context}.evidence.acceptanceResults must map every acceptance`);
		} else {
			for (
				let resultIndex = 0;
				resultIndex < acceptanceResults.length;
				resultIndex += 1
			) {
				const result = acceptanceResults[resultIndex];
				const resultContext = `${context}.evidence.acceptanceResults[${resultIndex}]`;
				if (
					!checkExactKeys(result, ACCEPTANCE_RESULT_KEYS, resultContext, fail)
				) {
					continue;
				}
				if (result.acceptance !== feature.acceptance[resultIndex]) {
					fail(
						`${resultContext}.acceptance must equal acceptance[${resultIndex}]`,
					);
				}
				if (!isCanonicalString(result.result)) {
					fail(`${resultContext}.result must be a non-empty trimmed string`);
				}
			}
		}
	}

	if (activeFeatures.length > document.wipLimit) {
		fail(
			`active feature count ${activeFeatures.length} exceeds WIP limit ${document.wipLimit}`,
		);
	}
	const incompletePhases = document.features
		.filter((feature) => isRecord(feature) && feature.status !== "complete")
		.map((feature) => feature.phase)
		.filter((phase) => Number.isInteger(phase) && phase >= 0);
	const allPhases = document.features
		.map((feature) => (isRecord(feature) ? feature.phase : 0))
		.filter((phase) => Number.isInteger(phase) && phase >= 0);
	const completedPhases = document.features
		.filter((feature) => isRecord(feature) && feature.status === "complete")
		.map((feature) => feature.phase)
		.filter((phase) => Number.isInteger(phase) && phase >= 0);
	const expectedPhase =
		incompletePhases.length > 0
			? Math.min(...incompletePhases)
			: Math.max(...allPhases);
	if (document.currentPhase !== expectedPhase) {
		fail(`currentPhase must be the derived phase ${expectedPhase}`);
	}
	if (
		activeFeatures.length === 1 &&
		activeFeatures[0].phase !== document.currentPhase
	) {
		fail("the active feature phase must equal currentPhase");
	}
	if (
		completedPhases.length > 0 &&
		Math.max(...completedPhases) > document.currentPhase
	) {
		fail("currentPhase cannot precede an already completed feature phase");
	}

	validateProgressWip(progressText, activeFeatures, fail);
	return Object.freeze({
		failures: Object.freeze(failures),
		activeCount: activeFeatures.length,
	});
}
