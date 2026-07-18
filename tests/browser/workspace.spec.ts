import { expect, test, type Page } from "@playwright/test";

interface TestTauriInvocation {
	readonly command: string;
	readonly args: Record<string, unknown>;
}

async function installNativeIpcMock(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const calls: Array<{
			command: string;
			args: Record<string, unknown>;
		}> = [];
		const workspaceId = "00000000-0000-4000-8000-000000000001";
		const rootId = "00000000-0000-4000-8000-000000000101";
		const snapshot = {
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
					case "workspace_snapshot":
						return snapshot;
					case "workspace_pick_roots":
						return { status: "selected", snapshot };
					default:
						throw new Error(`Unexpected Tauri test command: ${command}`);
				}
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

test("reuses the existing Open Folder action through the workspace bridge", async ({
	page,
}) => {
	const errors: string[] = [];
	await installNativeIpcMock(page);
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

	await executePaletteCommand(page, "Open Folder", "File: Open Folder...");
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
	expect(errors).toEqual([]);
});
