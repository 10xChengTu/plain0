import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "tests/browser",
	fullyParallel: false,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: "line",
	use: {
		baseURL: "http://127.0.0.1:1420",
		trace: "retain-on-failure",
	},
	webServer: {
		command: "pnpm dev",
		url: "http://127.0.0.1:1420",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
