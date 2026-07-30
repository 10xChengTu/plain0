import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { describe, expect, it } from "vitest";

import {
	replaceSearchMatches,
	type ReplaceBulkEditService,
	type ReplaceFileModels,
	type ReplaceModelHandle,
	type ReplaceTarget,
} from "../../app/features/search/plain-replace-coordinator";

function resource(path: string): URI {
	return URI.from({ scheme: "plain-workspace", authority: "root", path });
}

function target(path: string, startColumn = 1, endColumn = 7): ReplaceTarget {
	return {
		resource: resource(path),
		range: {
			startLineNumber: 1,
			startColumn,
			endLineNumber: 1,
			endColumn,
		},
	};
}

interface FakeEnvironment {
	readonly bulkEditService: ReplaceBulkEditService;
	readonly fileModels: ReplaceFileModels;
	readonly applyCalls: unknown[][];
	readonly saveCalls: Array<{ resourceKey: string; source: string }>;
	/** Resources present in the fake model manager after `apply()` "resolved"
	 * them — mirrors `ITextFileService.files` only containing a model once
	 * `IBulkEditService.apply()` has resolved it via `createModelReference`. */
	registerModel(
		path: string,
		options?: { readonly save?: boolean; readonly applyThrows?: boolean },
	): void;
}

function createFakeEnvironment(): FakeEnvironment {
	const applyCalls: unknown[][] = [];
	const saveCalls: Array<{ resourceKey: string; source: string }> = [];
	const models = new Map<string, { save: boolean; applyThrows: boolean }>();
	const modelHandles = new Map<string, ReplaceModelHandle>();

	const bulkEditService: ReplaceBulkEditService = {
		async apply(edits) {
			applyCalls.push(edits);
			for (const edit of edits) {
				const key = edit.resource.toString();
				const model = models.get(key);
				if (model?.applyThrows === true) {
					throw new Error(`apply failed for ${key}`);
				}
				if (model !== undefined && !modelHandles.has(key)) {
					modelHandles.set(key, {
						async save(options) {
							saveCalls.push({ resourceKey: key, source: options.source });
							return model.save;
						},
					});
				}
			}
			return {};
		},
	};

	const fileModels: ReplaceFileModels = {
		get(candidate) {
			return modelHandles.get(candidate.toString());
		},
	};

	return {
		bulkEditService,
		fileModels,
		applyCalls,
		saveCalls,
		registerModel(path, options = {}) {
			models.set(resource(path).toString(), {
				save: options.save ?? true,
				applyThrows: options.applyThrows ?? false,
			});
		},
	};
}

describe("replaceSearchMatches", () => {
	it("returns an empty outcome for no targets, without calling apply or save", async () => {
		const env = createFakeEnvironment();
		const outcome = await replaceSearchMatches(
			env.bulkEditService,
			env.fileModels,
			[],
			"replacement",
		);
		expect(outcome.perResource.size).toBe(0);
		expect(env.applyCalls).toHaveLength(0);
		expect(env.saveCalls).toHaveLength(0);
	});

	it("reports a single target's resource as replaced once apply and save both succeed", async () => {
		const env = createFakeEnvironment();
		env.registerModel("/a.ts");

		const outcome = await replaceSearchMatches(
			env.bulkEditService,
			env.fileModels,
			[target("/a.ts")],
			"replacement",
		);

		expect(outcome.perResource.get(resource("/a.ts").toString())).toEqual({
			status: "replaced",
		});
		expect(env.applyCalls).toHaveLength(1);
		expect(env.saveCalls).toEqual([
			{
				resourceKey: resource("/a.ts").toString(),
				source: "plainSearch.replace",
			},
		]);
	});

	it("groups every target for the same resource into one apply() call with one ResourceTextEdit per target", async () => {
		const env = createFakeEnvironment();
		env.registerModel("/a.ts");

		await replaceSearchMatches(
			env.bulkEditService,
			env.fileModels,
			[target("/a.ts", 1, 7), target("/a.ts", 20, 26)],
			"x",
		);

		expect(env.applyCalls).toHaveLength(1);
		expect(env.applyCalls[0]).toHaveLength(2);
		expect(env.saveCalls).toHaveLength(1);
	});

	it("uses the provided replacement text verbatim in every edit", async () => {
		const env = createFakeEnvironment();
		env.registerModel("/a.ts");

		await replaceSearchMatches(
			env.bulkEditService,
			env.fileModels,
			[target("/a.ts")],
			"needle -> reed",
		);

		const edits = env.applyCalls[0] as Array<{
			textEdit: { text: string; range: unknown };
		}>;
		expect(edits[0]?.textEdit.text).toBe("needle -> reed");
		expect(edits[0]?.textEdit.range).toEqual({
			startLineNumber: 1,
			startColumn: 1,
			endLineNumber: 1,
			endColumn: 7,
		});
	});

	it("reports failed when the model resolves but save() resolves false (e.g. FILE_MODIFIED_SINCE)", async () => {
		const env = createFakeEnvironment();
		env.registerModel("/a.ts", { save: false });

		const outcome = await replaceSearchMatches(
			env.bulkEditService,
			env.fileModels,
			[target("/a.ts")],
			"x",
		);

		expect(outcome.perResource.get(resource("/a.ts").toString())).toEqual({
			status: "failed",
		});
	});

	it("reports failed, without throwing, when apply() itself rejects for that resource", async () => {
		const env = createFakeEnvironment();
		env.registerModel("/a.ts", { applyThrows: true });

		const outcome = await replaceSearchMatches(
			env.bulkEditService,
			env.fileModels,
			[target("/a.ts")],
			"x",
		);

		expect(outcome.perResource.get(resource("/a.ts").toString())).toEqual({
			status: "failed",
		});
		expect(env.saveCalls).toHaveLength(0);
	});

	it("reports failed when the resource never resolves into a model after apply()", async () => {
		const env = createFakeEnvironment();
		// Deliberately not registered: `apply()` succeeds (never throws) but
		// `fileModels.get()` still returns undefined afterwards.
		const outcome = await replaceSearchMatches(
			env.bulkEditService,
			env.fileModels,
			[target("/never-registered.ts")],
			"x",
		);

		expect(
			outcome.perResource.get(resource("/never-registered.ts").toString()),
		).toEqual({ status: "failed" });
	});

	it("isolates one resource's failure from a sibling resource's success in the same call (F040 S4 partial success)", async () => {
		const env = createFakeEnvironment();
		env.registerModel("/ok.ts", { save: true });
		env.registerModel("/conflict.ts", { save: false });
		env.registerModel("/broken.ts", { applyThrows: true });

		const outcome = await replaceSearchMatches(
			env.bulkEditService,
			env.fileModels,
			[target("/ok.ts"), target("/conflict.ts"), target("/broken.ts")],
			"x",
		);

		expect(outcome.perResource.get(resource("/ok.ts").toString())).toEqual({
			status: "replaced",
		});
		expect(
			outcome.perResource.get(resource("/conflict.ts").toString()),
		).toEqual({ status: "failed" });
		expect(outcome.perResource.get(resource("/broken.ts").toString())).toEqual({
			status: "failed",
		});
		// Each resource got its own apply() call (per-resource grouping), so
		// /broken.ts throwing did not stop /ok.ts or /conflict.ts from being
		// attempted at all.
		expect(env.applyCalls).toHaveLength(3);
		expect(env.saveCalls.map((call) => call.resourceKey)).toEqual(
			expect.arrayContaining([
				resource("/ok.ts").toString(),
				resource("/conflict.ts").toString(),
			]),
		);
	});

	it("returns a frozen outcome object", async () => {
		const env = createFakeEnvironment();
		env.registerModel("/a.ts");
		const outcome = await replaceSearchMatches(
			env.bulkEditService,
			env.fileModels,
			[target("/a.ts")],
			"x",
		);
		expect(Object.isFrozen(outcome)).toBe(true);
	});
});
