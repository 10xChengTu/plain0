import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const WRAPPER_SOURCE = await readFile(
	new URL(
		"../../app/features/themes/plain-builtin-theme-extension.ts",
		import.meta.url,
	),
	"utf8",
);
const MAIN_SOURCE = await readFile(
	new URL("../../app/main.ts", import.meta.url),
	"utf8",
);
const UPSTREAM_SOURCE = await readFile(
	new URL(
		"../../node_modules/@codingame/monaco-vscode-theme-defaults-default-extension/index.js",
		import.meta.url,
	),
	"utf8",
);

describe("packaged built-in theme resource contract", () => {
	it("re-registers every locked upstream resource as a blob instead of importing its tauri asset URLs", () => {
		const upstreamPaths = [
			...UPSTREAM_SOURCE.matchAll(/registerFileUrl\('([^']+)'/g),
		].map((match) => match[1]);
		const wrapperPaths = [
			...WRAPPER_SOURCE.matchAll(/^\s*\["([^"]+)",\s*\w+\],$/gm),
		].map((match) => match[1]);

		expect(upstreamPaths).toHaveLength(23);
		expect(new Set(wrapperPaths)).toEqual(new Set(upstreamPaths));
		expect(WRAPPER_SOURCE).toContain("URL.createObjectURL(");
		expect(WRAPPER_SOURCE).toContain("new Blob([contents]");
		expect(WRAPPER_SOURCE).toContain("new RegisteredReadOnlyFile(");
		expect(WRAPPER_SOURCE).toContain('minimalIconThemeLabel: "Minimal"');
		expect(WRAPPER_SOURCE).not.toContain("Visual Studio Code");
		expect(MAIN_SOURCE).toContain(
			'import { registerPlainBuiltinThemeResources } from "./features/themes/plain-builtin-theme-extension";',
		);
		expect(
			MAIN_SOURCE.indexOf("registerPlainBuiltinThemeResources();"),
		).toBeGreaterThan(MAIN_SOURCE.indexOf("await initialize("));
		expect(MAIN_SOURCE).not.toContain(
			'import "@codingame/monaco-vscode-theme-defaults-default-extension";',
		);
	});
});
