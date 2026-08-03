import { describe, expect, it } from "vitest";

import {
	stageExplicitHunks,
	type PlainHunkStageServices,
	type PlainHunkStageSnapshot,
} from "../../app/features/scm/hunk-stage";

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

function snapshot(
	index: string | Uint8Array | null,
	worktree: string | Uint8Array,
): PlainHunkStageSnapshot {
	return Object.freeze({
		indexBytes:
			index === null
				? null
				: typeof index === "string"
					? encode(index)
					: new Uint8Array(index),
		worktreeBytes:
			typeof worktree === "string"
				? encode(worktree)
				: new Uint8Array(worktree),
	});
}

type HunkPickItems = Parameters<
	PlainHunkStageServices["quickInput"]["pick"]
>[0];
type HunkPickItem = HunkPickItems[number];

function harness(
	snapshots: readonly PlainHunkStageSnapshot[],
	select: (items: HunkPickItems) => readonly HunkPickItem[] | undefined,
) {
	let readCount = 0;
	const staged: Uint8Array[] = [];
	const infos: string[] = [];
	const errors: string[] = [];
	let pickOptions: unknown;
	const services: PlainHunkStageServices = {
		async readSnapshot() {
			const value = snapshots[Math.min(readCount, snapshots.length - 1)];
			readCount += 1;
			if (value === undefined) {
				throw new Error("missing scripted snapshot");
			}
			return value;
		},
		quickInput: {
			async pick(items, options) {
				pickOptions = options;
				return select(items);
			},
		},
		notifications: {
			info: (message) => infos.push(message),
			error: (message) => errors.push(message),
		},
		async stage(content) {
			staged.push(new Uint8Array(content));
		},
	};
	return {
		services,
		staged,
		infos,
		errors,
		pickOptions: () => pickOptions,
		readCount: () => readCount,
	};
}

describe("stageExplicitHunks", () => {
	const initial = snapshot("one\ntwo\nthree\n", "ONE\ntwo\nTHREE\n");

	it("stages only an explicitly selected second hunk after a fresh byte check", async () => {
		const test = harness([initial, initial], (items) => [items[1]!]);
		const outcome = await stageExplicitHunks("src/hunk.ts", test.services);

		expect(outcome).toBe("staged");
		expect(test.readCount()).toBe(2);
		expect(test.staged).toHaveLength(1);
		expect(new TextDecoder().decode(test.staged[0])).toBe("one\ntwo\nTHREE\n");
		expect(test.pickOptions()).toMatchObject({ canPickMany: true });
		expect(test.errors).toEqual([]);
	});

	it("treats an empty explicit selection as zero-write", async () => {
		const test = harness([initial], () => []);
		expect(await stageExplicitHunks("src/hunk.ts", test.services)).toBe(
			"not-staged",
		);
		expect(test.readCount()).toBe(1);
		expect(test.staged).toEqual([]);
	});

	it("treats picker cancellation as zero-write", async () => {
		const test = harness([initial], () => undefined);
		expect(await stageExplicitHunks("src/hunk.ts", test.services)).toBe(
			"not-staged",
		);
		expect(test.readCount()).toBe(1);
		expect(test.staged).toEqual([]);
	});

	it("refuses a stale index snapshot immediately before the write", async () => {
		const test = harness(
			[initial, snapshot("externally changed\n", "ONE\ntwo\nTHREE\n")],
			(items) => [items[0]!],
		);
		expect(await stageExplicitHunks("src/hunk.ts", test.services)).toBe(
			"not-staged",
		);
		expect(test.staged).toEqual([]);
		expect(test.infos.join("\n")).toContain("Git index changed");
	});

	it("refuses a stale working-tree snapshot immediately before the write", async () => {
		const test = harness(
			[initial, snapshot("one\ntwo\nthree\n", "changed again\n")],
			(items) => [items[0]!],
		);
		expect(await stageExplicitHunks("src/hunk.ts", test.services)).toBe(
			"not-staged",
		);
		expect(test.staged).toEqual([]);
	});

	it("refuses a picker result outside the bounded offered set", async () => {
		const test = harness([initial], (items) => [
			{ ...items[0]!, hunkIndex: 999 },
		]);
		expect(await stageExplicitHunks("src/hunk.ts", test.services)).toBe(
			"not-staged",
		);
		expect(test.staged).toEqual([]);
		expect(test.errors.join("\n")).toContain("invalid hunk selection");
	});

	it("refuses duplicate returned hunks without a write", async () => {
		const test = harness([initial], (items) => [items[0]!, items[0]!]);
		expect(await stageExplicitHunks("src/hunk.ts", test.services)).toBe(
			"not-staged",
		);
		expect(test.staged).toEqual([]);
		expect(test.errors.join("\n")).toContain("duplicate");
	});

	it("rejects BOM and binary payloads before opening the picker", async () => {
		const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x61]);
		const binary = new Uint8Array([0x61, 0x00, 0x62]);
		for (const value of [bom, binary]) {
			const test = harness([snapshot(value, "changed")], () => {
				throw new Error("picker must not open");
			});
			expect(await stageExplicitHunks("src/hunk.ts", test.services)).toBe(
				"not-staged",
			);
			expect(test.readCount()).toBe(1);
			expect(test.staged).toEqual([]);
			expect(test.errors.join("\n")).toContain("does not accept binary");
		}
	});
});
