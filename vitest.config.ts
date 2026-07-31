import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.mjs"],
		environment: "node",
		// The source-contract suites parse and mutate large TypeScript/Rust
		// fixtures. A cold local run measured one at 5.4s, while a real
		// GitHub-hosted Ubuntu run exceeded 5s in several independent cases, so
		// use bounded allowances that reflect both hosts.
		testTimeout: process.env.CI ? 20_000 : 10_000,
	},
});
