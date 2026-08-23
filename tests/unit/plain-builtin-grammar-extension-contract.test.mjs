import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const wrapperSource = await readFile(
	new URL("app/features/themes/plain-builtin-grammar-extension.ts", root),
	"utf8",
);
const mainSource = await readFile(new URL("app/main.ts", root), "utf8");
const packageDocument = JSON.parse(
	await readFile(new URL("package.json", root), "utf8"),
);
const auditManifest = JSON.parse(
	await readFile(
		new URL("resources/grammars/audit-manifest.json", root),
		"utf8",
	),
);

const packageByAuditName = (name) =>
	`@codingame/monaco-vscode-${name}-default-extension`;

describe("Plain built-in grammar package contract", () => {
	it("pins the audited static sources and every contributed grammar resource", async () => {
		let grammarCount = 0;
		for (const name of auditManifest.packages) {
			const packageName = packageByAuditName(name);
			expect(packageDocument.dependencies[packageName]).toBe("35.0.1");
			const manifest = JSON.parse(
				await readFile(
					new URL(`node_modules/${packageName}/resources/package.json`, root),
					"utf8",
				),
			);
			expect(manifest.main).toBeUndefined();
			expect(manifest.browser).toBeUndefined();
			expect(manifest.activationEvents).toBeUndefined();
			for (const lifecycle of ["preinstall", "install", "postinstall"]) {
				expect(manifest.scripts?.[lifecycle]).toBeUndefined();
			}
			expect(manifest.contributes.languages.length).toBeGreaterThan(0);
			expect(manifest.contributes.grammars.length).toBeGreaterThan(0);
			grammarCount += manifest.contributes.grammars.length;

			expect(wrapperSource).toContain(
				`${packageName}/resources/package.json?raw`,
			);
			for (const grammar of manifest.contributes.grammars) {
				const basename = grammar.path.split("/").at(-1);
				expect(wrapperSource).toContain(
					basename === "Regular Expressions (JavaScript).tmLanguage"
						? "Regular_Expressions_(JavaScript).tmLanguage?raw"
						: `${basename}?raw`,
				);
			}
		}

		expect(auditManifest.runtimeContributionAllowlist).toEqual([
			"languages",
			"grammars",
		]);
		expect(auditManifest.license).toBe("MIT");
		expect(auditManifest.packages).toHaveLength(11);
		expect(grammarCount).toBe(28);
		expect(wrapperSource).toContain(
			"PLAIN_BUILTIN_GRAMMAR_SOURCE_COUNT = sources.length",
		);
		expect(wrapperSource).toContain(
			"PLAIN_BUILTIN_GRAMMAR_COUNT =\n\tmanifest.contributes?.grammars?.length ?? 0",
		);
	});

	it("dispatches only declarative language and grammar users after Workbench initialization", () => {
		expect(wrapperSource).toMatch(
			/for \(const forbidden of \["main", "browser", "activationEvents"\]\)/u,
		);
		expect(wrapperSource).toContain("languageService.registerLanguage({");
		expect(wrapperSource).toContain("languageConfigurationService.register(");
		expect(wrapperSource).toContain(
			"LanguageConfigurationFileHandler.extractValidConfig(",
		);
		expect(
			wrapperSource.indexOf("languageService.registerLanguage({"),
		).toBeLessThan(
			wrapperSource.indexOf("languageConfigurationService.register("),
		);
		expect(
			wrapperSource.indexOf("languageConfigurationService.register("),
		).toBeLessThan(
			wrapperSource.indexOf("grammarsExtPoint as typeof grammarsExtPoint"),
		);
		expect(wrapperSource).toContain(
			"grammarsExtPoint as typeof grammarsExtPoint",
		);
		expect(wrapperSource).toContain("registerExtension(manifest, undefined, {");
		expect(wrapperSource).toContain("system: true");
		expect(wrapperSource).not.toContain("ExtensionHostKind");
		expect(wrapperSource).not.toContain("setLocalExtensionHost");
		expect(wrapperSource).not.toContain("enableWorkerExtensionHost");
		expect(mainSource).toContain(
			'import { registerPlainBuiltinGrammarResources } from "./features/themes/plain-builtin-grammar-extension";',
		);
		expect(
			mainSource.indexOf("registerPlainBuiltinGrammarResources("),
		).toBeGreaterThan(mainSource.indexOf("await initialize("));
		expect(mainSource).not.toMatch(
			/import\s+"@codingame\/monaco-vscode-(?:json|javascript|typescript-basics|html|css|markdown-basics|shellscript|python|rust|yaml|xml)-default-extension"/u,
		);
	});
});
