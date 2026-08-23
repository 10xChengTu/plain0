import {
	getBuiltinExtensions,
	registerExtension,
	type IExtensionManifest,
} from "@codingame/monaco-vscode-api/extensions";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import type { ILanguageExtensionPoint } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/languages/language";
import type { ILanguageConfigurationService } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/languages/languageConfigurationRegistry.service";
import type { ILanguageService } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/languages/language.service";
import {
	LanguageConfigurationFileHandler,
	type ILanguageConfiguration,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/codeEditor/common/languageConfigurationExtensionPoint";
import { toExtensionDescription } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensions/common/extensions";
import { ExtensionMessageCollector } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensions/common/extensionsRegistry";
import { grammarsExtPoint } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/textMate/common/TMGrammars";
import {
	RegisteredReadOnlyFile,
	registerExtensionFile,
} from "@codingame/monaco-vscode-files-service-override";

import cssConfiguration from "@codingame/monaco-vscode-css-default-extension/resources/language-configuration.json?raw";
import cssPackage from "@codingame/monaco-vscode-css-default-extension/resources/package.json?raw";
import cssGrammar from "@codingame/monaco-vscode-css-default-extension/resources/css.tmLanguage.json?raw";
import htmlConfiguration from "@codingame/monaco-vscode-html-default-extension/resources/language-configuration.json?raw";
import htmlPackage from "@codingame/monaco-vscode-html-default-extension/resources/package.json?raw";
import htmlDerivativeGrammar from "@codingame/monaco-vscode-html-default-extension/resources/html-derivative.tmLanguage.json?raw";
import htmlGrammar from "@codingame/monaco-vscode-html-default-extension/resources/html.tmLanguage.json?raw";
import javascriptConfiguration from "@codingame/monaco-vscode-javascript-default-extension/resources/javascript-language-configuration.json?raw";
import javascriptPackage from "@codingame/monaco-vscode-javascript-default-extension/resources/package.json?raw";
import javascriptGrammar from "@codingame/monaco-vscode-javascript-default-extension/resources/JavaScript.tmLanguage.json?raw";
import javascriptReactGrammar from "@codingame/monaco-vscode-javascript-default-extension/resources/JavaScriptReact.tmLanguage.json?raw";
import javascriptRegexGrammar from "@codingame/monaco-vscode-javascript-default-extension/resources/Regular_Expressions_(JavaScript).tmLanguage?raw";
import javascriptTagsConfiguration from "@codingame/monaco-vscode-javascript-default-extension/resources/tags-language-configuration.json?raw";
import jsonConfiguration from "@codingame/monaco-vscode-json-default-extension/resources/language-configuration.json?raw";
import jsonPackage from "@codingame/monaco-vscode-json-default-extension/resources/package.json?raw";
import jsonGrammar from "@codingame/monaco-vscode-json-default-extension/resources/JSON.tmLanguage.json?raw";
import jsoncGrammar from "@codingame/monaco-vscode-json-default-extension/resources/JSONC.tmLanguage.json?raw";
import jsonlGrammar from "@codingame/monaco-vscode-json-default-extension/resources/JSONL.tmLanguage.json?raw";
import snippetsGrammar from "@codingame/monaco-vscode-json-default-extension/resources/snippets.tmLanguage.json?raw";
import markdownConfiguration from "@codingame/monaco-vscode-markdown-basics-default-extension/resources/language-configuration.json?raw";
import markdownPackage from "@codingame/monaco-vscode-markdown-basics-default-extension/resources/package.json?raw";
import markdownGrammar from "@codingame/monaco-vscode-markdown-basics-default-extension/resources/markdown.tmLanguage.json?raw";
import pythonConfiguration from "@codingame/monaco-vscode-python-default-extension/resources/language-configuration.json?raw";
import pythonPackage from "@codingame/monaco-vscode-python-default-extension/resources/package.json?raw";
import pythonGrammar from "@codingame/monaco-vscode-python-default-extension/resources/MagicPython.tmLanguage.json?raw";
import pythonRegexGrammar from "@codingame/monaco-vscode-python-default-extension/resources/MagicRegExp.tmLanguage.json?raw";
import rustConfiguration from "@codingame/monaco-vscode-rust-default-extension/resources/language-configuration.json?raw";
import rustPackage from "@codingame/monaco-vscode-rust-default-extension/resources/package.json?raw";
import rustGrammar from "@codingame/monaco-vscode-rust-default-extension/resources/rust.tmLanguage.json?raw";
import shellConfiguration from "@codingame/monaco-vscode-shellscript-default-extension/resources/language-configuration.json?raw";
import shellPackage from "@codingame/monaco-vscode-shellscript-default-extension/resources/package.json?raw";
import shellGrammar from "@codingame/monaco-vscode-shellscript-default-extension/resources/shell-unix-bash.tmLanguage.json?raw";
import typescriptConfiguration from "@codingame/monaco-vscode-typescript-basics-default-extension/resources/language-configuration.json?raw";
import typescriptPackage from "@codingame/monaco-vscode-typescript-basics-default-extension/resources/package.json?raw";
import javascriptDocInjection from "@codingame/monaco-vscode-typescript-basics-default-extension/resources/jsdoc.js.injection.tmLanguage.json?raw";
import typescriptDocInjection from "@codingame/monaco-vscode-typescript-basics-default-extension/resources/jsdoc.ts.injection.tmLanguage.json?raw";
import typescriptGrammar from "@codingame/monaco-vscode-typescript-basics-default-extension/resources/TypeScript.tmLanguage.json?raw";
import typescriptReactGrammar from "@codingame/monaco-vscode-typescript-basics-default-extension/resources/TypeScriptReact.tmLanguage.json?raw";
import xmlPackage from "@codingame/monaco-vscode-xml-default-extension/resources/package.json?raw";
import xmlConfiguration from "@codingame/monaco-vscode-xml-default-extension/resources/xml.language-configuration.json?raw";
import xmlGrammar from "@codingame/monaco-vscode-xml-default-extension/resources/xml.tmLanguage.json?raw";
import xslConfiguration from "@codingame/monaco-vscode-xml-default-extension/resources/xsl.language-configuration.json?raw";
import xslGrammar from "@codingame/monaco-vscode-xml-default-extension/resources/xsl.tmLanguage.json?raw";
import yamlConfiguration from "@codingame/monaco-vscode-yaml-default-extension/resources/language-configuration.json?raw";
import yamlPackage from "@codingame/monaco-vscode-yaml-default-extension/resources/package.json?raw";
import yaml10Grammar from "@codingame/monaco-vscode-yaml-default-extension/resources/yaml-1.0.tmLanguage.json?raw";
import yaml11Grammar from "@codingame/monaco-vscode-yaml-default-extension/resources/yaml-1.1.tmLanguage.json?raw";
import yaml12Grammar from "@codingame/monaco-vscode-yaml-default-extension/resources/yaml-1.2.tmLanguage.json?raw";
import yaml13Grammar from "@codingame/monaco-vscode-yaml-default-extension/resources/yaml-1.3.tmLanguage.json?raw";
import yamlEmbeddedGrammar from "@codingame/monaco-vscode-yaml-default-extension/resources/yaml-embedded.tmLanguage.json?raw";
import yamlGrammar from "@codingame/monaco-vscode-yaml-default-extension/resources/yaml.tmLanguage.json?raw";

interface StaticGrammarSource {
	readonly key: string;
	readonly packageJson: string;
	readonly resources: Readonly<Record<string, string>>;
}

const sources: readonly StaticGrammarSource[] = Object.freeze([
	{
		key: "json",
		packageJson: jsonPackage,
		resources: {
			"language-configuration.json": jsonConfiguration,
			"syntaxes/JSON.tmLanguage.json": jsonGrammar,
			"syntaxes/JSONC.tmLanguage.json": jsoncGrammar,
			"syntaxes/JSONL.tmLanguage.json": jsonlGrammar,
			"syntaxes/snippets.tmLanguage.json": snippetsGrammar,
		},
	},
	{
		key: "javascript",
		packageJson: javascriptPackage,
		resources: {
			"javascript-language-configuration.json": javascriptConfiguration,
			"tags-language-configuration.json": javascriptTagsConfiguration,
			"syntaxes/JavaScript.tmLanguage.json": javascriptGrammar,
			"syntaxes/JavaScriptReact.tmLanguage.json": javascriptReactGrammar,
			"syntaxes/Regular Expressions (JavaScript).tmLanguage":
				javascriptRegexGrammar,
		},
	},
	{
		key: "typescript",
		packageJson: typescriptPackage,
		resources: {
			"language-configuration.json": typescriptConfiguration,
			"syntaxes/TypeScript.tmLanguage.json": typescriptGrammar,
			"syntaxes/TypeScriptReact.tmLanguage.json": typescriptReactGrammar,
			"syntaxes/jsdoc.js.injection.tmLanguage.json": javascriptDocInjection,
			"syntaxes/jsdoc.ts.injection.tmLanguage.json": typescriptDocInjection,
		},
	},
	{
		key: "html",
		packageJson: htmlPackage,
		resources: {
			"language-configuration.json": htmlConfiguration,
			"syntaxes/html-derivative.tmLanguage.json": htmlDerivativeGrammar,
			"syntaxes/html.tmLanguage.json": htmlGrammar,
		},
	},
	{
		key: "css",
		packageJson: cssPackage,
		resources: {
			"language-configuration.json": cssConfiguration,
			"syntaxes/css.tmLanguage.json": cssGrammar,
		},
	},
	{
		key: "markdown",
		packageJson: markdownPackage,
		resources: {
			"language-configuration.json": markdownConfiguration,
			"syntaxes/markdown.tmLanguage.json": markdownGrammar,
		},
	},
	{
		key: "shellscript",
		packageJson: shellPackage,
		resources: {
			"language-configuration.json": shellConfiguration,
			"syntaxes/shell-unix-bash.tmLanguage.json": shellGrammar,
		},
	},
	{
		key: "python",
		packageJson: pythonPackage,
		resources: {
			"language-configuration.json": pythonConfiguration,
			"syntaxes/MagicPython.tmLanguage.json": pythonGrammar,
			"syntaxes/MagicRegExp.tmLanguage.json": pythonRegexGrammar,
		},
	},
	{
		key: "rust",
		packageJson: rustPackage,
		resources: {
			"language-configuration.json": rustConfiguration,
			"syntaxes/rust.tmLanguage.json": rustGrammar,
		},
	},
	{
		key: "yaml",
		packageJson: yamlPackage,
		resources: {
			"language-configuration.json": yamlConfiguration,
			"syntaxes/yaml-1.0.tmLanguage.json": yaml10Grammar,
			"syntaxes/yaml-1.1.tmLanguage.json": yaml11Grammar,
			"syntaxes/yaml-1.2.tmLanguage.json": yaml12Grammar,
			"syntaxes/yaml-1.3.tmLanguage.json": yaml13Grammar,
			"syntaxes/yaml-embedded.tmLanguage.json": yamlEmbeddedGrammar,
			"syntaxes/yaml.tmLanguage.json": yamlGrammar,
		},
	},
	{
		key: "xml",
		packageJson: xmlPackage,
		resources: {
			"xml.language-configuration.json": xmlConfiguration,
			"xsl.language-configuration.json": xslConfiguration,
			"syntaxes/xml.tmLanguage.json": xmlGrammar,
			"syntaxes/xsl.tmLanguage.json": xslGrammar,
		},
	},
] as StaticGrammarSource[]);

function asRecord(value: unknown, context: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`Plain built-in grammar ${context} must be an object`);
	}
	return value as Record<string, unknown>;
}

function prefixedPath(key: string, rawPath: string): string {
	const path = rawPath.startsWith("./") ? rawPath.slice(2) : rawPath;
	if (path.length === 0 || path.includes("..") || path.startsWith("/")) {
		throw new Error(`Plain built-in grammar path is unsafe: ${rawPath}`);
	}
	return `./${key}/${path}`;
}

function mergeStringArrays(
	left: unknown,
	right: unknown,
): readonly string[] | undefined {
	const values = [left, right]
		.flatMap((value) => (Array.isArray(value) ? value : []))
		.filter((value): value is string => typeof value === "string");
	return values.length === 0 ? undefined : [...new Set(values)];
}

function buildManifest(): IExtensionManifest {
	const languages = new Map<string, Record<string, unknown>>();
	const grammars: Record<string, unknown>[] = [];

	for (const source of sources) {
		const packageManifest = asRecord(
			JSON.parse(source.packageJson) as unknown,
			`${source.key} package manifest`,
		);
		for (const forbidden of ["main", "browser", "activationEvents"]) {
			if (forbidden in packageManifest) {
				throw new Error(
					`Plain built-in grammar source ${source.key} declares forbidden ${forbidden}`,
				);
			}
		}
		const contributes = asRecord(
			packageManifest.contributes,
			`${source.key} contributes`,
		);
		if (
			!Array.isArray(contributes.languages) ||
			!Array.isArray(contributes.grammars)
		) {
			throw new Error(
				`Plain built-in grammar source ${source.key} must declare languages and grammars`,
			);
		}

		for (const rawLanguage of contributes.languages) {
			const language = asRecord(rawLanguage, `${source.key} language`);
			if (typeof language.id !== "string" || language.id.length === 0) {
				throw new Error(
					`Plain built-in grammar ${source.key} has an invalid language id`,
				);
			}
			const existing = languages.get(language.id);
			const configuration =
				typeof language.configuration === "string"
					? prefixedPath(source.key, language.configuration)
					: existing?.configuration;
			if (
				typeof language.configuration === "string" &&
				!Object.hasOwn(
					source.resources,
					language.configuration.replace(/^\.\//u, ""),
				)
			) {
				throw new Error(
					`Plain built-in grammar ${source.key} is missing ${language.configuration}`,
				);
			}
			languages.set(language.id, {
				...existing,
				id: language.id,
				aliases: mergeStringArrays(existing?.aliases, language.aliases),
				extensions: mergeStringArrays(
					existing?.extensions,
					language.extensions,
				),
				filenames: mergeStringArrays(existing?.filenames, language.filenames),
				filenamePatterns: mergeStringArrays(
					existing?.filenamePatterns,
					language.filenamePatterns,
				),
				mimetypes: mergeStringArrays(existing?.mimetypes, language.mimetypes),
				firstLine:
					typeof language.firstLine === "string"
						? language.firstLine
						: existing?.firstLine,
				configuration,
			});
		}

		for (const rawGrammar of contributes.grammars) {
			const grammar = asRecord(rawGrammar, `${source.key} grammar`);
			if (typeof grammar.path !== "string") {
				throw new Error(
					`Plain built-in grammar ${source.key} has no resource path`,
				);
			}
			const resourcePath = grammar.path.replace(/^\.\//u, "");
			if (!Object.hasOwn(source.resources, resourcePath)) {
				throw new Error(
					`Plain built-in grammar ${source.key} is missing ${grammar.path}`,
				);
			}
			grammars.push({
				...grammar,
				path: prefixedPath(source.key, grammar.path),
			});
		}
	}

	return {
		name: "builtin-grammars",
		publisher: "plain",
		version: "1.0.0",
		displayName: "Plain Built-in Grammars",
		description: "Audited static language declarations and TextMate grammars",
		engines: { vscode: "*" },
		categories: ["Programming Languages"],
		contributes: {
			languages: [...languages.values()],
			grammars,
		},
	} as unknown as IExtensionManifest;
}

const manifest = buildManifest();
registerExtension(manifest, undefined, { system: true });

const extensionLocation = URI.from({
	scheme: "extension-file",
	authority: "plain.builtin-grammars",
	path: "/extension",
});
let registered = false;

/**
 * Publishes only the selected packages' language declarations, configuration
 * JSON and TextMate grammars. The ordinary extension service stays the inert
 * PlainNullExtensionService; no extension code, activation event or host is
 * introduced. Resources use the same read-only in-memory provider as the
 * built-in theme wrapper so WKWebView never has to Fetch a Tauri asset URL.
 */
export function registerPlainBuiltinGrammarResources(
	languageService: ILanguageService,
	languageConfigurationService: ILanguageConfigurationService,
): void {
	if (registered) {
		return;
	}

	for (const source of sources) {
		for (const [path, contents] of Object.entries(source.resources)) {
			const bytes = new TextEncoder().encode(contents);
			registerExtensionFile(
				new RegisteredReadOnlyFile(
					URI.joinPath(extensionLocation, source.key, path),
					async () => bytes,
					bytes.byteLength,
				),
			);
		}
	}

	const extension = getBuiltinExtensions().find(
		(candidate) => candidate.identifier.id === "plain.builtin-grammars",
	);
	if (extension === undefined) {
		throw new Error("Plain built-in grammar extension was not registered");
	}
	const description = toExtensionDescription(extension, false);
	const validationMessages: string[] = [];
	const collectorFor = (extensionPoint: string) =>
		new ExtensionMessageCollector(
			(message) => validationMessages.push(message.message),
			description,
			extensionPoint,
		);
	const contributions = manifest.contributes;
	if (
		!Array.isArray(contributions?.languages) ||
		!Array.isArray(contributions.grammars)
	) {
		throw new Error("Plain built-in grammar contributions are missing");
	}

	// Plain's inert extension service never dispatches language extension
	// points. Register the already-audited declarations directly so file
	// associations and configuration URIs exist before TextMate validates its
	// language and embedded-language references.
	for (const contribution of contributions.languages) {
		const language = contribution as unknown as ILanguageExtensionPoint & {
			readonly configuration?: string;
		};
		const configurationPath = language.configuration;
		languageService.registerLanguage({
			...language,
			configuration:
				typeof configurationPath === "string"
					? URI.joinPath(extensionLocation, configurationPath)
					: undefined,
		});
		if (typeof configurationPath === "string") {
			const [sourceKey, ...resourceSegments] = configurationPath
				.replace(/^\.\//u, "")
				.split("/");
			const configurationContents = sources.find(
				(source) => source.key === sourceKey,
			)?.resources[resourceSegments.join("/")];
			if (configurationContents === undefined) {
				throw new Error(
					`Plain built-in grammar ${language.id} configuration is missing`,
				);
			}
			languageConfigurationService.register(
				language.id,
				LanguageConfigurationFileHandler.extractValidConfig(
					language.id,
					JSON.parse(configurationContents) as ILanguageConfiguration,
				),
				50,
			);
		}
	}
	(
		grammarsExtPoint as typeof grammarsExtPoint & {
			acceptUsers(users: unknown[]): void;
		}
	).acceptUsers([
		{
			description,
			value: contributions.grammars,
			collector: collectorFor(grammarsExtPoint.name),
		},
	]);

	if (validationMessages.length > 0) {
		throw new Error(
			`Plain built-in grammar validation failed: ${validationMessages.join("; ")}`,
		);
	}
	registered = true;
}

export const PLAIN_BUILTIN_GRAMMAR_SOURCE_COUNT = sources.length;
export const PLAIN_BUILTIN_GRAMMAR_COUNT =
	manifest.contributes?.grammars?.length ?? 0;
