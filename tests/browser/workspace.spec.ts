import { expect, test, type Page } from "@playwright/test";

import workspaceVersionFixture from "../fixtures/workspace-version-v1.json" with { type: "json" };

interface TestTauriInvocation {
	readonly command: string;
	readonly args: Record<string, unknown>;
}

const nativeRootId = "00000000-0000-4000-8000-000000000101";
type RawReadTransport = "arrayBuffer" | "numberArray";

async function installNativeIpcMock(
	page: Page,
	rawReadTransport: RawReadTransport,
): Promise<void> {
	await page.addInitScript(
		({ goldenRead, rawReadTransport }) => {
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
			const fileContents = new Map([
				["README.md", "# Native workspace\n\nRead-only Explorer fixture.\n"],
				["src/main.ts", "export const plain = true;\n"],
			]);
			const entryKinds = new Map([
				["", "directory"],
				["README.md", "file"],
				["src", "directory"],
				["src/main.ts", "file"],
			]);
			const directories = new Map([
				[
					"",
					[
						{ name: "README.md", kind: "file" },
						{ name: "src", kind: "directory" },
					],
				],
				["src", [{ name: "main.ts", kind: "file" }]],
			]);
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
								renameNoReplace: false,
								copyMove: false,
								delete: false,
								versionedWrite: false,
							};
						case "workspace_snapshot":
							return emptySnapshot;
						case "workspace_pick_roots":
							return { status: "selected", snapshot: selectedSnapshot };
						case "workspace_stat": {
							const relativePath = request?.relativePath ?? "";
							const kind = entryKinds.get(relativePath);
							if (request?.rootId !== rootId || kind === undefined) {
								throw {
									code: "ENTRY_NOT_FOUND",
									message: "The workspace entry does not exist.",
								};
							}
							return {
								kind,
								size: new TextEncoder().encode(
									fileContents.get(relativePath) ?? "",
								).byteLength,
								mtime: 1_700_000_000_000,
								ctime: 1_699_999_000_000,
								version: null,
							};
						}
						case "workspace_read_dir": {
							const relativePath = request?.relativePath ?? "";
							const entries = directories.get(relativePath);
							if (request?.rootId !== rootId || entries === undefined) {
								throw {
									code: "ENTRY_TYPE_MISMATCH",
									message: "The workspace entry is not a directory.",
								};
							}
							return { entries };
						}
						case "workspace_read_file": {
							const relativePath = request?.relativePath ?? "";
							const content = fileContents.get(relativePath);
							if (request?.rootId !== rootId || content === undefined) {
								throw {
									code: "ENTRY_TYPE_MISMATCH",
									message: "The workspace entry is not a file.",
								};
							}
							const frame = plr1Frame(
								new TextEncoder().encode(content),
								1_700_000_000_000,
								1_699_999_000_000,
								null,
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
