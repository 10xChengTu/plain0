import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { describe, expect, it } from "vitest";

import {
	plainUntitledResourceForScratchId,
	scratchIdFromPlainUntitledResource,
} from "../../app/services/plain-untitled-resource";

const SCRATCH_ID = "00000000-0000-4000-8000-000000000111";

describe("Plain Untitled scratch resource", () => {
	it("round-trips a canonical Rust scratch id without looking like an associated file", () => {
		const resource = plainUntitledResourceForScratchId(SCRATCH_ID);
		expect(resource.toString()).toBe(`untitled://${SCRATCH_ID}/Untitled-1`);
		expect(scratchIdFromPlainUntitledResource(resource)).toBe(SCRATCH_ID);
	});

	it("rejects malformed ids and foreign or altered Untitled resources", () => {
		expect(() => plainUntitledResourceForScratchId("not-an-id")).toThrow(
			"scratch identifier",
		);
		for (const resource of [
			URI.parse("untitled:/Untitled-1"),
			URI.parse(`untitled://${SCRATCH_ID}/other`),
			URI.parse(`untitled://${SCRATCH_ID}/Untitled-1?extra=true`),
			URI.parse(`plain-workspace://${SCRATCH_ID}/Untitled-1`),
		]) {
			expect(scratchIdFromPlainUntitledResource(resource)).toBeUndefined();
		}
	});
});
