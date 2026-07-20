import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { isPlainWorkspaceExplorerPathMutationAllowed } from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/plainWorkspaceDelete";
import { ExplorerItem } from "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/common/explorerModel";

const explorerModelSource = readFileSync(
	new URL(
		import.meta
			.resolve("@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/common/explorerModel"),
	),
	"utf8",
);

const explorerViewSource = readFileSync(
	new URL(
		import.meta
			.resolve("@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/views/explorerView"),
	),
	"utf8",
);

describe("Plain Workbench Explorer path-mutation context", () => {
	it("only separates path mutation from content readonly for the audited Plain capability tuple", () => {
		expect(
			isPlainWorkspaceExplorerPathMutationAllowed(
				"plain-workspace",
				true,
				false,
				true,
			),
		).toBe(true);

		for (const tuple of [
			["plain-test", true, false, true],
			["plain-workspace", false, false, true],
			["plain-workspace", true, true, true],
			["plain-workspace", true, false, false],
			["plain-workspace", true, false, { value: true }],
			["plain-workspace", 1, false, true],
			["plain-workspace", true, 0, true],
			[undefined, true, false, true],
		]) {
			expect(isPlainWorkspaceExplorerPathMutationAllowed(...tuple)).toBe(false);
		}
	});

	it("removes only the raw file-stat readonly flag and preserves independent readonly reasons", () => {
		const resource = URI.parse(
			"plain-workspace://11111111-1111-4111-8111-111111111111/file.txt",
		);
		const observedStats = [];
		let independentReadonly = {
			value: "configured-or-session-readonly",
		};
		const filesConfigService = {
			isReadonly(observedResource, stat) {
				expect(observedResource).toBe(resource);
				observedStats.push(stat);
				return stat.locked === true ? { value: "locked" } : independentReadonly;
			},
		};
		const createItem = (rawReadonly, locked) =>
			new ExplorerItem(
				resource,
				{},
				{},
				filesConfigService,
				undefined,
				false,
				false,
				rawReadonly,
				locked,
				"file.txt",
			);

		expect(createItem(true, false).isReadonlyExclusivelyFromRawFileStat).toBe(
			false,
		);
		expect(createItem(true, true).isReadonlyExclusivelyFromRawFileStat).toBe(
			false,
		);
		expect(createItem(false, false).isReadonlyExclusivelyFromRawFileStat).toBe(
			false,
		);
		expect(observedStats).toEqual([
			{
				resource,
				name: "file.txt",
				readonly: false,
				locked: false,
			},
			{
				resource,
				name: "file.txt",
				readonly: false,
				locked: true,
			},
		]);

		independentReadonly = false;
		expect(createItem(true, false).isReadonlyExclusivelyFromRawFileStat).toBe(
			true,
		);
		expect(createItem(true, true).isReadonlyExclusivelyFromRawFileStat).toBe(
			false,
		);
	});

	it("keeps the exception local to Explorer context projection and capability checks", () => {
		expect(explorerViewSource).toContain(
			"import { PLAIN_WORKSPACE_SCHEME, isPlainWorkspaceExplorerPathMutationAllowed } from '../../../../../platform/files/common/plainWorkspaceDelete.js';",
		);
		expect(explorerViewSource).toContain(
			"const plainWorkspacePathMutationAllowed = !!stat && resource.scheme === PLAIN_WORKSPACE_SCHEME && isPlainWorkspaceExplorerPathMutationAllowed(resource.scheme, this.fileService.hasCapability(resource, FileSystemProviderCapabilities.FileFolderCopy), this.fileService.hasCapability(resource, FileSystemProviderCapabilities.Readonly), stat.isReadonlyExclusivelyFromRawFileStat);",
		);
		expect(explorerModelSource).toContain(
			"get isReadonlyExclusivelyFromRawFileStat()",
		);
		expect(explorerModelSource).toContain("if (this._readonly !== true)");
		expect(explorerModelSource).toContain("readonly: false,");
		expect(explorerModelSource).toContain("locked: this._locked");
		expect(explorerViewSource).toContain(
			"this.readonlyContext.set(!!stat && !!stat.isReadonly && !plainWorkspacePathMutationAllowed);",
		);
		expect(explorerViewSource).not.toContain("stat.isReadonly = false");
		expect(explorerViewSource).not.toContain(
			"this.parentReadonlyContext.set(false)",
		);
	});
});
