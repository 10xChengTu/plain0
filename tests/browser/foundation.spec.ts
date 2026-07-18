import { expect, test } from "@playwright/test";

test("boots the allowlisted Workbench with the browser IPC mock", async ({
	page,
}) => {
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
});
