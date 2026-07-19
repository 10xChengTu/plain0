import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
	auditedWorkbenchPatchPaths,
	validateWorkbenchPatchSet,
} from "../../scripts/plain/workbench-patch-contracts.mjs";

const root = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);

async function baseline() {
	const patchSources = new Map(
		await Promise.all(
			auditedWorkbenchPatchPaths.map(async (patchPath) => [
				patchPath,
				await readFile(path.join(root, patchPath), "utf8"),
			]),
		),
	);
	return {
		workspaceManifest: await readFile(
			path.join(root, "pnpm-workspace.yaml"),
			"utf8",
		),
		lockfile: await readFile(path.join(root, "pnpm-lock.yaml"), "utf8"),
		patchSources,
	};
}

describe("exact Workbench patch contracts", () => {
	it("accepts only the checked-in five-package patch and lock graph", async () => {
		expect(validateWorkbenchPatchSet(await baseline())).toEqual([]);
	});

	it("rejects a marker-preserving API baseline source downgrade", async () => {
		const input = await baseline();
		const patchPath = "patches/@codingame__monaco-vscode-api@35.0.1.patch";
		input.patchSources.set(
			patchPath,
			input.patchSources
				.get(patchPath)
				.replace('Symbol("plainReadReceipt")', '"plainReadReceipt"'),
		);
		expect(validateWorkbenchPatchSet(input)).toContain(
			`${patchPath} differs from its exact audited SHA-256`,
		);
	});

	it("rejects an intrinsic-brand bypass even when the receipt marker remains", async () => {
		const input = await baseline();
		const patchPath =
			"patches/@codingame__monaco-vscode-files-service-override@35.0.1.patch";
		input.patchSources.set(
			patchPath,
			input.patchSources
				.get(patchPath)
				.replace(
					"Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, [])",
					"value.byteLength",
				),
		);
		expect(validateWorkbenchPatchSet(input)).toContain(
			`${patchPath} differs from its exact audited SHA-256`,
		);
	});

	it("rejects added package files or hunks instead of trusting markers", async () => {
		const input = await baseline();
		const patchPath =
			"patches/@codingame__monaco-vscode-files-service-override@35.0.1.patch";
		input.patchSources.set(
			patchPath,
			`${input.patchSources.get(patchPath)}diff --git a/extra.js b/extra.js\n@@ -1 +1 @@\n-old\n+new\n`,
		);
		expect(validateWorkbenchPatchSet(input)).toContain(
			`${patchPath} differs from its exact package/file/hunk manifest`,
		);
	});

	it("rejects manifest rerouting and stale lock patch hashes", async () => {
		const rerouted = await baseline();
		rerouted.workspaceManifest = rerouted.workspaceManifest.replace(
			"patches/@codingame__monaco-vscode-files-service-override@35.0.1.patch",
			"patches/@codingame__monaco-vscode-api@35.0.1.patch",
		);
		expect(validateWorkbenchPatchSet(rerouted)).toContain(
			"pnpm-workspace.yaml must map @codingame/monaco-vscode-files-service-override@35.0.1 to its exact audited patch once",
		);

		const stale = await baseline();
		stale.lockfile = stale.lockfile.replace(
			"5aafc3e41fc13c7e72c60da8b48893b4b5c5ed14883f6f669238ae62aadc8aec",
			"0".repeat(64),
		);
		expect(validateWorkbenchPatchSet(stale)).toContain(
			"pnpm-lock.yaml must pin @codingame/monaco-vscode-files-service-override@35.0.1 to its audited patch hash",
		);
	});

	it("rejects extra patchedDependencies entries in either top-level mapping", async () => {
		const manifestExtra = await baseline();
		manifestExtra.workspaceManifest = manifestExtra.workspaceManifest.replace(
			"patchedDependencies:\n",
			"patchedDependencies:\n  '@example/extra@1.0.0': patches/extra.patch\n",
		);
		expect(validateWorkbenchPatchSet(manifestExtra)).toContain(
			"pnpm-workspace.yaml top-level patchedDependencies must be the exact audited five-entry closed set",
		);

		const lockExtra = await baseline();
		lockExtra.lockfile = lockExtra.lockfile.replace(
			"patchedDependencies:\n",
			`patchedDependencies:\n  '@example/extra@1.0.0': ${"f".repeat(64)}\n`,
		);
		expect(validateWorkbenchPatchSet(lockExtra)).toContain(
			"pnpm-lock.yaml top-level patchedDependencies must be the exact audited five-entry closed set",
		);
	});

	it("rejects duplicate patchedDependencies headers", async () => {
		const manifestDuplicate = await baseline();
		manifestDuplicate.workspaceManifest += "\npatchedDependencies:\n";
		expect(validateWorkbenchPatchSet(manifestDuplicate)).toContain(
			"pnpm-workspace.yaml must contain exactly one exact patchedDependencies: header",
		);

		const lockDuplicate = await baseline();
		lockDuplicate.lockfile += "\npatchedDependencies:\n";
		expect(validateWorkbenchPatchSet(lockDuplicate)).toContain(
			"pnpm-lock.yaml must contain exactly one exact patchedDependencies: header",
		);
	});

	it("rejects bare importer and snapshot edges even when comments repeat the hash", async () => {
		const apiHash =
			"71ac09018e6f1b2f74a120dc8f026aaf899c22c22c5fdec7a161f56d284d726f";
		const importerBare = await baseline();
		importerBare.lockfile = `${importerBare.lockfile.replace(
			`        version: 35.0.1(patch_hash=${apiHash})`,
			"        version: 35.0.1",
		)}\n# patch_hash=${apiHash}\n`;
		expect(validateWorkbenchPatchSet(importerBare)).toContain(
			`pnpm-lock.yaml importer edge for @codingame/monaco-vscode-api must resolve only to 35.0.1(patch_hash=${apiHash})`,
		);

		const snapshotBare = await baseline();
		snapshotBare.lockfile = `${snapshotBare.lockfile.replace(
			`      '@codingame/monaco-vscode-api': 35.0.1(patch_hash=${apiHash})`,
			"      '@codingame/monaco-vscode-api': 35.0.1",
		)}\n# patch_hash=${apiHash}\n`;
		expect(validateWorkbenchPatchSet(snapshotBare)).toContain(
			`pnpm-lock.yaml snapshot graph for @codingame/monaco-vscode-api must use only 35.0.1(patch_hash=${apiHash})`,
		);
	});

	it("rejects escaped double-quoted package keys before semantic graph matching", async () => {
		const escaped = await baseline();
		escaped.lockfile = escaped.lockfile.replace(
			"snapshots:\n",
			'snapshots:\n  "\\x40codingame/monaco-vscode-api@35.0.1": {}\n    dependencies:\n      "\\x40codingame/monaco-vscode-api": 35.0.1\n',
		);
		expect(validateWorkbenchPatchSet(escaped)).toContain(
			"pnpm-lock.yaml snapshots differs from pnpm's canonical YAML grammar",
		);
	});

	it("rejects YAML anchors, aliases, and merge keys in lock graph sections", async () => {
		const anchored = await baseline();
		anchored.lockfile = anchored.lockfile.replace(
			"snapshots:\n",
			"snapshots:\n  hidden: &patched\n    <<: *patched\n",
		);
		expect(validateWorkbenchPatchSet(anchored)).toContain(
			"pnpm-lock.yaml snapshots differs from pnpm's canonical YAML grammar",
		);
	});

	it("rejects single-quoted duplicate top-level protected sections", async () => {
		const lockDuplicate = await baseline();
		lockDuplicate.lockfile +=
			"\n'snapshots':\n  @codingame/monaco-vscode-api@35.0.1: {}\n";
		expect(validateWorkbenchPatchSet(lockDuplicate)).toContain(
			"pnpm-lock.yaml differs from the canonical top-level YAML envelope",
		);

		const manifestDuplicate = await baseline();
		manifestDuplicate.workspaceManifest +=
			"\n'patchedDependencies':\n  '@example/extra@1.0.0': patches/extra.patch\n";
		expect(validateWorkbenchPatchSet(manifestDuplicate)).toContain(
			"pnpm-workspace.yaml differs from the canonical top-level YAML envelope",
		);
	});

	it("rejects double-quoted escaped top-level section names", async () => {
		const escaped = await baseline();
		escaped.lockfile +=
			'\n"\\x73napshots":\n  "\\x40codingame/monaco-vscode-api@35.0.1": {}\n';
		expect(validateWorkbenchPatchSet(escaped)).toContain(
			"pnpm-lock.yaml differs from the canonical top-level YAML envelope",
		);
	});

	it("pins the three Plain baseline sources and the unresolved-save latch", async () => {
		const input = await baseline();
		const apiPatch = input.patchSources.get(
			"patches/@codingame__monaco-vscode-api@35.0.1.patch",
		);
		expect(apiPatch.match(/Symbol\("plainReadReceipt"\)/gu)).toHaveLength(2);
		expect(apiPatch.match(/Symbol\("plainBufferNoBaseline"\)/gu)).toHaveLength(
			2,
		);
		expect(apiPatch.match(/Symbol\("plainWriteReceipt"\)/gu)).toHaveLength(2);
		expect(apiPatch.match(/plainWriteReceipt/gu)).toHaveLength(4);
		expect(apiPatch.match(/plainSaveRequiresReload/gu)).toHaveLength(10);
	});

	it("rejects save-latch, branded-error and bounded-collector downgrades", async () => {
		const mutations = [
			{
				patchPath: "patches/@codingame__monaco-vscode-api@35.0.1.patch",
				from: "this.plainSaveRequiresReload = true;",
				to: "this.plainSaveRequiresReload = false;",
			},
			{
				patchPath:
					"patches/@codingame__monaco-vscode-files-service-override@35.0.1.patch",
				from: "throw createPlainWorkspaceWriteOutcomeError(result, options);",
				to: "throw new Error(String(result));",
			},
			{
				patchPath:
					"patches/@codingame__monaco-vscode-files-service-override@35.0.1.patch",
				from: "this.plainWorkspaceWriteFailures.set(plainWorkspaceWriteKey, Object.freeze({",
				to: "void plainWorkspaceWriteKey; Object.freeze({",
			},
			{
				patchPath:
					"patches/@codingame__monaco-vscode-files-service-override@35.0.1.patch",
				from: "failureAtReadStart?.resourceIdentity === resourceIdentity ? failureAtReadStart : undefined",
				to: "failureAtReadStart",
			},
			{
				patchPath:
					"patches/@codingame__monaco-vscode-files-service-override@35.0.1.patch",
				from: "const buffer = await collectPlainWorkspaceWriteBuffer(bufferOrReadableOrStream, resource, writeFileOptions);",
				to: "const buffer = await streamToBuffer(bufferOrReadableOrStream);",
			},
		];
		for (const mutation of mutations) {
			const input = await baseline();
			const source = input.patchSources.get(mutation.patchPath);
			expect(source).toContain(mutation.from);
			input.patchSources.set(
				mutation.patchPath,
				source.replace(mutation.from, mutation.to),
			);
			expect(validateWorkbenchPatchSet(input)).toContain(
				`${mutation.patchPath} differs from its exact audited SHA-256`,
			);
		}
	});
});
