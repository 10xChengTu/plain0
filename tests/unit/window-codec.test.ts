import { describe, expect, it } from "vitest";

import { decodeWindowVoid } from "../../app/platform/tauri/window-codec";

describe("window codec", () => {
	it("accepts only the null Tauri unit response", () => {
		expect(decodeWindowVoid(null)).toBeUndefined();
		for (const value of [undefined, false, 0, "", {}, []]) {
			expect(() => decodeWindowVoid(value)).toThrowError(
				expect.objectContaining({ code: "IPC_CONTRACT_VIOLATION" }),
			);
		}
	});
});
