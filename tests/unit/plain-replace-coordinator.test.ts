import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { describe, expect, it, vi } from "vitest";

import {
	replaceSearchMatches,
	type ExpandedReplacement,
	type ReplaceBulkEditService,
	type ReplaceFileModels,
	type ReplaceModelHandle,
	type ReplacementInput,
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
		expectedText: "needle",
	};
}

/** Wraps a bare replacement string as literal-mode input — the exact
 * pre-`F200`-S2 call shape, now spelled explicitly since
 * `replaceSearchMatches`'s fourth parameter also has to carry the
 * regex-mode `ReplaceExpander` branch. */
function literal(text: string): ReplacementInput {
	return { kind: "literal", text };
}

interface FakeEnvironment {
	readonly bulkEditService: ReplaceBulkEditService;
	readonly fileModels: ReplaceFileModels;
	readonly applyCalls: unknown[][];
	readonly saveCalls: Array<{ resourceKey: string; source: string }>;
	/** Resources the fake manager can resolve before `apply()`, matching the
	 * coordinator's stale-range preflight. */
	registerModel(
		path: string,
		options?: {
			readonly save?: boolean;
			readonly applyThrows?: boolean;
			readonly currentText?: string;
		},
	): void;
}

function createFakeEnvironment(): FakeEnvironment {
	const applyCalls: unknown[][] = [];
	const saveCalls: Array<{ resourceKey: string; source: string }> = [];
	const models = new Map<
		string,
		{ save: boolean; applyThrows: boolean; currentText: string }
	>();
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
			}
			return {};
		},
	};

	const fileModels: ReplaceFileModels = {
		get(candidate) {
			return modelHandles.get(candidate.toString());
		},
		async resolve(candidate) {
			const key = candidate.toString();
			const model = models.get(key);
			if (model === undefined) {
				throw new Error(`missing model for ${key}`);
			}
			let handle = modelHandles.get(key);
			if (handle === undefined) {
				handle = {
					textEditorModel: {
						getValueInRange() {
							return model.currentText;
						},
					},
					isResolved() {
						return true;
					},
					async save(options) {
						saveCalls.push({ resourceKey: key, source: options.source });
						return model.save;
					},
				};
				modelHandles.set(key, handle);
			}
			return handle;
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
				currentText: options.currentText ?? "needle",
			});
		},
	};
}

describe("replaceSearchMatches (literal mode)", () => {
	it("returns an empty outcome for no targets, without calling apply or save", async () => {
		const env = createFakeEnvironment();
		const outcome = await replaceSearchMatches(
			env.bulkEditService,
			env.fileModels,
			[],
			literal("replacement"),
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
			literal("replacement"),
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
			literal("x"),
		);

		expect(env.applyCalls).toHaveLength(1);
		expect(env.applyCalls[0]).toHaveLength(2);
		expect(env.saveCalls).toHaveLength(1);
	});

	it("uses the provided replacement text verbatim in every edit — including a literal $1 that a template branch would otherwise expand", async () => {
		const env = createFakeEnvironment();
		env.registerModel("/a.ts");

		await replaceSearchMatches(
			env.bulkEditService,
			env.fileModels,
			[target("/a.ts")],
			literal("needle -> $1 reed"),
		);

		const edits = env.applyCalls[0] as Array<{
			textEdit: { text: string; range: unknown };
		}>;
		expect(edits[0]?.textEdit.text).toBe("needle -> $1 reed");
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
			literal("x"),
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
			literal("x"),
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
			literal("x"),
		);

		expect(
			outcome.perResource.get(resource("/never-registered.ts").toString()),
		).toEqual({ status: "failed" });
	});

	it("rejects stale match coordinates before applying or saving", async () => {
		const env = createFakeEnvironment();
		env.registerModel("/changed.ts", { currentText: "changed" });

		const outcome = await replaceSearchMatches(
			env.bulkEditService,
			env.fileModels,
			[target("/changed.ts")],
			literal("replacement"),
		);

		expect(outcome.perResource.get(resource("/changed.ts").toString())).toEqual(
			{ status: "conflict" },
		);
		expect(env.applyCalls).toHaveLength(0);
		expect(env.saveCalls).toHaveLength(0);
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
			literal("x"),
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
			literal("x"),
		);
		expect(Object.isFrozen(outcome)).toBe(true);
	});
});

describe("replaceSearchMatches (template mode, F200 S2)", () => {
	function expanderReturning(results: readonly ExpandedReplacement[]): {
		expand: ReplacementInput & { kind: "template" };
		calls: string[][];
	} {
		const calls: string[][] = [];
		const expand: ReplacementInput & { kind: "template" } = {
			kind: "template",
			async expand(expectedTexts) {
				calls.push([...expectedTexts]);
				return results;
			},
		};
		return { expand, calls };
	}

	it("does not call expand at all for zero targets", async () => {
		const env = createFakeEnvironment();
		const expand = vi.fn();
		const outcome = await replaceSearchMatches(
			env.bulkEditService,
			env.fileModels,
			[],
			{ kind: "template", expand },
		);
		expect(outcome.perResource.size).toBe(0);
		expect(expand).not.toHaveBeenCalled();
	});

	it("calls expand exactly once with every target's expectedText in order, and applies each target's own expanded text", async () => {
		const env = createFakeEnvironment();
		env.registerModel("/a.ts");
		const { expand, calls } = expanderReturning([
			{ status: "ok", replacement: "42-item" },
		]);

		const outcome = await replaceSearchMatches(
			env.bulkEditService,
			env.fileModels,
			[target("/a.ts")],
			expand,
		);

		expect(calls).toEqual([["needle"]]);
		expect(outcome.perResource.get(resource("/a.ts").toString())).toEqual({
			status: "replaced",
		});
		const edits = env.applyCalls[0] as Array<{
			textEdit: { text: string };
		}>;
		expect(edits[0]?.textEdit.text).toBe("42-item");
	});

	it("applies a distinct expanded replacement per target when a resource has multiple matches", async () => {
		const env = createFakeEnvironment();
		env.registerModel("/a.ts");
		const { expand } = expanderReturning([
			{ status: "ok", replacement: "first" },
			{ status: "ok", replacement: "second" },
		]);

		await replaceSearchMatches(
			env.bulkEditService,
			env.fileModels,
			[target("/a.ts", 1, 7), target("/a.ts", 20, 26)],
			expand,
		);

		expect(env.applyCalls).toHaveLength(1);
		const edits = env.applyCalls[0] as Array<{
			textEdit: { text: string };
		}>;
		expect(edits.map((edit) => edit.textEdit.text)).toEqual([
			"first",
			"second",
		]);
	});

	it("degrades a resource with any failing expansion entry to a zero-write conflict, reusing the existing conflict outcome", async () => {
		const env = createFakeEnvironment();
		env.registerModel("/a.ts");
		const { expand } = expanderReturning([
			{
				status: "error",
				code: "SEARCH_REPLACE_EXPAND_INVALID_GROUP",
				message: "no such group",
			},
		]);

		const outcome = await replaceSearchMatches(
			env.bulkEditService,
			env.fileModels,
			[target("/a.ts")],
			expand,
		);

		expect(outcome.perResource.get(resource("/a.ts").toString())).toEqual({
			status: "conflict",
		});
		expect(env.applyCalls).toHaveLength(0);
		expect(env.saveCalls).toHaveLength(0);
	});

	it("degrades the whole resource even when only one of several targets in it fails to expand", async () => {
		const env = createFakeEnvironment();
		env.registerModel("/a.ts");
		const { expand } = expanderReturning([
			{ status: "ok", replacement: "first" },
			{
				status: "error",
				code: "SEARCH_REPLACE_EXPAND_NO_MATCH",
				message: "no match",
			},
		]);

		const outcome = await replaceSearchMatches(
			env.bulkEditService,
			env.fileModels,
			[target("/a.ts", 1, 7), target("/a.ts", 20, 26)],
			expand,
		);

		expect(outcome.perResource.get(resource("/a.ts").toString())).toEqual({
			status: "conflict",
		});
		expect(env.applyCalls).toHaveLength(0);
	});

	it("isolates a failing resource's expansion from a sibling resource that expands and replaces successfully", async () => {
		const env = createFakeEnvironment();
		env.registerModel("/ok.ts");
		env.registerModel("/broken.ts");
		const { expand } = expanderReturning([
			{ status: "ok", replacement: "fine" },
			{
				status: "error",
				code: "SEARCH_REPLACE_EXPAND_NO_MATCH",
				message: "no match",
			},
		]);

		const outcome = await replaceSearchMatches(
			env.bulkEditService,
			env.fileModels,
			[target("/ok.ts"), target("/broken.ts")],
			expand,
		);

		expect(outcome.perResource.get(resource("/ok.ts").toString())).toEqual({
			status: "replaced",
		});
		expect(outcome.perResource.get(resource("/broken.ts").toString())).toEqual({
			status: "conflict",
		});
		expect(env.applyCalls).toHaveLength(1);
	});

	it("throws if the expander returns a different number of results than targets requested (contract violation, not a normal failure)", async () => {
		const env = createFakeEnvironment();
		env.registerModel("/a.ts");
		const { expand } = expanderReturning([]);

		await expect(
			replaceSearchMatches(
				env.bulkEditService,
				env.fileModels,
				[target("/a.ts")],
				expand,
			),
		).rejects.toThrow();
		expect(env.applyCalls).toHaveLength(0);
	});
});
