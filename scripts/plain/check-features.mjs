import { readFile } from "node:fs/promises";

import { validateFeatureContract } from "./feature-contract.mjs";

const featureFile = new URL("../../features.json", import.meta.url);
const progressFile = new URL("../../progress.md", import.meta.url);

let document;
let progressText;
try {
	const [featureText, loadedProgress] = await Promise.all([
		readFile(featureFile, "utf8"),
		readFile(progressFile, "utf8"),
	]);
	document = JSON.parse(featureText);
	progressText = loadedProgress;
} catch (error) {
	console.error(
		`features.json: unable to load contract: ${error instanceof Error ? error.message : "unknown error"}`,
	);
	process.exitCode = 1;
}

if (document !== undefined && progressText !== undefined) {
	const result = validateFeatureContract(document, progressText);
	if (result.failures.length > 0) {
		for (const failure of result.failures) {
			console.error(`features.json: ${failure}`);
		}
		process.exitCode = 1;
	} else {
		console.log(
			`features.json: ${document.features.length} features, ${result.activeCount} active, WIP limit ${document.wipLimit}`,
		);
	}
}
