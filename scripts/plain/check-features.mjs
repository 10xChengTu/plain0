import { readFile } from "node:fs/promises";

const featureFile = new URL("../../features.json", import.meta.url);
const document = JSON.parse(await readFile(featureFile, "utf8"));
const failures = [];

const fail = (message) => failures.push(message);
const statuses = new Set(["planned", "in_progress", "complete", "blocked"]);

if (!Number.isInteger(document.schemaVersion) || document.schemaVersion < 1) {
	fail("schemaVersion must be a positive integer");
}

if (!Number.isInteger(document.currentPhase) || document.currentPhase < 0) {
	fail("currentPhase must be a non-negative integer");
}

if (!Number.isInteger(document.wipLimit) || document.wipLimit < 1) {
	fail("wipLimit must be a positive integer");
}

if (
	!Array.isArray(document.completionEvidenceFields) ||
	document.completionEvidenceFields.length === 0
) {
	fail("completionEvidenceFields must be a non-empty array");
}

if (!Array.isArray(document.features) || document.features.length === 0) {
	fail("features must be a non-empty array");
}

const ids = new Set();
let activeCount = 0;
let previousSortKey = "";

for (const feature of document.features ?? []) {
	if (typeof feature.id !== "string" || !/^F\d{3}$/.test(feature.id)) {
		fail(`invalid feature id: ${String(feature.id)}`);
	} else if (ids.has(feature.id)) {
		fail(`duplicate feature id: ${feature.id}`);
	} else {
		ids.add(feature.id);
	}

	if (!Number.isInteger(feature.phase) || feature.phase < 0) {
		fail(`${feature.id}: phase must be a non-negative integer`);
	}

	if (!statuses.has(feature.status)) {
		fail(`${feature.id}: unsupported status ${String(feature.status)}`);
	}

	if (!Array.isArray(feature.acceptance) || feature.acceptance.length === 0) {
		fail(`${feature.id}: acceptance must be a non-empty array`);
	}

	if (feature.status === "in_progress") {
		activeCount += 1;
	}

	if (feature.status === "complete") {
		for (const field of document.completionEvidenceFields ?? []) {
			if (!Array.isArray(feature.evidence?.[field])) {
				fail(
					`${feature.id}: completion evidence field ${field} must be an array`,
				);
			}
		}
		if ((feature.evidence?.commands?.length ?? 0) === 0) {
			fail(`${feature.id}: completed feature must record validation commands`);
		}
		if ((feature.evidence?.results?.length ?? 0) === 0) {
			fail(`${feature.id}: completed feature must record validation results`);
		}
	}

	const sortKey = `${String(feature.phase).padStart(4, "0")}:${feature.id}`;
	if (previousSortKey !== "" && sortKey < previousSortKey) {
		fail(`${feature.id}: features must be sorted by phase and id`);
	}
	previousSortKey = sortKey;
}

if (activeCount > document.wipLimit) {
	fail(
		`active feature count ${activeCount} exceeds WIP limit ${document.wipLimit}`,
	);
}

if (failures.length > 0) {
	for (const failure of failures) {
		console.error(`features.json: ${failure}`);
	}
	process.exitCode = 1;
} else {
	console.log(
		`features.json: ${document.features.length} features, ${activeCount} active, WIP limit ${document.wipLimit}`,
	);
}
