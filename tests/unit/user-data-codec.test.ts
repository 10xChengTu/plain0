import { describe, expect, it } from "vitest";

import {
	decodeUserDataChangedEvent,
	decodeUserDataResult,
	frozenUserDataReadRequest,
	frozenUserDataWriteRequest,
	MAX_KEYBINDINGS_BYTES,
	MAX_SETTINGS_BYTES,
} from "../../app/platform/tauri/user-data-codec";

describe("user-data codec", () => {
	it("builds exact immutable read and write requests", () => {
		const read = frozenUserDataReadRequest("settings");
		expect(read).toEqual({ resource: "settings" });
		expect(Object.isFrozen(read)).toBe(true);

		const write = frozenUserDataWriteRequest(
			"keybindings",
			3,
			'[{"key":"cmd+k","command":"plain.test"}]\n',
		);
		expect(write.expectedRevision).toBe(3);
		expect(Object.keys(write)).toEqual([
			"resource",
			"expectedRevision",
			"content",
		]);
		expect(Object.isFrozen(write)).toBe(true);
	});

	it("rejects unsupported resources, revisions and per-resource byte overflow", () => {
		expect(() => frozenUserDataReadRequest("snippets")).toThrow();
		expect(() => frozenUserDataWriteRequest("settings", 0, "{}")).toThrow();
		expect(() =>
			frozenUserDataWriteRequest(
				"settings",
				1,
				"x".repeat(MAX_SETTINGS_BYTES + 1),
			),
		).toThrow();
		expect(() =>
			frozenUserDataWriteRequest(
				"keybindings",
				1,
				"x".repeat(MAX_KEYBINDINGS_BYTES + 1),
			),
		).toThrow();
	});

	it("decodes only exact own-data results and events", () => {
		expect(
			decodeUserDataResult({
				resource: "settings",
				revision: 2,
				content: "{}\n",
			}),
		).toEqual({ resource: "settings", revision: 2, content: "{}\n" });
		expect(
			decodeUserDataChangedEvent({ resource: "keybindings", revision: 4 }),
		).toEqual({ resource: "keybindings", revision: 4 });

		for (const malformed of [
			{ resource: "settings", revision: 0, content: "{}" },
			{ resource: "settings", revision: 1, content: "{}", path: "/tmp" },
			Object.create({ resource: "settings", revision: 1, content: "{}" }),
		]) {
			expect(() => decodeUserDataResult(malformed)).toThrow();
		}
	});

	it("rejects accessors and proxies without invoking hostile getters", () => {
		let getterCalls = 0;
		const accessor = {
			resource: "settings",
			revision: 1,
			get content() {
				getterCalls += 1;
				return "{}";
			},
		};
		expect(() => decodeUserDataResult(accessor)).toThrow();
		expect(getterCalls).toBe(0);
		expect(() =>
			decodeUserDataChangedEvent(
				new Proxy(
					{ resource: "settings", revision: 1 },
					{ ownKeys: () => ["resource", "revision"] },
				),
			),
		).toThrow();
	});
});
