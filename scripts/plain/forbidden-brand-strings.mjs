// `F120` S7 (`docs/research/2026-07-29-branding-packaging.md` "需要新增的
// AST 契约" item 1): the plan's original wording was "assert none of these
// nine VS Code/Code OSS brand strings appear anywhere in the built
// `dist/**/*.js`". This slice tried to implement that literally, ran a real
// `pnpm build:frontend`, and measured real occurrence counts before writing
// a single check -- and found every one of the nine already present, for
// three distinct, already-diagnosed, already-accepted reasons that a
// zero-tolerance check cannot fix without forking a vendor package:
//
// 1. `@codingame/monaco-vscode-api`'s `vscode/product.json.js` is a single,
//    unconditionally-imported data blob (`var productJson = {nameShort:
//    "Code - OSS", applicationName: "code-oss", dataFolderName:
//    ".vscode-oss", ..., darwinBundleIdentifier:
//    "com.visualstudio.code.oss", win32AppUserModelId:
//    "Microsoft.CodeOSS", win32DirName: "Microsoft Code OSS", ...}`,
//    confirmed by reading the real installed file). `app/main.ts`'s
//    `productConfiguration` override (`validateProductConfigurationBoundary`
//    above) only overlays nine specific fields on the *live runtime
//    object* via a shallow `mixin()` -- it does not, and structurally
//    cannot, remove the original string literals from this file's own
//    source text, because that text is what the JS engine evaluates to
//    produce the object those nine fields get overlaid onto. Every other
//    field (`win32*`, `darwinBundleIdentifier`, `onboardingThemes`,
//    `defaultChatAgent`, ...) keeps its original Code OSS value in both the
//    live object *and* the bundle text verbatim -- already confirmed dead
//    (zero real consumers in the installed `vs/` tree) by the research
//    document's own "结论 2.1", not a new finding, just a new place the
//    same old finding surfaces.
// 2. `missing-services.js`'s dead second `class ProductService` (hardcoded
//    `nameShort = nameLong = "Code - OSS Dev"`, `applicationName =
//    "code-oss"`, `dataFolderName = ".vscode-oss"`, `urlProtocol =
//    "code-oss"`) is real, currently-shipping code, not a leftover comment.
//    `F120` S0 tried to delete it, the delete was correctly typed, passed
//    `pnpm check` in full, and then broke 97 of 98 real Browser E2E
//    scenarios with `contextService depends on productService which is NOT
//    registered` (this project's fifth documented "green gate, broken
//    feature" incident -- see `progress.md`'s S0 entry and
//    `scripts/plain/missing-services-patch-contract.mjs`'s own
//    `KEPT_TOKEN_REGISTRATIONS` entry for `IProductService`). The delete
//    was reverted. `progress.md`'s own "已知风险" section explicitly warned
//    that this exact check would need a `KNOWN_INERT`-style exemption for
//    this reason before it could ever be written -- this module is that
//    exemption, built to that same warning.
// 3. A third source this slice found by actually reading the real built
//    output rather than assuming only the two known sources applied: the
//    bundled `vscode-codicons` icon-name registry (kept per
//    `cgmanifest.json`'s retained entry, a real, currently-distributed
//    asset per the research document's own "结论 3.2") registers an icon
//    literally named `code-oss` (`j(\`code-oss\`,60459)` in the real
//    minified output) -- an inert lookup-table entry among many Codicon
//    names, not anything Plain's own code ever requests by that name.
//
// None of this is user-visible: `document.title === "Plain"` is real,
// measured evidence (F120 S0/the research document's own "结论 2.1"), and
// the fields carrying these leftover strings have separately-confirmed zero
// real consumers in the installed source tree. But a check that fails on
// day one against the correct, already-accepted state of the bundle is a
// broken check, not a stricter one -- this project already treated exactly
// that situation as a bug to fix once before (see `check-bundle.mjs`'s own
// removed `missing-services.js`-file-must-not-exist check, deleted in
// F110 S7 for the identical reason). `KNOWN_INERT_BRAND_STRINGS` below
// follows that same precedent: it documents, rather than hides, every
// string this check does not gate and exactly why, so a future reader does
// not have to rediscover any of this from scratch or wrongly assume the
// omission was an oversight.
//
// `FORBIDDEN_BRAND_STRINGS` is therefore scoped to what this slice actually
// verified is genuinely absent from the real, current build (measured via
// the same real `pnpm build:frontend` + full-text search this whole module
// documents) -- so this check has real, currently-passing zero-tolerance
// power today, and grows if a future slice finds more genuinely-fixable
// strings, rather than starting broken and requiring an exemption for
// nearly everything on day one.
export const FORBIDDEN_BRAND_STRINGS = Object.freeze([
	// The unabbreviated product name never appears anywhere in the real,
	// current bundle (0 occurrences, verified) -- unlike "Code - OSS" (the
	// abbreviated internal name baked into product.json.js), there is no
	// known vendor source for this string, so any future appearance is a
	// real, actionable regression signal.
	"Visual Studio Code",
]);

// Evidence for each entry: real occurrence count in a real `pnpm
// build:frontend` output at the time this module was written, and which of
// the three sources above it comes from (a string can come from more than
// one).
export const KNOWN_INERT_BRAND_STRINGS = Object.freeze({
	"Code - OSS":
		'product.json.js nameShort/nameLong, plus as a substring of the dead ProductService class\'s "Code - OSS Dev" (4 real occurrences measured)',
	"code-oss":
		"product.json.js applicationName/linuxIconName/urlProtocol, the dead ProductService class's applicationName/urlProtocol, plus a substring of .vscode-oss/.vscode-oss-shared, plus the vscode-codicons icon-name registry's own \"code-oss\" icon id (10 real occurrences measured)",
	vscodeoss:
		"product.json.js win32MutexName and win32TunnelServiceMutex/win32TunnelMutex (3 real occurrences measured)",
	"com.visualstudio.code.oss":
		'product.json.js darwinBundleIdentifier, a dead Electron-only field with zero real consumers in the installed vs/ tree per the research document\'s own "结论 2.1" (1 real occurrence measured)',
	".vscode-oss":
		"product.json.js dataFolderName and a substring of sharedDataFolderName, plus the dead ProductService class's dataFolderName (4 real occurrences measured)",
	"vscode-oss-shared":
		'a substring of product.json.js\'s sharedDataFolderName ".vscode-oss-shared" (2 real occurrences measured)',
	"Code - OSS Dev":
		"the dead ProductService class's nameShort/nameLong -- see this module's own top comment for why this class cannot currently be safely deleted (2 real occurrences measured)",
	win32AppUserModelId:
		"a product.json.js object-literal key name, a dead Electron-only field (1 real occurrence measured)",
	"Microsoft Code OSS":
		"product.json.js win32DirName/win32NameVersion, dead Electron-only fields (2 real occurrences measured)",
});

export function findForbiddenBrandStrings(javascriptText) {
	return FORBIDDEN_BRAND_STRINGS.filter((term) =>
		javascriptText.includes(term),
	);
}
