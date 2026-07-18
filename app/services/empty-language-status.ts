import { Event } from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";
import {
	Disposable,
	type IDisposable,
} from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";

/**
 * Explicitly empty replacement for the unsupported compatibility stub.
 *
 * Plain has no language providers or Extension Host. Workbench still renders a
 * generic language-status contribution when a text editor opens, so its read
 * path must return a stable empty set without enabling a language service.
 */
export class EmptyLanguageStatusService {
	readonly _serviceBrand = undefined;
	readonly onDidChange: Event<void> = Event.None;

	addStatus(): IDisposable {
		return Disposable.None;
	}

	getLanguageStatus(): [] {
		return [];
	}
}
