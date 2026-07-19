import {
	expect,
	test,
	type ConsoleMessage,
	type Dialog,
	type Locator,
	type Page,
} from "@playwright/test";

import workspaceVersionFixture from "../fixtures/workspace-version-v1.json" with { type: "json" };

interface TestTauriInvocation {
	readonly command: string;
	readonly args: Record<string, unknown>;
}

const nativeRootId = "00000000-0000-4000-8000-000000000101";
type RawReadTransport = "arrayBuffer" | "numberArray";
type NativeIpcMockMode = "readonly" | "supported";

async function installNativeIpcMock(
	page: Page,
	rawReadTransport: RawReadTransport,
	mode: NativeIpcMockMode = "readonly",
): Promise<void> {
	await page.addInitScript(
		({ goldenRead, mode, rawReadTransport }) => {
			const calls: Array<{
				command: string;
				args: Record<string, unknown>;
			}> = [];
			const workspaceId = "00000000-0000-4000-8000-000000000001";
			const rootId = "00000000-0000-4000-8000-000000000101";
			const emptySnapshot = {
				workspaceId,
				revision: 0,
				roots: [],
			};
			const selectedSnapshot = {
				workspaceId,
				revision: 1,
				roots: [
					{
						rootId,
						displayName: "native-workspace",
						uri: `plain-workspace://${rootId}/`,
					},
				],
			};
			type MockFile = {
				kind: "file";
				bytes: Uint8Array;
				version: string;
			};
			type MockDirectory = {
				kind: "directory";
				entries: Map<string, MockNode>;
			};
			type MockNode = MockDirectory | MockFile;
			const encoder = new TextEncoder();
			const decoder = new TextDecoder();
			let versionSerial = 1;
			const nextVersion = (): string =>
				`wv1:${(versionSerial++).toString(16).padStart(64, "0")}`;
			const file = (content: string): MockFile => ({
				kind: "file",
				bytes: encoder.encode(content),
				version: nextVersion(),
			});
			const directory = (
				entries: readonly (readonly [string, MockNode])[],
			): MockDirectory => ({ kind: "directory", entries: new Map(entries) });
			const root = directory([
				[
					"README.md",
					file("# Native workspace\n\nRead-only Explorer fixture.\n"),
				],
				["src", directory([["main.ts", file("export const plain = true;\n")]])],
			]);
			const entryNotFound = () => ({
				code: "ENTRY_NOT_FOUND",
				message: "The workspace entry does not exist.",
			});
			const entryAlreadyExists = () => ({
				code: "ENTRY_ALREADY_EXISTS",
				message: "The workspace entry already exists.",
			});
			const entryTypeMismatch = () => ({
				code: "ENTRY_TYPE_MISMATCH",
				message: "The workspace entry has an incompatible type.",
			});
			const invalidDeletePlan = () => ({
				code: "WORKSPACE_DELETE_PLAN_INVALID",
				message: "The workspace delete plan is invalid.",
			});
			const pathSegments = (relativePath: string): readonly string[] =>
				relativePath.length === 0 ? [] : relativePath.split("/");
			const resolveNode = (relativePath: string): MockNode => {
				let node: MockNode = root;
				for (const segment of pathSegments(relativePath)) {
					if (node.kind !== "directory") {
						throw entryTypeMismatch();
					}
					const child = node.entries.get(segment);
					if (child === undefined) {
						throw entryNotFound();
					}
					node = child;
				}
				return node;
			};
			const resolveParent = (
				relativePath: string,
			): { parent: MockDirectory; name: string } => {
				const segments = pathSegments(relativePath);
				if (segments.length === 0) {
					throw entryTypeMismatch();
				}
				const name = segments.at(-1)!;
				const parentPath = segments.slice(0, -1).join("/");
				const parent = resolveNode(parentPath);
				if (parent.kind !== "directory") {
					throw entryTypeMismatch();
				}
				return { parent, name };
			};
			const deleteNode = (relativePath: string): void => {
				const { parent, name } = resolveParent(relativePath);
				if (!parent.entries.delete(name)) {
					throw entryNotFound();
				}
			};
			const descendantEntries = (node: MockNode): number => {
				if (node.kind === "file") {
					return 0;
				}
				let descendants = node.entries.size;
				for (const child of node.entries.values()) {
					descendants += descendantEntries(child);
				}
				return descendants;
			};
			const bytesFromHex = (hex: string): Uint8Array => {
				const bytes = new Uint8Array(hex.length / 2);
				for (let index = 0; index < bytes.length; index += 1) {
					bytes[index] = Number.parseInt(
						hex.slice(index * 2, index * 2 + 2),
						16,
					);
				}
				return bytes;
			};
			const hexFromBytes = (bytes: Uint8Array): string =>
				[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
			const plw1Frame = (value: Uint8Array) => {
				if (
					value.byteLength < 14 ||
					value[0] !== 0x50 ||
					value[1] !== 0x4c ||
					value[2] !== 0x57 ||
					value[3] !== 0x31
				) {
					throw new Error("Malformed PLW1 browser test frame.");
				}
				const view = new DataView(
					value.buffer,
					value.byteOffset,
					value.byteLength,
				);
				const rootLength = view.getUint16(4, false);
				const pathLength = view.getUint16(6, false);
				const versionLength = view.getUint16(8, false);
				const contentLength = view.getUint32(10, false);
				const expectedLength =
					14 + rootLength + pathLength + versionLength + contentLength;
				if (expectedLength !== value.byteLength) {
					throw new Error("Malformed PLW1 browser test frame length.");
				}
				let offset = 14;
				const rootId = decoder.decode(value.slice(offset, offset + rootLength));
				offset += rootLength;
				const relativePath = decoder.decode(
					value.slice(offset, offset + pathLength),
				);
				offset += pathLength;
				const expectedVersion = decoder.decode(
					value.slice(offset, offset + versionLength),
				);
				offset += versionLength;
				const content = value.slice(offset, offset + contentLength);
				return {
					rootId,
					relativePath,
					expectedVersion,
					content,
				};
			};
			const plr1Frame = (
				content: Uint8Array,
				mtime: number,
				ctime: number,
				version: string | null,
			): Uint8Array => {
				const versionBytes =
					version === null
						? new Uint8Array()
						: new TextEncoder().encode(version);
				const frame = new Uint8Array(
					36 + versionBytes.byteLength + content.byteLength,
				);
				const view = new DataView(frame.buffer);
				frame.set([0x50, 0x4c, 0x52, 0x31], 0);
				frame[4] = 1;
				frame[5] = versionBytes.byteLength;
				view.setUint16(6, 0, false);
				view.setUint32(8, content.byteLength, false);
				view.setBigUint64(12, BigInt(content.byteLength), false);
				view.setBigUint64(20, BigInt(mtime), false);
				view.setBigUint64(28, BigInt(ctime), false);
				frame.set(versionBytes, 36);
				frame.set(content, 36 + versionBytes.byteLength);
				return frame;
			};
			const reproducedGolden = plr1Frame(
				bytesFromHex(goldenRead.contentHex),
				goldenRead.mtimeMs,
				goldenRead.ctimeMs,
				goldenRead.version,
			);
			if (hexFromBytes(reproducedGolden) !== goldenRead.frameHex) {
				throw new Error(
					"Shared PLR1 browser fixture does not reproduce exactly.",
				);
			}
			let deleteSerial = 201;
			const nextDeleteId = (): string =>
				`00000000-0000-4000-8000-${(deleteSerial++)
					.toString()
					.padStart(12, "0")}`;
			let activeDelete:
				| {
						confirmationId: string;
						entryId: string;
						relativePath: string;
						recursive: boolean;
						phase: "prepared" | "executing";
				  }
				| undefined;
			let nextCallbackId = 0;
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: typeof calls;
				__TAURI_EVENT_PLUGIN_INTERNALS__: {
					unregisterListener(): void;
				};
				__TAURI_INTERNALS__: {
					invoke(
						command: string,
						args?: Record<string, unknown> | Uint8Array,
					): Promise<unknown>;
					transformCallback(): number;
					unregisterCallback(): void;
				};
			};
			testWindow.__PLAIN_TEST_TAURI_CALLS__ = calls;
			testWindow.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
				unregisterListener() {},
			};
			testWindow.__TAURI_INTERNALS__ = {
				transformCallback() {
					nextCallbackId += 1;
					return nextCallbackId;
				},
				unregisterCallback() {},
				async invoke(command, args: Record<string, unknown> | Uint8Array = {}) {
					if (command === "workspace_write_file") {
						if (!(args instanceof Uint8Array)) {
							throw new Error("Expected one raw PLW1 browser test frame.");
						}
						const frame = plw1Frame(args);
						calls.push({
							command,
							args: {
								rawHex: hexFromBytes(args),
								request: {
									rootId: frame.rootId,
									relativePath: frame.relativePath,
									expectedVersion: frame.expectedVersion,
								},
								contentHex: hexFromBytes(frame.content),
							},
						});
						if (frame.rootId !== rootId) {
							throw entryNotFound();
						}
						const node = resolveNode(frame.relativePath);
						if (node.kind !== "file") {
							throw entryTypeMismatch();
						}
						if (node.version !== frame.expectedVersion) {
							throw {
								code: "WORKSPACE_FILE_MODIFIED",
								message: "The workspace file changed since it was read.",
							};
						}
						node.bytes = frame.content.slice();
						node.version = nextVersion();
						return {
							status: "written",
							stat: {
								kind: "file",
								size: node.bytes.byteLength,
								mtime: 1_700_000_000_001,
								ctime: 1_699_999_000_000,
								version: node.version,
							},
						};
					}
					if (args instanceof Uint8Array) {
						throw new Error(`Unexpected raw Tauri test command: ${command}`);
					}
					calls.push({ command, args });
					const request = args.request as
						{ rootId?: string; relativePath?: string } | undefined;
					switch (command) {
						case "plugin:event|listen":
							return 1;
						case "plugin:event|unlisten":
							return undefined;
						case "runtime_info":
							return {
								application: "Plain",
								ipcVersion: 1,
								runtime: "tauri",
							};
						case "workspace_capabilities":
							return {
								create: true,
								renameNoReplace: true,
								copyMove: true,
								delete: mode === "supported",
								versionedWrite: true,
							};
						case "workspace_snapshot":
							return emptySnapshot;
						case "workspace_pick_roots":
							return { status: "selected", snapshot: selectedSnapshot };
						case "workspace_create_file": {
							if (request?.rootId !== rootId) {
								throw entryNotFound();
							}
							const relativePath = request.relativePath ?? "";
							const { parent, name } = resolveParent(relativePath);
							if (parent.entries.has(name)) {
								throw entryAlreadyExists();
							}
							parent.entries.set(name, file(""));
							return {
								kind: "file",
								size: 0,
								mtime: 0,
								ctime: 0,
								version: null,
							};
						}
						case "workspace_create_directory": {
							if (request?.rootId !== rootId) {
								throw entryNotFound();
							}
							const relativePath = request.relativePath ?? "";
							const { parent, name } = resolveParent(relativePath);
							if (parent.entries.has(name)) {
								throw entryAlreadyExists();
							}
							parent.entries.set(name, directory([]));
							return {
								kind: "directory",
								size: 0,
								mtime: 0,
								ctime: 0,
								version: null,
							};
						}
						case "workspace_copy": {
							// The projected Browser workspace has one root, so this fixture
							// intentionally does not fabricate a cross-root workspace_move path.
							const copy = args.request as
								| {
										sourceRootId?: string;
										sourcePath?: string;
										targetRootId?: string;
										targetPath?: string;
								  }
								| undefined;
							if (
								copy === undefined ||
								Object.keys(copy).length !== 4 ||
								copy.sourceRootId !== rootId ||
								copy.targetRootId !== rootId ||
								typeof copy.sourcePath !== "string" ||
								typeof copy.targetPath !== "string"
							) {
								throw entryTypeMismatch();
							}
							const source = resolveNode(copy.sourcePath);
							if (source.kind !== "file") {
								throw entryTypeMismatch();
							}
							const target = resolveParent(copy.targetPath);
							if (target.parent.entries.has(target.name)) {
								throw entryAlreadyExists();
							}
							target.parent.entries.set(target.name, {
								kind: "file",
								bytes: source.bytes.slice(),
								version: nextVersion(),
							});
							return null;
						}
						case "workspace_rename": {
							const rename = args.request as
								| {
										rootId?: string;
										sourcePath?: string;
										targetPath?: string;
								  }
								| undefined;
							if (rename?.rootId !== rootId) {
								throw entryNotFound();
							}
							const sourcePath = rename.sourcePath ?? "";
							const targetPath = rename.targetPath ?? "";
							const source = resolveParent(sourcePath);
							const target = resolveParent(targetPath);
							const node = source.parent.entries.get(source.name);
							if (node === undefined) {
								throw entryNotFound();
							}
							if (target.parent.entries.has(target.name)) {
								throw entryAlreadyExists();
							}
							source.parent.entries.delete(source.name);
							target.parent.entries.set(target.name, node);
							return null;
						}
						case "workspace_prepare_delete": {
							const prepare = args.request as
								| {
										entries?: readonly {
											rootId?: string;
											relativePath?: string;
											recursive?: boolean;
										}[];
								  }
								| undefined;
							const entry = prepare?.entries?.[0];
							if (
								prepare?.entries?.length !== 1 ||
								entry?.rootId !== rootId ||
								typeof entry.relativePath !== "string" ||
								entry.recursive !== true
							) {
								throw invalidDeletePlan();
							}
							const node = resolveNode(entry.relativePath);
							const confirmationId = nextDeleteId();
							const entryId = nextDeleteId();
							activeDelete = {
								confirmationId,
								entryId,
								relativePath: entry.relativePath,
								recursive: true,
								phase: "prepared",
							};
							return {
								confirmationId,
								entries: [
									{
										entryId,
										kind: node.kind,
										descendantEntries: descendantEntries(node),
									},
								],
							};
						}
						case "workspace_cancel_delete": {
							const cancel = args.request as
								{ confirmationId?: string } | undefined;
							if (cancel?.confirmationId !== activeDelete?.confirmationId) {
								throw invalidDeletePlan();
							}
							activeDelete = undefined;
							return null;
						}
						case "workspace_begin_delete": {
							const begin = args.request as
								{ confirmationId?: string } | undefined;
							if (
								activeDelete === undefined ||
								begin?.confirmationId !== activeDelete.confirmationId ||
								activeDelete.phase !== "prepared"
							) {
								throw invalidDeletePlan();
							}
							activeDelete.phase = "executing";
							return null;
						}
						case "workspace_commit_delete_entry": {
							const commit = args.request as
								| {
										confirmationId?: string;
										entryId?: string;
										rootId?: string;
										relativePath?: string;
										recursive?: boolean;
								  }
								| undefined;
							if (
								activeDelete?.phase !== "executing" ||
								commit?.confirmationId !== activeDelete.confirmationId ||
								commit.entryId !== activeDelete.entryId ||
								commit.rootId !== rootId ||
								commit.relativePath !== activeDelete.relativePath ||
								commit.recursive !== activeDelete.recursive
							) {
								throw invalidDeletePlan();
							}
							deleteNode(activeDelete.relativePath);
							activeDelete = undefined;
							return { status: "deleted" };
						}
						case "workspace_stat": {
							const relativePath = request?.relativePath ?? "";
							if (request?.rootId !== rootId) {
								throw entryNotFound();
							}
							const node = resolveNode(relativePath);
							return {
								kind: node.kind,
								size: node.kind === "file" ? node.bytes.byteLength : 0,
								mtime: 1_700_000_000_000,
								ctime: 1_699_999_000_000,
								version: node.kind === "file" ? node.version : null,
							};
						}
						case "workspace_read_dir": {
							const relativePath = request?.relativePath ?? "";
							if (request?.rootId !== rootId) {
								throw entryNotFound();
							}
							const node = resolveNode(relativePath);
							if (node.kind !== "directory") {
								throw entryTypeMismatch();
							}
							const entries = [...node.entries]
								.map(([name, child]) => ({ name, kind: child.kind }))
								.sort((left, right) =>
									left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
								);
							return { entries };
						}
						case "workspace_read_file": {
							const relativePath = request?.relativePath ?? "";
							if (request?.rootId !== rootId) {
								throw entryNotFound();
							}
							const node = resolveNode(relativePath);
							if (node.kind !== "file") {
								throw entryTypeMismatch();
							}
							const frame = plr1Frame(
								node.bytes,
								1_700_000_000_000,
								1_699_999_000_000,
								node.version,
							);
							return rawReadTransport === "arrayBuffer"
								? frame.buffer
								: [...frame];
						}
						default:
							throw new Error(`Unexpected Tauri test command: ${command}`);
					}
				},
			};
		},
		{
			goldenRead: workspaceVersionFixture.read,
			mode,
			rawReadTransport,
		},
	);
}

async function installCapabilityFailureIpcMock(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const calls: Array<{
			command: string;
			args: Record<string, unknown>;
		}> = [];
		let nextCallbackId = 0;
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: typeof calls;
			__TAURI_EVENT_PLUGIN_INTERNALS__: {
				unregisterListener(): void;
			};
			__TAURI_INTERNALS__: {
				invoke(
					command: string,
					args?: Record<string, unknown>,
				): Promise<unknown>;
				transformCallback(): number;
				unregisterCallback(): void;
			};
		};
		testWindow.__PLAIN_TEST_TAURI_CALLS__ = calls;
		testWindow.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
			unregisterListener() {},
		};
		testWindow.__TAURI_INTERNALS__ = {
			transformCallback() {
				nextCallbackId += 1;
				return nextCallbackId;
			},
			unregisterCallback() {},
			async invoke(command, args = {}) {
				calls.push({ command, args });
				if (command === "workspace_capabilities") {
					throw {
						code: "CAPABILITY_UNAVAILABLE",
						message: "Workspace capabilities are unavailable.",
					};
				}
				throw new Error(`Unexpected Tauri test command: ${command}`);
			},
		};
	});
}

async function executePaletteCommand(
	page: Page,
	query: string,
	label: string,
): Promise<void> {
	await page.keyboard.press("ControlOrMeta+Shift+P");
	const palette = page.locator(".quick-input-widget");
	await expect(palette).toBeVisible();
	await palette.locator("input").pressSequentially(query);

	const command = palette.getByText(label, { exact: true });
	await expect(command).toHaveCount(1);
	await command.click();
	await expect(palette).toBeHidden();
}

async function expectPaletteCommandHidden(
	page: Page,
	query: string,
	label: string,
): Promise<void> {
	await page.keyboard.press("ControlOrMeta+Shift+P");
	const palette = page.locator(".quick-input-widget");
	await expect(palette).toBeVisible();
	await palette.locator("input").pressSequentially(query);
	await expect(palette.getByText(label, { exact: true })).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(palette).toBeHidden();
}

async function openNativeWorkspaceExplorer(page: Page): Promise<Locator> {
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{ timeout: 60_000 },
	);
	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
	await page.getByRole("tab", { name: /^Explorer / }).click();
	const explorer = page.getByRole("tree", { name: "Files Explorer" });
	await expect(explorer).toBeVisible();
	return explorer;
}

async function explorerContextAction(
	page: Page,
	item: Locator,
	label: string,
): Promise<Locator> {
	await item.click({ button: "right" });
	const action = page.getByRole("menuitem", { name: label }).last();
	await expect(action).toBeVisible();
	return action;
}

async function finishExplorerNameInput(
	page: Page,
	name: string,
): Promise<void> {
	const input = page.getByRole("textbox", {
		name: "Type file name. Press Enter to confirm or Escape to cancel.",
		exact: true,
	});
	await expect(input).toBeVisible();
	await input.fill(name);
	await input.press("Enter");
}

const nativeMutationCommands = [
	"workspace_create_file",
	"workspace_create_directory",
	"workspace_rename",
	"workspace_copy",
	"workspace_move",
	"workspace_prepare_delete",
	"workspace_cancel_delete",
	"workspace_begin_delete",
	"workspace_commit_delete_entry",
	"workspace_write_file",
	"workspace_remove_root",
] as const;

test("fails closed before workspace bootstrap when capabilities are unavailable", async ({
	page,
}) => {
	await installCapabilityFailureIpcMock(page);
	await page.goto("/");
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"error",
	);
	const workspaceInvocations = await page.evaluate(() => {
		const testWindow = window as unknown as Window & {
			__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
		};
		return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(({ command }) =>
			command.startsWith("workspace_"),
		);
	});
	expect(workspaceInvocations).toEqual([
		{ command: "workspace_capabilities", args: { request: {} } },
	]);
});

for (const rawReadTransport of ["arrayBuffer", "numberArray"] as const) {
	test(`projects a selected folder into Explorer and opens files via ${rawReadTransport}`, async ({
		page,
	}) => {
		const errors: string[] = [];
		await installNativeIpcMock(page, rawReadTransport);
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});

		await page.goto("/");
		await expect(page.locator("body")).toHaveAttribute(
			"data-plain-ready",
			"true",
			{ timeout: 60_000 },
		);
		await expect(
			page.getByRole("treeitem", { name: "README.md", exact: true }),
		).toHaveCount(0);
		await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
		await page.getByRole("tab", { name: /^Explorer / }).click();

		const explorer = page.getByRole("tree", { name: "Files Explorer" });
		await expect(explorer).toBeVisible();
		const readme = explorer.getByRole("treeitem", {
			name: "README.md",
			exact: true,
		});
		await expect(readme).toHaveCount(1);
		await readme.dblclick();
		await expect(
			page.getByRole("tab", { name: /^README\.md(?:,.*)?$/ }),
		).toBeVisible();
		await expect(
			page.getByRole("code").filter({ hasText: "Read-only Explorer fixture." }),
		).toBeVisible();

		const src = explorer.getByRole("treeitem", { name: "src", exact: true });
		await src.click();
		await page.keyboard.press("ArrowRight");
		await expect(src).toHaveAttribute("aria-expanded", "true");
		const main = explorer.getByRole("treeitem", {
			name: "main.ts",
			exact: true,
		});
		await expect(main).toHaveCount(1);
		await main.dblclick();
		await expect(
			page.getByRole("tab", { name: /^main\.ts(?:,.*)?$/ }),
		).toBeVisible();
		await expect(
			page.getByRole("code").filter({ hasText: "export const plain = true;" }),
		).toBeVisible();

		await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
		await expectPaletteCommandHidden(
			page,
			"Open Workspace from File",
			"Workspaces: Open Workspace from File...",
		);
		await expectPaletteCommandHidden(
			page,
			"Save Workspace As",
			"Workspaces: Save Workspace As...",
		);
		await expectPaletteCommandHidden(
			page,
			"Duplicate As Workspace",
			"Workspaces: Duplicate As Workspace in New Window",
		);

		await expect(
			page.locator(".notifications-toasts .notification-toast"),
		).toHaveCount(0);
		const bootstrapInvocations = await page.evaluate(() => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			const workspaceInvocations = testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
				({ command }) => command.startsWith("workspace_"),
			);
			return {
				capabilities: workspaceInvocations.filter(
					({ command }) => command === "workspace_capabilities",
				),
				firstTwo: workspaceInvocations.slice(0, 2),
			};
		});
		expect(bootstrapInvocations.capabilities).toEqual([
			{ command: "workspace_capabilities", args: { request: {} } },
		]);
		expect(bootstrapInvocations.firstTwo).toEqual([
			{ command: "workspace_capabilities", args: { request: {} } },
			{ command: "workspace_snapshot", args: { request: {} } },
		]);
		const workspaceInvocations = await page.evaluate(() => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
				({ command }) => command === "workspace_pick_roots",
			);
		});
		expect(workspaceInvocations).toEqual([
			{
				command: "workspace_pick_roots",
				args: { request: { mode: "replace" } },
			},
			{
				command: "workspace_pick_roots",
				args: { request: { mode: "replace" } },
			},
		]);
		const fileReadInvocations = await page.evaluate(() => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
				({ command }) => command === "workspace_read_file",
			);
		});
		const fileReadRequests = fileReadInvocations.map(
			({ args }) =>
				args.request as {
					readonly rootId: string;
					readonly relativePath: string;
				},
		);
		expect(fileReadRequests.map(({ relativePath }) => relativePath)).toEqual(
			expect.arrayContaining(["README.md", "src/main.ts"]),
		);
		expect(
			fileReadRequests.every(({ rootId }) => rootId === nativeRootId),
		).toBe(true);
		expect(errors).toEqual([]);
	});
}

test("routes all-five workspace CRUD, save, rename and permanent delete through native IPC", async ({
	page,
}) => {
	const errors: string[] = [];
	await installNativeIpcMock(page, "arrayBuffer", "supported");
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
		origin: "http://127.0.0.1:1420",
	});
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});

	const explorer = await openNativeWorkspaceExplorer(page);
	const readme = explorer.getByRole("treeitem", {
		name: "README.md",
		exact: true,
	});
	await readme.dblclick();
	const editor = page
		.getByRole("code")
		.filter({ hasText: "Read-only Explorer fixture." });
	await expect(editor).toBeVisible();
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "Read-only Explorer fixture." })
		.click();
	const savedContent = "# Native workspace\n\nSaved by Browser E2E.\n";
	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.type(savedContent);
	const activeTab = page.locator(".tabs-container .tab.active");
	await page.keyboard.press("ControlOrMeta+S");
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command }) => command === "workspace_write_file",
				).length;
			}),
		)
		.toBe(1);
	await expect(activeTab).not.toHaveClass(/dirty/);
	await expect(
		page.getByRole("code").filter({ hasText: "Saved by Browser E2E." }),
	).toBeVisible();

	const src = explorer.getByRole("treeitem", { name: "src", exact: true });
	await src.click();
	await page.keyboard.press("ArrowRight");
	await expect(src).toHaveAttribute("aria-expanded", "true");

	await page
		.getByRole("button", { name: "New Folder...", exact: true })
		.click();
	await finishExplorerNameInput(page, "scratch");
	const scratch = explorer.getByRole("treeitem", {
		name: "scratch",
		exact: true,
	});
	await expect(scratch).toBeVisible();

	await src.click();
	await page.getByRole("button", { name: "New File...", exact: true }).click();
	await finishExplorerNameInput(page, "draft.txt");
	const draft = explorer.getByRole("treeitem", {
		name: "draft.txt",
		exact: true,
	});
	await expect(draft).toBeVisible();

	const main = explorer.getByRole("treeitem", {
		name: "main.ts",
		exact: true,
	});
	await main.click();
	await page.keyboard.press("ControlOrMeta+C");
	await scratch.click();
	await page.keyboard.press("ControlOrMeta+V");
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command }) => command === "workspace_copy",
				).length;
			}),
		)
		.toBe(1);
	await scratch.click();
	await page.keyboard.press("ArrowRight");
	await expect(scratch).toHaveAttribute("aria-expanded", "true");
	await expect(
		explorer
			.locator('[role="treeitem"][aria-level="3"]')
			.filter({ hasText: "main.ts" }),
	).toHaveCount(1);

	await scratch.click();
	await page.keyboard.press("Enter");
	await finishExplorerNameInput(page, "renamed");
	await expect(scratch).toHaveCount(0);
	const renamed = explorer.getByRole("treeitem", {
		name: "renamed",
		exact: true,
	});
	await expect(renamed).toBeVisible();

	await renamed.click();
	const dialogPromise = page.waitForEvent("dialog");
	const deleteKey = page.keyboard.press("ControlOrMeta+Backspace");
	const dialog = await dialogPromise;
	expect(dialog.type()).toBe("confirm");
	expect(dialog.message()).toContain("永久删除“renamed”？");
	expect(dialog.message()).toContain("此操作永久且不可撤销");
	expect(dialog.message()).toContain("不会移入废纸篓");
	await dialog.accept();
	await deleteKey;
	await expect(renamed).toHaveCount(0);

	const mutations = await page.evaluate(
		(commands) => {
			const testWindow = window as unknown as Window & {
				__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
			};
			return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(({ command }) =>
				commands.includes(command),
			);
		},
		nativeMutationCommands as readonly string[],
	);
	expect(mutations.map(({ command }) => command)).toEqual([
		"workspace_write_file",
		"workspace_create_directory",
		"workspace_create_file",
		"workspace_copy",
		"workspace_rename",
		"workspace_prepare_delete",
		"workspace_begin_delete",
		"workspace_commit_delete_entry",
	]);
	const write = mutations[0]!.args;
	expect(write.request).toMatchObject({
		rootId: nativeRootId,
		relativePath: "README.md",
		expectedVersion: expect.stringMatching(/^wv1:[0-9a-f]{64}$/),
	});
	expect(write.contentHex).toBe(
		[...new TextEncoder().encode(savedContent)]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join(""),
	);
	expect(mutations[1]!.args).toEqual({
		request: { rootId: nativeRootId, relativePath: "src/scratch" },
	});
	expect(mutations[2]!.args).toEqual({
		request: { rootId: nativeRootId, relativePath: "src/draft.txt" },
	});
	expect(mutations[3]!.args).toEqual({
		request: {
			sourceRootId: nativeRootId,
			sourcePath: "src/main.ts",
			targetRootId: nativeRootId,
			targetPath: "src/scratch/main.ts",
		},
	});
	expect(mutations[4]!.args).toEqual({
		request: {
			rootId: nativeRootId,
			sourcePath: "src/scratch",
			targetPath: "src/renamed",
		},
	});
	const prepared = mutations[5]!.args.request as {
		readonly entries: readonly {
			readonly rootId: string;
			readonly relativePath: string;
			readonly recursive: boolean;
		}[];
	};
	expect(prepared).toEqual({
		entries: [
			{
				rootId: nativeRootId,
				relativePath: "src/renamed",
				recursive: true,
			},
		],
	});
	const begin = mutations[6]!.args.request as {
		readonly confirmationId: string;
	};
	const commit = mutations[7]!.args.request as {
		readonly confirmationId: string;
		readonly entryId: string;
		readonly rootId: string;
		readonly relativePath: string;
		readonly recursive: boolean;
	};
	expect(begin.confirmationId).toMatch(
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	);
	expect(commit).toMatchObject({
		confirmationId: begin.confirmationId,
		entryId: expect.stringMatching(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		),
		rootId: nativeRootId,
		relativePath: "src/renamed",
		recursive: true,
	});
	expect(commit.entryId).not.toBe(commit.confirmationId);
	await expect(
		page.locator(".notifications-toasts .notification-toast"),
	).toHaveCount(0);
	expect(errors).toEqual([]);
});

test("keeps the entire provider readonly when one platform capability is false", async ({
	page,
}) => {
	await installNativeIpcMock(page, "arrayBuffer", "readonly");
	const explorer = await openNativeWorkspaceExplorer(page);
	const readme = explorer.getByRole("treeitem", {
		name: "README.md",
		exact: true,
	});
	await readme.dblclick();
	const editor = page
		.getByRole("code")
		.filter({ hasText: "Read-only Explorer fixture." });
	await expect(editor).toBeVisible();
	const activeTab = page.locator(".tabs-container .tab.active");
	await expect(activeTab).not.toHaveClass(/dirty/);
	await page
		.locator(".monaco-editor .view-line")
		.filter({ hasText: "Read-only Explorer fixture." })
		.click();
	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.type("This write must stay blocked.");
	await page.keyboard.press("ControlOrMeta+S");
	await expect(activeTab).not.toHaveClass(/dirty/);
	await expect(editor).toContainText("Read-only Explorer fixture.");

	const src = explorer.getByRole("treeitem", { name: "src", exact: true });
	await expect(
		page.getByRole("button", { name: "New File...", exact: true }),
	).toHaveAttribute("aria-disabled", "true");
	await expect(
		page.getByRole("button", { name: "New Folder...", exact: true }),
	).toHaveAttribute("aria-disabled", "true");
	const rename = await explorerContextAction(page, src, "Rename...");
	await expect(rename).toHaveAttribute("aria-disabled", "true");
	await page.keyboard.press("Escape");

	const dialogs: string[] = [];
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const consoleWarnings: string[] = [];
	let signalDialog!: () => void;
	const dialogArrival = new Promise<void>((resolve) => {
		signalDialog = resolve;
	});
	const onDialog = (dialog: Dialog): void => {
		dialogs.push(dialog.message());
		signalDialog();
		void dialog.dismiss();
	};
	const onPageError = (error: Error): void => {
		pageErrors.push(error.message);
	};
	const onConsole = (message: ConsoleMessage): void => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		} else if (message.type() === "warning") {
			consoleWarnings.push(message.text());
		}
	};
	page.on("dialog", onDialog);
	page.on("pageerror", onPageError);
	page.on("console", onConsole);
	try {
		await src.click();
		const noDialogWindow = Promise.race([
			dialogArrival.then(() => false),
			page.waitForTimeout(500).then(() => true),
		]);
		await page.keyboard.press("ControlOrMeta+Backspace");
		expect(await noDialogWindow).toBe(true);
		await expect
			.poll(
				() =>
					consoleWarnings.filter((message) =>
						message.includes("The permanent delete selection is invalid."),
					).length,
			)
			.toBe(1);
		await expect
			.poll(async () =>
				page.evaluate(
					(commands) => {
						const testWindow = window as unknown as Window & {
							__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
						};
						return testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(({ command }) =>
							commands.includes(command),
						).length;
					},
					nativeMutationCommands as readonly string[],
				),
			)
			.toBe(0);
		await page.evaluate(
			() =>
				new Promise<void>((resolve) => {
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
				}),
		);
		await expect(src).toBeVisible();

		const audit = await page.evaluate(
			(commands) => {
				const testWindow = window as unknown as Window & {
					__PLAIN_TEST_TAURI_CALLS__: TestTauriInvocation[];
				};
				const workspaceCalls = testWindow.__PLAIN_TEST_TAURI_CALLS__.filter(
					({ command }) => command.startsWith("workspace_"),
				);
				return {
					capabilities: workspaceCalls.filter(
						({ command }) => command === "workspace_capabilities",
					),
					mutations: workspaceCalls.filter(({ command }) =>
						commands.includes(command),
					),
				};
			},
			nativeMutationCommands as readonly string[],
		);
		expect(audit.capabilities).toEqual([
			{ command: "workspace_capabilities", args: { request: {} } },
		]);
		expect(audit.mutations).toEqual([]);
	} finally {
		page.off("dialog", onDialog);
		page.off("pageerror", onPageError);
		page.off("console", onConsole);
	}
	expect(dialogs).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
	expect(consoleWarnings).toHaveLength(1);
	expect(consoleWarnings[0]).toContain(
		"The permanent delete selection is invalid.",
	);
});
