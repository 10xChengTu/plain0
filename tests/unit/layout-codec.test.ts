import { describe, expect, it } from "vitest";

import {
	decodeLayoutStorageSnapshot,
	decodeLayoutVoid,
	frozenLayoutWriteRequest,
} from "../../app/platform/tauri/layout-codec";

describe("layout codec", () => {
	it("builds an exact frozen request and decodes a bounded snapshot", () => {
		const entries = [
			{
				scope: "profile" as const,
				key: "workbench.sideBar.size",
				value: "320",
			},
			{
				scope: "workspace" as const,
				key: "workbench.sideBar.hidden",
				value: "true",
			},
		];
		const request = frozenLayoutWriteRequest(entries);
		expect(request).toEqual({ entries });
		expect(Object.isFrozen(request)).toBe(true);
		expect(Object.isFrozen(request.entries)).toBe(true);

		const snapshot = decodeLayoutStorageSnapshot({
			workspaceAvailable: true,
			entries,
		});
		expect(snapshot).toEqual({ workspaceAvailable: true, entries });
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.entries[0])).toBe(true);
		expect(decodeLayoutVoid(null)).toBeUndefined();
	});

	it("rejects duplicate malformed oversized accessor and proxy payloads", () => {
		const entry = {
			scope: "profile",
			key: "workbench.sideBar.size",
			value: "320",
		};
		for (const malformed of [
			{ workspaceAvailable: true, entries: [entry, entry] },
			{
				workspaceAvailable: true,
				entries: [{ ...entry, value: "x".repeat(64 * 1024 + 1) }],
			},
			{ workspaceAvailable: "yes", entries: [] },
			{ workspaceAvailable: true, entries: [], nativePath: "/tmp" },
		]) {
			expect(() => decodeLayoutStorageSnapshot(malformed)).toThrowError(
				expect.objectContaining({ code: "IPC_CONTRACT_VIOLATION" }),
			);
		}

		let getterCalls = 0;
		const accessor = {
			workspaceAvailable: true,
			get entries() {
				getterCalls += 1;
				return [];
			},
		};
		expect(() => decodeLayoutStorageSnapshot(accessor)).toThrow();
		expect(getterCalls).toBe(0);
		expect(() =>
			decodeLayoutStorageSnapshot(
				new Proxy(
					{ workspaceAvailable: true, entries: [] },
					{ ownKeys: () => ["workspaceAvailable", "entries"] },
				),
			),
		).toThrow();
		expect(() => decodeLayoutVoid({})).toThrow();
	});
});
