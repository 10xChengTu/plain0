import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { ExplorerService } from "@codingame/monaco-vscode-explorer-service-override/vscode/vs/workbench/contrib/files/browser/explorerService";
import { afterEach, describe, expect, it } from "vitest";

const ROOT_ID = "00112233-4455-4677-8899-aabbccddeeff";
const disposables = [];

function noopEvent() {
	return { dispose() {} };
}

function createService() {
	const root = {
		name: "root",
		uri: URI.parse(`plain-workspace://${ROOT_ID}/`),
	};
	const explorer = {
		autoReveal: true,
		autoRevealExclude: {},
		fileNesting: { enabled: false },
		sortOrder: "default",
		sortOrderReverse: false,
	};
	const service = new ExplorerService(
		{
			onDidChangeFileSystemProviderCapabilities: noopEvent,
			onDidChangeFileSystemProviderRegistrations: noopEvent,
			onDidFilesChange: noopEvent,
			onDidRunOperation: noopEvent,
		},
		{
			getValue(argument) {
				return argument === "explorer" ? explorer : { explorer };
			},
			onDidChangeConfiguration: noopEvent,
		},
		{
			getWorkspace() {
				return { folders: [root] };
			},
			getWorkspaceFolder() {
				return root;
			},
			onDidChangeWorkspaceFolders: noopEvent,
		},
		{},
		{ activeEditor: undefined },
		{
			extUri: {
				isEqual(left, right) {
					return left.toString() === right.toString();
				},
			},
		},
		{},
		{},
		{ onDidChangeFocus: noopEvent },
		{},
	);
	disposables.push(service);
	return service;
}

function fileChangeEvent(rawUpdated) {
	return {
		contains() {
			return false;
		},
		rawAdded: [],
		rawDeleted: [],
		rawUpdated,
	};
}

async function runUpdated(resources) {
	const service = createService();
	const refreshArguments = [];
	service.refresh = async (reveal) => {
		refreshArguments.push(reveal);
	};
	service.fileChangeEvents = [fileChangeEvent(resources)];
	await service.onFileChangesScheduler.runner();
	return refreshArguments;
}

afterEach(() => {
	for (const disposable of disposables.splice(0)) {
		disposable.dispose();
	}
});

describe("Plain Workbench Explorer root refresh patch", () => {
	it("deep-refreshes for an exact plain-workspace root rawUpdated resource", async () => {
		await expect(
			runUpdated([URI.parse(`plain-workspace://${ROOT_ID}/`)]),
		).resolves.toEqual([false]);
	});

	it.each([
		["another scheme", `file://${ROOT_ID}/`],
		["empty path", `plain-workspace://${ROOT_ID}`],
		["non-root path", `plain-workspace://${ROOT_ID}/src`],
		["query", `plain-workspace://${ROOT_ID}/?refresh=1`],
		["fragment", `plain-workspace://${ROOT_ID}/#refresh`],
	])(
		"does not broaden refresh to %s rawUpdated resources",
		async (_label, uri) => {
			await expect(runUpdated([URI.parse(uri)])).resolves.toEqual([]);
		},
	);

	it("does not reinterpret root rawDeleted as the Plain refresh signal", async () => {
		const service = createService();
		const refreshArguments = [];
		service.refresh = async (reveal) => {
			refreshArguments.push(reveal);
		};
		service.fileChangeEvents = [
			{
				...fileChangeEvent([]),
				rawDeleted: [URI.parse(`plain-workspace://${ROOT_ID}/`)],
			},
		];
		await service.onFileChangesScheduler.runner();
		expect(refreshArguments).toEqual([]);
	});
});
