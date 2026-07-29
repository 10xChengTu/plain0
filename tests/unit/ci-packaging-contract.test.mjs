import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { validateMacOSPackagingWorkflow } from "../../scripts/plain/ci-packaging-contract.mjs";

const cleanWorkflow = `name: Plain CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm check

  build-macos:
    needs: check
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm tauri:build
`;

describe("validateMacOSPackagingWorkflow", () => {
	it("accepts a workflow with a real macOS tauri build job", () => {
		expect(validateMacOSPackagingWorkflow(cleanWorkflow)).toEqual([]);
	});

	it("validates the real, currently-committed CI workflow with zero violations", () => {
		const realWorkflow = readFileSync(
			new URL("../../.github/workflows/plain-ci.yml", import.meta.url),
			"utf8",
		);
		expect(validateMacOSPackagingWorkflow(realWorkflow)).toEqual([]);
	});

	it("rejects a workflow with no macos-* runner at all", () => {
		const noMacJob = `jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm check
`;
		expect(validateMacOSPackagingWorkflow(noMacJob)).toEqual([
			"no job in .github/workflows/plain-ci.yml runs on a macos-* runner -- F120 S6 requires at least one real macOS packaging job",
		]);
	});

	it("rejects a macOS job that never runs a real tauri build", () => {
		const macJobWithoutBuild = `jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm check

  build-macos:
    runs-on: macos-latest
    steps:
      - run: pnpm check
`;
		expect(validateMacOSPackagingWorkflow(macJobWithoutBuild)).toEqual([
			'the macOS CI job does not run a real `tauri build` -- a macos-* runner alone (e.g. one that only runs `pnpm check`) does not satisfy "macOS packages build in CI"',
		]);
	});

	it("does not credit a real build step that only appears in an unrelated, non-macOS job", () => {
		const buildInWrongJob = `jobs:
  build-macos:
    runs-on: macos-latest
    steps:
      - run: pnpm check

  unrelated:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm tauri:build
`;
		expect(validateMacOSPackagingWorkflow(buildInWrongJob)).toEqual([
			'the macOS CI job does not run a real `tauri build` -- a macos-* runner alone (e.g. one that only runs `pnpm check`) does not satisfy "macOS packages build in CI"',
		]);
	});

	it("accepts either the pnpm script or a direct tauri build invocation", () => {
		const directTauriBuild = `jobs:
  build-macos:
    runs-on: macos-latest
    steps:
      - run: pnpm exec tauri build
`;
		expect(validateMacOSPackagingWorkflow(directTauriBuild)).toEqual([]);
	});
});
