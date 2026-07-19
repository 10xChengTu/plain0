import { describe, expect, it } from "vitest";

import { createBrowserMockBridge } from "../../app/platform/tauri/browser-mock";
import { decodeWorkspaceCapabilities } from "../../app/platform/tauri/workspace-codec";

const supportedCapabilities = Object.freeze({
	create: true,
	renameNoReplace: true,
	copyMove: true,
	delete: true,
	versionedWrite: true,
});

describe("workspace capability contract", () => {
	it("accepts and freezes every exact supported or readonly platform shape", () => {
		for (const payload of [
			supportedCapabilities,
			{
				create: true,
				renameNoReplace: false,
				copyMove: false,
				delete: false,
				versionedWrite: false,
			},
		]) {
			const decoded = decodeWorkspaceCapabilities(payload);
			expect(decoded).toEqual(payload);
			expect(Object.isFrozen(decoded)).toBe(true);
		}
	});

	it("rejects missing, extra, non-boolean, inherited, accessor and Proxy payloads", () => {
		let accessorReads = 0;
		const accessorPayload = { ...supportedCapabilities };
		Object.defineProperty(accessorPayload, "copyMove", {
			enumerable: true,
			get() {
				accessorReads += 1;
				return true;
			},
		});
		let proxyReads = 0;
		const proxyPayload = new Proxy(
			{ ...supportedCapabilities },
			{
				get(target, property, receiver) {
					proxyReads += 1;
					return Reflect.get(target, property, receiver);
				},
			},
		);
		const inherited = Object.create(supportedCapabilities) as Record<
			string,
			unknown
		>;

		for (const payload of [
			null,
			{},
			{ ...supportedCapabilities, extra: true },
			{ ...supportedCapabilities, delete: 1 },
			inherited,
			accessorPayload,
			proxyPayload,
		]) {
			expect(() => decodeWorkspaceCapabilities(payload)).toThrowError(
				/Plain contract/u,
			);
		}
		expect(accessorReads).toBe(0);
		expect(proxyReads).toBe(0);
	});

	it("returns one immutable supported capability snapshot from the browser mock", async () => {
		const bridge = createBrowserMockBridge();
		const first = await bridge.workspaceCapabilities();
		const second = await bridge.workspaceCapabilities();

		expect(first).toEqual(supportedCapabilities);
		expect(second).toBe(first);
		expect(Object.isFrozen(first)).toBe(true);
	});
});
