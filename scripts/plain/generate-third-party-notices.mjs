#!/usr/bin/env node
// Regenerates the top-level `ThirdPartyNotices.txt` from the *real, current*
// production dependency graph, instead of hand-maintaining a text file that
// can silently drift from what actually ships.
//
// F120 S2+S3+S4 (docs/research/2026-07-29-branding-packaging.md "结论 3",
// "5.2 声明文件重写"): the guiding rule is "is this still really
// distributed", not "does a file still exist for it". This script only
// covers the mechanical part of that rule (enumerating what `pnpm` and
// `cargo about` currently resolve); the hand-curated constants below
// (`CODINGAME_LICENSE_TEXT`, `GHOSTTY_VENDORED_C_SOURCE_NOTICE`, the
// jschardet author-credit prefix, and the dompurify/tauri-apps license
// branch choices) encode judgment calls made and recorded in
// `progress.md`'s F120 S2+S3+S4 entry — they are not re-derived from
// scratch on every run, because the underlying facts (e.g. which GitHub
// org a family of npm packages ships from) do not change between runs.
//
// Prerequisites to re-run this script:
//   - `pnpm install` has been run (so `pnpm licenses list` has real data).
//   - `cargo-about` 0.9.1 is installed: `cargo install cargo-about --version
//     0.9.1 --locked --features cli` (a one-time, machine-local dev tool —
//     it is not added as a project dependency and does not affect
//     `Cargo.lock`, `pnpm-lock.yaml`, or any pinned-dependency count).
//
// Usage:
//   node scripts/plain/generate-third-party-notices.mjs
//     (writes ThirdPartyNotices.txt at the repo root; review the diff
//     before committing, the same as any other generated file.)
//   node scripts/plain/generate-third-party-notices.mjs --check
//     (F120 S7, "需要新增的 AST 契约" item 4, "declaration freshness": does
//     NOT write anything -- regenerates the same content in memory from
//     the real, current dependency graph and diffs it against the
//     committed ThirdPartyNotices.txt, exiting non-zero if they differ.
//     This is the "does the notices file still match what actually ships"
//     drift detector the research document asked for, built by reusing
//     this already-real generator rather than duplicating its
//     `pnpm licenses list`/`cargo about` logic in a second module.
//     Deliberately NOT wired into the default `pnpm check` chain: unlike
//     every other `pnpm check` step, this one requires `cargo-about` to be
//     separately installed as a machine-local tool (see prerequisites
//     above) and re-resolves live dependency data on every run, rather
//     than being a fast, offline, pure static check -- see
//     `package.json`'s own `check:notices` script and this feature's
//     evidence for the real, live-executed before/after proof that this
//     mode actually detects drift.)

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUTPUT_FILE = join(REPO_ROOT, "ThirdPartyNotices.txt");
const CRLF = "\r\n";
const SEP = "---------------------------------------------------------";

function noProxyEnv() {
	const env = { ...process.env };
	for (const key of [
		"HTTP_PROXY",
		"HTTPS_PROXY",
		"http_proxy",
		"https_proxy",
	]) {
		delete env[key];
	}
	return env;
}

function readNodeModuleFile(relativePath) {
	return readFileSync(
		join(REPO_ROOT, "node_modules", relativePath),
		"utf8",
	).trimEnd();
}

// ---------------------------------------------------------------------------
// Part 1: JS/TS production dependencies, from `pnpm licenses list --prod`.
// ---------------------------------------------------------------------------

function getJsProdLicenses() {
	const raw = execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], {
		cwd: REPO_ROOT,
		encoding: "utf8",
		env: noProxyEnv(),
		maxBuffer: 64 * 1024 * 1024,
	});
	return JSON.parse(raw);
}

// `@codingame/monaco-vscode-*` (28 resolved packages, all published from the
// single `CodinGame/monaco-vscode-api` GitHub monorepo, none of them ship a
// physical LICENSE file in node_modules — verified during F120 S2). Baked in
// here rather than fetched live at generation time, matching how the rest of
// this file's static license bodies are stored (`gh api
// repos/CodinGame/monaco-vscode-api/license`, fetched 2026-07-29).
const CODINGAME_LICENSE_TEXT = `MIT License

Copyright (c) 2022 CodinGame

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

// Supplementary author credit for jschardet, ported from this repo's
// existing `cglicenses.json` (whose own header comment already explains why:
// "The license ... does not include a clear Copyright statement and does not
// credit authors."). jschardet is LGPL-2.1+ and, per the F120 research
// document's "结论 3.3", is a real, currently-shipped ~333 KB production
// bundle chunk that had *zero* attribution anywhere in the old
// ThirdPartyNotices.txt. This script fixes the "missing attribution" gap;
// it does not attempt to resolve whether the LGPL dynamic-linking exemption
// applies to a bundled WebView JS chunk — that is flagged as needing legal
// review in progress.md and is out of scope for a text-generation script.
const JSCHARDET_AUTHOR_CREDIT =
	"Chardet was originally ported from C++ by Mark Pilgrim. It is now maintained" +
	" by Dan Blanchard and Ian Cordasco, and was formerly maintained by Erik Rose." +
	" JSChardet was ported from python to JavaScript by António Afonso" +
	" (https://github.com/aadsm/jschardet) and transformed into an npm package by" +
	" Markus Ast (https://github.com/brainafk).";

function jsComponentBlock(header, url, licenseText) {
	return [SEP, "", header, url, "", licenseText].join(CRLF);
}

function buildJsSection(prodLicenses) {
	const blocks = [];

	// 28 @codingame/monaco-vscode-* packages, one shared attribution.
	const codingamePkgs = (prodLicenses.MIT ?? [])
		.filter((p) => p.name.startsWith("@codingame/"))
		.sort((a, b) => a.name.localeCompare(b.name));
	if (codingamePkgs.length === 0) {
		throw new Error(
			"expected @codingame/* packages under the MIT license bucket, found none",
		);
	}
	const codingameHeader =
		`@codingame/monaco-vscode-* (${codingamePkgs.length} packages, single upstream monorepo) - MIT` +
		CRLF +
		codingamePkgs.map((p) => `  ${p.name} ${p.versions[0]}`).join(CRLF);
	blocks.push(
		jsComponentBlock(
			codingameHeader,
			"https://github.com/CodinGame/monaco-vscode-api",
			CODINGAME_LICENSE_TEXT,
		),
	);

	// Other plain-MIT packages that ship their own LICENSE file verbatim.
	const otherMitFiles = {
		"@types/trusted-types": "@types/trusted-types/LICENSE",
		"@vscode/diff": "@vscode/diff/LICENSE",
		"@vscode/iconv-lite-umd": "@vscode/iconv-lite-umd/LICENSE",
	};
	const mitPkgs = (prodLicenses.MIT ?? []).filter(
		(p) => !p.name.startsWith("@codingame/"),
	);
	for (const pkg of mitPkgs.sort((a, b) => a.name.localeCompare(b.name))) {
		if (pkg.name === "marked") continue; // handled separately below (own multi-license file)
		const relPath = otherMitFiles[pkg.name];
		if (!relPath) {
			throw new Error(
				`unhandled MIT production package "${pkg.name}" - add it to otherMitFiles or the ` +
					"@codingame group in generate-third-party-notices.mjs",
			);
		}
		const licenseText = readNodeModuleFile(
			`.pnpm/${pkg.name.replace("/", "+")}@${pkg.versions[0]}/node_modules/${relPath}`,
		);
		blocks.push(
			jsComponentBlock(
				`${pkg.name} ${pkg.versions[0]} - MIT`,
				pkg.paths?.[0] ?? "",
				licenseText,
			),
		);
	}

	// marked: ships its own LICENSE.md documenting several bundled licenses
	// (Marked itself + Markdown.pl); reproduced verbatim rather than
	// cherry-picked, since Plain redistributes the package as-is.
	const markedPkg = (prodLicenses.MIT ?? []).find((p) => p.name === "marked");
	if (!markedPkg)
		throw new Error("expected marked under the MIT license bucket");
	const markedLicense = readNodeModuleFile(
		`.pnpm/marked@${markedPkg.versions[0]}/node_modules/marked/LICENSE.md`,
	);
	blocks.push(
		jsComponentBlock(
			`marked ${markedPkg.versions[0]} - MIT`,
			"https://github.com/markedjs/marked",
			markedLicense,
		),
	);

	// @tauri-apps/api: dual Apache-2.0 OR MIT; MIT branch chosen (matches
	// this repo's other MIT-first choices; no functional difference for a
	// permissive dual license).
	const tauriApiKey = Object.keys(prodLicenses).find(
		(k) => k.includes("Apache-2.0") && k.includes("MIT") && !k.includes("MPL"),
	);
	const tauriApiPkg = (prodLicenses[tauriApiKey] ?? []).find(
		(p) => p.name === "@tauri-apps/api",
	);
	if (!tauriApiPkg)
		throw new Error(
			"expected @tauri-apps/api under an Apache-2.0/MIT dual license bucket",
		);
	const tauriApiLicense = readNodeModuleFile(
		`.pnpm/@tauri-apps+api@${tauriApiPkg.versions[0]}/node_modules/@tauri-apps/api/LICENSE_MIT`,
	);
	blocks.push(
		jsComponentBlock(
			`@tauri-apps/api ${tauriApiPkg.versions[0]} - MIT (dual-licensed Apache-2.0 OR MIT; MIT text reproduced here)`,
			"https://github.com/tauri-apps/tauri",
			tauriApiLicense,
		),
	);

	// dompurify: dual MPL-2.0 OR Apache-2.0; Apache-2.0 branch chosen per
	// F120 research "结论 3.3" (simplest compliant choice).
	const dompurifyKey = Object.keys(prodLicenses).find(
		(k) => k.includes("MPL-2.0") && k.includes("Apache-2.0"),
	);
	const dompurifyPkg = (prodLicenses[dompurifyKey] ?? []).find(
		(p) => p.name === "dompurify",
	);
	if (!dompurifyPkg)
		throw new Error(
			"expected dompurify under an MPL-2.0/Apache-2.0 dual license bucket",
		);
	const dompurifyLicense = readNodeModuleFile(
		`.pnpm/dompurify@${dompurifyPkg.versions[0]}/node_modules/dompurify/LICENSE`,
	);
	blocks.push(
		jsComponentBlock(
			`dompurify ${dompurifyPkg.versions[0]} - Apache-2.0 (dual-licensed MPL-2.0 OR Apache-2.0; ` +
				"Apache-2.0 branch chosen)" +
				CRLF +
				"Author: Dr.-Ing. Mario Heiderich, Cure53 <mario@cure53.de>",
			"https://github.com/cure53/DOMPurify",
			dompurifyLicense,
		),
	);

	// jschardet: LGPL-2.1+, the confirmed-missing attribution this rewrite
	// exists to fix. Full license text + supplementary author credit.
	const jschardetKey = Object.keys(prodLicenses).find((k) =>
		k.includes("LGPL"),
	);
	const jschardetPkg = (prodLicenses[jschardetKey] ?? []).find(
		(p) => p.name === "jschardet",
	);
	if (!jschardetPkg)
		throw new Error("expected jschardet under an LGPL license bucket");
	const jschardetLicense = readNodeModuleFile(
		`.pnpm/jschardet@${jschardetPkg.versions[0]}/node_modules/jschardet/LICENSE`,
	);
	blocks.push(
		jsComponentBlock(
			`jschardet ${jschardetPkg.versions[0]} - LGPL-2.1+` +
				CRLF +
				JSCHARDET_AUTHOR_CREDIT,
			"https://github.com/aadsm/jschardet",
			jschardetLicense,
		),
	);

	return blocks;
}

// ---------------------------------------------------------------------------
// Part 2: Rust dependencies (src-tauri), from `cargo about generate`.
// ---------------------------------------------------------------------------

function getRustLicenseGroups() {
	const raw = execFileSync(
		"cargo",
		[
			"about",
			"generate",
			"--format",
			"json",
			"--manifest-path",
			"src-tauri/Cargo.toml",
			"-c",
			"src-tauri/about.toml",
		],
		{
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: noProxyEnv(),
			maxBuffer: 64 * 1024 * 1024,
		},
	);
	return JSON.parse(raw);
}

// The Ghostty C/Zig terminal-emulation source that `libghostty-vt-sys`'s
// build.rs fetches (via `.ghostty-vendor/ghostty`, pinned commit
// a887df42c56f6de86c0fe6da9c4eeca37931e083 — see
// `scripts/plain/ghostty-vendor-setup.mjs`) and compiles at build time. This
// is a *second*, separate license obligation from the `libghostty-vt`/
// `libghostty-vt-sys` Rust crates themselves (which are their own,
// independently MIT/Apache-2.0-dual-licensed wrapper published from
// github.com/uzaaft/libghostty-rs and are already covered by the `cargo
// about` output below) - see F120 research "结论 3.4". Baked in as a static
// constant, matching this file's existing convention for vendored non-Cargo
// sources, and because `.ghostty-vendor/` is gitignored and may not be
// present on a machine that hasn't run `pnpm ghostty:vendor:setup` yet.
const GHOSTTY_VENDORED_C_SOURCE_NOTICE = `${SEP}${CRLF}${CRLF}Ghostty (vendored terminal emulation source, pinned commit a887df42c56f6de86c0fe6da9c4eeca37931e083, fetched at build time by libghostty-vt-sys's build.rs into .ghostty-vendor/ghostty - see scripts/plain/ghostty-vendor-setup.mjs) - MIT${CRLF}This is a second, separate attribution from the libghostty-vt / libghostty-vt-sys Rust crates below: the crates are an independently MIT OR Apache-2.0 dual-licensed wrapper (github.com/uzaaft/libghostty-rs), while this entry covers the upstream Ghostty C/Zig source (github.com/ghostty-org/ghostty) that their build.rs compiles against.${CRLF}https://github.com/ghostty-org/ghostty${CRLF}${CRLF}MIT License${CRLF}${CRLF}Copyright (c) 2024 Mitchell Hashimoto, Ghostty contributors${CRLF}${CRLF}Permission is hereby granted, free of charge, to any person obtaining a copy${CRLF}of this software and associated documentation files (the "Software"), to deal${CRLF}in the Software without restriction, including without limitation the rights${CRLF}to use, copy, modify, merge, publish, distribute, sublicense, and/or sell${CRLF}copies of the Software, and to permit persons to whom the Software is${CRLF}furnished to do so, subject to the following conditions:${CRLF}${CRLF}The above copyright notice and this permission notice shall be included in all${CRLF}copies or substantial portions of the Software.${CRLF}${CRLF}THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR${CRLF}IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,${CRLF}FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE${CRLF}AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER${CRLF}LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,${CRLF}OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE${CRLF}SOFTWARE.${CRLF}${CRLF}Whether Ghostty's vendored Nerd Fonts data (.ghostty-vendor/ghostty/vendor/nerd-fonts) is linked into the libghostty-vt artifact Plain actually depends on is addressed separately: a source-level Zig module-graph trace (src/lib_vt.zig, the root module for the "-Demit-lib-vt" build target, only imports terminal/, input/ and unicode/ - never src/font/, which is where the Nerd Fonts codegen is consumed) found no import path from the VT library to the font subsystem, so this notice does not include a separate Nerd Fonts attribution. This is a source-level, not a binary-level (nm/otool), confirmation - see progress.md for the full caveat.`;

function rustComponentBlock(licenseGroup) {
	const crateLines = licenseGroup.used_by
		.map((u) => u.crate)
		.sort((a, b) =>
			a.name === b.name
				? a.version.localeCompare(b.version)
				: a.name.localeCompare(b.name),
		)
		.map(
			(c) =>
				`  ${c.name} ${c.version}${c.repository ? ` - ${c.repository}` : ""}`,
		)
		.join(CRLF);
	const header = `${licenseGroup.name} (SPDX: ${licenseGroup.id}) - used by ${licenseGroup.used_by.length} crate(s):${CRLF}${crateLines}`;
	return [SEP, "", header, "", licenseGroup.text.trimEnd()].join(CRLF);
}

function buildRustSection(rustData) {
	const groups = [...rustData.licenses].sort((a, b) => {
		if (a.id !== b.id) return a.id.localeCompare(b.id);
		return a.text.localeCompare(b.text);
	});
	const blocks = groups.map(rustComponentBlock);
	blocks.push(GHOSTTY_VENDORED_C_SOURCE_NOTICE);
	return blocks;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function generateNoticesContent() {
	const prodLicenses = getJsProdLicenses();
	const jsBlocks = buildJsSection(prodLicenses);

	const rustData = getRustLicenseGroups();
	const rustBlocks = buildRustSection(rustData);

	const jsPackageCount = Object.values(prodLicenses).reduce(
		(sum, arr) => sum + arr.length,
		0,
	);
	const rustCrateCount = new Set(
		rustData.licenses.flatMap((l) =>
			l.used_by.map((u) => `${u.crate.name}@${u.crate.version}`),
		),
	).size;

	const header = [
		"NOTICES",
		"",
		"This repository incorporates material as listed below or described in the code.",
		"",
		`Generated by scripts/plain/generate-third-party-notices.mjs from the real, current`,
		`dependency graph (${jsPackageCount} production JS/TS packages via` +
			` \`pnpm licenses list --prod\`, ${rustCrateCount} Rust crates via \`cargo about\`).`,
		"Do not hand-edit; re-run the generator and review the diff instead.",
		"",
	].join(CRLF);

	const content =
		header +
		CRLF +
		"PART 1: JavaScript/TypeScript production dependencies" +
		CRLF +
		CRLF +
		jsBlocks.join(CRLF + CRLF) +
		CRLF +
		CRLF +
		SEP +
		CRLF +
		CRLF +
		"PART 2: Rust dependencies (src-tauri)" +
		CRLF +
		CRLF +
		rustBlocks.join(CRLF + CRLF) +
		CRLF;

	// Some embedded license bodies come from files/JSON that use bare LF
	// (jschardet's LICENSE, marked's LICENSE.md, cargo-about's JSON `text`
	// fields, ...). Normalize everything to CRLF at the very end so the
	// output is uniform, matching this file's `.gitattributes eol=crlf`.
	const normalized = content.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");

	return {
		normalized,
		jsPackageCount,
		rustCrateCount,
		blockCount: jsBlocks.length + rustBlocks.length,
	};
}

function main() {
	const checkOnly = process.argv.includes("--check");
	const { normalized, jsPackageCount, rustCrateCount, blockCount } =
		generateNoticesContent();

	if (!checkOnly) {
		writeFileSync(OUTPUT_FILE, normalized, "utf8");
		console.log(
			`Wrote ${OUTPUT_FILE} (${jsPackageCount} JS packages, ${rustCrateCount} Rust crates, ${blockCount} notice blocks).`,
		);
		return;
	}

	let committed;
	try {
		committed = readFileSync(OUTPUT_FILE, "utf8");
	} catch {
		console.error(
			`ThirdPartyNotices.txt is missing at ${OUTPUT_FILE} -- run without --check to generate it.`,
		);
		process.exitCode = 1;
		return;
	}
	if (committed === normalized) {
		console.log(
			`ThirdPartyNotices.txt is fresh: matches the real, current dependency graph (${jsPackageCount} JS packages, ${rustCrateCount} Rust crates, ${blockCount} notice blocks).`,
		);
		return;
	}
	console.error(
		"ThirdPartyNotices.txt is stale: it no longer matches the real, current dependency graph " +
			`(regenerating now would produce ${jsPackageCount} JS packages, ${rustCrateCount} Rust crates, ${blockCount} notice blocks). ` +
			"Re-run `node scripts/plain/generate-third-party-notices.mjs` (without --check) and review/commit the diff.",
	);
	process.exitCode = 1;
}

main();
