import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.mjs"],
		environment: "node",
		// The source-contract suites parse and mutate large TypeScript/Rust
		// fixtures. They stay below Vitest's 5s default on this development Mac,
		// but a real GitHub-hosted Ubuntu run exceeded it in several otherwise
		// independent cases. Keep the tighter local watchdog while giving CI a
		// bounded allowance that reflects its measured runner speed.
		testTimeout: process.env.CI ? 20_000 : 5_000,
	},
});
