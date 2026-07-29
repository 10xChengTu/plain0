// `F120` S6/S7 (`docs/research/2026-07-29-branding-packaging.md` "结论 5",
// "需要新增的 AST 契约" item 5, main-session ruling point 7): before this
// slice, `.github/workflows/plain-ci.yml` had a single `ubuntu-latest` job
// that ran `pnpm check` and the browser E2E suite -- it never once invoked
// `tauri build`, on any platform. This module locks in the fix (a real
// macOS packaging job) and, just as importantly, its own *scope*: the
// ruling was explicit that CI packaging should gain macOS only for now,
// not all three platforms in one step, because the existing CI had never
// run a real `tauri build` even once and stacking three platforms' worth
// of unknown, unpreviewable failures into the same first run would make
// them much harder to triage. Nothing here asserts a windows-latest or a
// second ubuntu-latest packaging job exists -- that would be over-scoped
// relative to what was actually decided and shipped, not a stricter check.
//
// This is intentionally a small, hand-rolled text scan rather than a real
// YAML parser: no YAML-parsing dependency exists in this project (checked
// before writing this), and a general parser would be disproportionate for
// validating one small, hand-authored workflow file with a stable,
// 2-space-indented job-name style. `splitIntoJobBlocks` segments the
// `jobs:` section by top-level job name so the "real build step" check is
// scoped to *the same job* that declares the macOS runner, not merely
// "somewhere in the file" -- a job that only runs `pnpm check` on macOS
// while an unrelated job elsewhere mentions `tauri build` in a comment
// would not satisfy this.
function splitIntoJobBlocks(yamlText) {
	const lines = yamlText.split("\n");
	const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line));
	if (jobsIndex === -1) {
		return [];
	}
	const blocks = [];
	let current = null;
	for (const line of lines.slice(jobsIndex + 1)) {
		const jobNameMatch = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
		if (jobNameMatch) {
			if (current) {
				blocks.push(current);
			}
			current = { name: jobNameMatch[1], lines: [line] };
			continue;
		}
		if (current) {
			current.lines.push(line);
		}
	}
	if (current) {
		blocks.push(current);
	}
	return blocks.map((block) => ({
		name: block.name,
		text: block.lines.join("\n"),
	}));
}

const MACOS_RUNNER_PATTERN = /runs-on:\s*macos-[\w.-]+/;
const REAL_TAURI_BUILD_STEP_PATTERN =
	/\bpnpm (?:run )?tauri:build\b|\btauri build\b/;

export function validateMacOSPackagingWorkflow(yamlText) {
	const jobs = splitIntoJobBlocks(yamlText);
	const macJobs = jobs.filter((job) => MACOS_RUNNER_PATTERN.test(job.text));
	if (macJobs.length === 0) {
		return [
			"no job in .github/workflows/plain-ci.yml runs on a macos-* runner -- F120 S6 requires at least one real macOS packaging job",
		];
	}
	const hasRealBuildStep = macJobs.some((job) =>
		REAL_TAURI_BUILD_STEP_PATTERN.test(job.text),
	);
	if (!hasRealBuildStep) {
		return [
			'the macOS CI job does not run a real `tauri build` -- a macos-* runner alone (e.g. one that only runs `pnpm check`) does not satisfy "macOS packages build in CI"',
		];
	}
	return [];
}
