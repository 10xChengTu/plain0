import {
	registerExtension,
	type IExtensionManifest,
	type RegisterLocalExtensionResult,
} from "@codingame/monaco-vscode-api/extensions";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import {
	RegisteredReadOnlyFile,
	registerExtensionFile,
} from "@codingame/monaco-vscode-files-service-override";
import dark2026 from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/2026-dark.json?raw";
import light2026 from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/2026-light.json?raw";
import darkModern from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/dark_modern.json?raw";
import darkPlus from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/dark_plus.json?raw";
import darkVs from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/dark_vs.json?raw";
import documentDark from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/document-dark.svg?raw";
import documentLight from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/document-light.svg?raw";
import folderDark from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/folder-dark.svg?raw";
import folderLight from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/folder-light.svg?raw";
import folderOpenDark from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/folder-open-dark.svg?raw";
import folderOpenLight from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/folder-open-light.svg?raw";
import highContrastDark from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/hc_black.json?raw";
import highContrastLight from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/hc_light.json?raw";
import lightModern from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/light_modern.json?raw";
import lightPlus from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/light_plus.json?raw";
import lightVs from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/light_vs.json?raw";
import packageJson from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/package.json?raw";
import rootFolderDark from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/root-folder-dark.svg?raw";
import rootFolderLight from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/root-folder-light.svg?raw";
import rootFolderOpenDark from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/root-folder-open-dark.svg?raw";
import rootFolderOpenLight from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/root-folder-open-light.svg?raw";
import minimalFileIcons from "@codingame/monaco-vscode-theme-defaults-default-extension/resources/vs_minimal-icon-theme.json?raw";

// Keep the upstream keys/labels required by the locked manifest, but do not
// re-introduce the excluded product brand carried by its file-icon label.
const packageNls = JSON.stringify({
	displayName: "Default Themes",
	description: "Plain's built-in light and dark themes",
	light2026ThemeLabel: "Light 2026",
	dark2026ThemeLabel: "Dark 2026",
	darkPlusColorThemeLabel: "Dark+",
	darkModernThemeLabel: "Dark Modern",
	lightPlusColorThemeLabel: "Light+",
	lightModernThemeLabel: "Light Modern",
	darkColorThemeLabel: "Dark",
	lightColorThemeLabel: "Light",
	hcColorThemeLabel: "Dark High Contrast",
	lightHcColorThemeLabel: "Light High Contrast",
	minimalIconThemeLabel: "Minimal",
});

/**
 * The generated `theme-defaults` package normally registers emitted assets as
 * `tauri://localhost/assets/...` URLs. WKWebView can execute the application
 * from that custom protocol but its Fetch implementation cannot load those
 * URLs through VS Code's `IExtensionResourceLoaderService` (`Load failed`).
 *
 * Register the exact same locked, declarative package manifest before
 * Workbench initialization, then publish JSON/NLS resources as read-only
 * in-memory extension files immediately after `initialize()`, bypassing Fetch
 * entirely. SVGs additionally need browser URLs for file-icon CSS, so those
 * retain process-lifetime blobs. This remains a static theme contribution
 * only: no `main`, `browser`, activation event, or extension host is
 * introduced.
 */
const manifest = JSON.parse(packageJson) as IExtensionManifest;
const { registerFileUrl } = registerExtension(manifest, undefined, {
	system: true,
}) as RegisterLocalExtensionResult;
const extensionLocation = URI.from({
	scheme: "extension-file",
	authority: "vscode.theme-defaults",
	path: "/extension",
});

const blobUrls: string[] = [];
let resourcesRegistered = false;

function registerJsonResource(path: string, contents: string): void {
	const bytes = new TextEncoder().encode(contents);
	registerExtensionFile(
		new RegisteredReadOnlyFile(
			URI.joinPath(extensionLocation, path),
			async () => bytes,
			bytes.byteLength,
		),
	);
}

function registerSvgResource(path: string, contents: string): void {
	const url = URL.createObjectURL(
		new Blob([contents], { type: "image/svg+xml" }),
	);
	blobUrls.push(url);
	registerFileUrl(path, url, "image/svg+xml");
}

export function registerPlainBuiltinThemeResources(): void {
	if (resourcesRegistered) {
		return;
	}
	resourcesRegistered = true;
	for (const [path, contents] of [
		["package.json", packageJson],
		["package.nls.json", packageNls],
		["fileicons/vs_minimal-icon-theme.json", minimalFileIcons],
		["themes/2026-dark.json", dark2026],
		["themes/2026-light.json", light2026],
		["themes/dark_modern.json", darkModern],
		["themes/dark_plus.json", darkPlus],
		["themes/dark_vs.json", darkVs],
		["themes/hc_black.json", highContrastDark],
		["themes/hc_light.json", highContrastLight],
		["themes/light_modern.json", lightModern],
		["themes/light_plus.json", lightPlus],
		["themes/light_vs.json", lightVs],
	] as const) {
		registerJsonResource(path, contents);
	}

	for (const [path, contents] of [
		["fileicons/images/document-dark.svg", documentDark],
		["fileicons/images/document-light.svg", documentLight],
		["fileicons/images/folder-dark.svg", folderDark],
		["fileicons/images/folder-light.svg", folderLight],
		["fileicons/images/folder-open-dark.svg", folderOpenDark],
		["fileicons/images/folder-open-light.svg", folderOpenLight],
		["fileicons/images/root-folder-dark.svg", rootFolderDark],
		["fileicons/images/root-folder-light.svg", rootFolderLight],
		["fileicons/images/root-folder-open-dark.svg", rootFolderOpenDark],
		["fileicons/images/root-folder-open-light.svg", rootFolderOpenLight],
	] as const) {
		registerSvgResource(path, contents);
	}
}

// Deliberately retain process-lifetime ownership. Revoking a built-in asset
// while Workbench is alive would invalidate future theme reloads/previews.
void blobUrls;
