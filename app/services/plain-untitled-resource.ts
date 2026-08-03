import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";

const SCRATCH_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Plain keeps the Rust-owned scratch id in the URI authority. The path stays
 * in Workbench's `Untitled-<digits>` family so the upstream Untitled service
 * never mistakes this resource for an associated filesystem path.
 */
export function plainUntitledResourceForScratchId(scratchId: string): URI {
	if (!SCRATCH_ID_PATTERN.test(scratchId)) {
		throw new TypeError("The Plain scratch identifier is invalid.");
	}
	const stableLabel = Number.parseInt(scratchId.slice(0, 8), 16) + 1;
	return URI.from({
		scheme: "untitled",
		authority: scratchId,
		path: `/Untitled-${stableLabel}`,
	});
}

export function scratchIdFromPlainUntitledResource(
	resource: URI,
): string | undefined {
	if (
		resource.scheme !== "untitled" ||
		!SCRATCH_ID_PATTERN.test(resource.authority) ||
		resource.query !== "" ||
		resource.fragment !== ""
	) {
		return undefined;
	}
	const expected = plainUntitledResourceForScratchId(resource.authority);
	return resource.path === expected.path ? resource.authority : undefined;
}
