import { expect, test, type Page } from "@playwright/test";

const excludedCommands = [
	"Policy Diagnostics",
	"Sync Account Policy",
	"Start Extension Bisect",
	"Measure Extension Host Latency",
	"Open Installed Web Extensions Resource",
	"Browse Color Themes in Marketplace",
];

async function expectCommandUnavailable(page: Page, label: string): Promise<void> {
	await page.keyboard.press("Meta+Shift+P");
	const palette = page.locator(".quick-input-widget");
	await expect(palette).toBeVisible();
	await palette.locator("input").fill(label);
	await expect(palette).not.toContainText(label);
	await page.keyboard.press("Escape");
}

test("boots the allowlisted Workbench without excluded runtime surfaces", async ({
	page,
	context,
}) => {
	const errors: string[] = [];
	const externalRequests: string[] = [];
	const workers: string[] = [];
	const serviceWorkers: string[] = [];

	page.on("pageerror", error => errors.push(error.message));
	page.on("console", message => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	page.on("request", request => {
		const url = new URL(request.url());
		if (url.hostname !== "127.0.0.1") {
			externalRequests.push(request.url());
		}
	});
	page.on("worker", worker => workers.push(worker.url()));
	context.on("serviceworker", worker => serviceWorkers.push(worker.url()));

	await page.goto("/");

	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ready",
		"true",
		{
			timeout: 60_000,
		},
	);
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-runtime",
		"browser-mock",
	);
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-runtime-event",
		"browser-mock",
	);
	await expect(page.locator("body")).toHaveAttribute(
		"data-plain-ipc-version",
		"1",
	);
	await expect(page.locator(".monaco-workbench")).toBeVisible();
	await expect(page.locator("#plain-bootstrap-status")).toBeHidden();
	await expect(page.getByLabel("Accounts", { exact: true })).toHaveCount(0);

	const manage = page.getByLabel("Manage", { exact: true });
	if ((await manage.count()) > 0) {
		await manage.first().click({ button: "right" });
		await expect(page.locator(".context-view")).not.toContainText("Accounts");
		await page.keyboard.press("Escape");
	}

	for (const command of excludedCommands) {
		await expectCommandUnavailable(page, command);
	}

	expect(errors).toEqual([]);
	expect(externalRequests).toEqual([]);
	expect(workers.some(url => /extension.?host/i.test(url))).toBe(false);
	expect(serviceWorkers).toEqual([]);
});
