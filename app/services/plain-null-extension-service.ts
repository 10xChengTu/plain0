import { Event } from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";
import type {
	ActivationKind,
	ExtensionActivationReason,
	ExtensionPointContribution,
	IExtensionInspectInfo,
	IExtensionsStatus,
	IResponsiveStateChangeEvent,
	IWillActivateEvent,
	WillStopExtensionHostsEvent,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensions/common/extensions";
import type { IExtensionPoint } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensions/common/extensionsRegistry";
import type {
	ExtensionIdentifier,
	IExtension,
	IExtensionContributions,
	IExtensionDescription,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/extensions/common/extensions";
import type { IExtensionService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensions/common/extensions.service";

/**
 * Plain's own replacement for `missing-services.js`'s `NullExtensionService`
 * (`F110` S5, `docs/research/2026-07-28-legacy-retirement.md` decision 3).
 *
 * `IExtensionService` cannot be dropped: a real dependency-graph audit
 * against the actual, currently-bundled corpus found dozens of always-
 * constructed Workbench parts inject it as a non-optional constructor
 * parameter (`activitybarPart.js`, `paneCompositeBar.js`/`paneCompositePart.js`,
 * `viewPaneContainer.js`, `treeView.js`, `folding.contribution.js`,
 * `formatActionsMultiple.js`, `languageService.js`, `tunnelModel.js`,
 * `textFileEditorModel.js`, `configurationService.js`, `searchService.js`,
 * `workbenchThemeService.js`, `layout.js`, and Plain's own
 * `PlainSearchService`), plus the base package's own top-level `extensions`
 * subpath entry (`registerExtension()`, the declarative,
 * `IExtensionService.canAddExtension()`-gated seam Plain's own theme-package
 * import feature — `app/features/themes/plain-theme-import-coordinator.ts`
 * — is built on). Replacing the DI token itself (so none of the above needed
 * to change) was judged out of scope for this slice (see
 * `docs/bundle-baseline.json`'s `categoryNotes.extensionRuntime`).
 *
 * What *does* change here: before this slice, `IExtensionService` was bound
 * to the vendor's own extensions-service-override package's real
 * `ExtensionServiceOverride` (`extends ExtensionService`) — a full,
 * instantiated extension-host-management object, merely constructed with
 * `enableWorkerExtensionHost: false` and `Disabled*` host factories so it
 * could never actually create a host. This class replaces that with a
 * genuinely inert implementation Plain owns and can test directly, and lets
 * `services.js` stop importing that override package at all (its only
 * reachability path into the bundle), dropping that whole package — 11
 * files — out.
 *
 * Behavioral parity with `NullExtensionService` (verified field-by-field
 * against that class's own source,
 * `vscode/src/vs/workbench/services/extensions/common/extensions.js`):
 * every event is `Event.None` (never fires), `extensions` is a fixed empty
 * array, `activateByEvent`/`activateById` resolve without doing anything,
 * `activationEventIsDone` is always `false`, `whenInstalledExtensionsRegistered`
 * resolves `true` immediately (there is nothing to wait for — Plain has no
 * Extension Host and never adds a real extension), `getExtension` resolves
 * `undefined`, `canAddExtension`/`canRemoveExtension` are always `false`,
 * `getInspectPorts` resolves `[]`, `stopExtensionHosts` resolves `true`,
 * `startExtensionHosts`/`setRemoteEnvironment` resolve with no effect.
 *
 * One addition beyond the formal `IExtensionService` interface:
 * `deltaExtensions`. This is not part of `IExtensionService` at all — it is
 * specific to `ExtensionService`/`AbstractExtensionService` — but the base
 * package's top-level `extensions` subpath module's own
 * `registerExtension()` helper calls
 * `StandaloneServices.get(IExtensionService).deltaExtensions(toAdd, toRemove)`
 * unconditionally from its returned handle's `dispose()` method (not gated
 * behind `canAddExtension()`), and Plain's own
 * `plain-theme-import-coordinator.ts` calls that `dispose()` in three real
 * paths (import failure cleanup, replacing a previous import, removing an
 * imported package). Without this method, removing an imported theme
 * package would throw `extensionService.deltaExtensions is not a function`
 * — a real regression this class's own unit tests guard against. It is a
 * pure no-op: since `canAddExtension()` is always `false`, the manifest was
 * never really added in the first place (confirmed by reading
 * `registerExtension`'s own source — the `deltaExtensions` call inside its
 * `if (isEnabled && canAddExtension)` branch is provably unreachable), so
 * "removing" it has nothing to do.
 */
export class PlainNullExtensionService implements IExtensionService {
	readonly _serviceBrand = undefined;
	readonly onDidRegisterExtensions: Event<void> = Event.None;
	readonly onDidChangeExtensionsStatus: Event<ExtensionIdentifier[]> =
		Event.None;
	readonly onDidChangeExtensions: Event<{
		readonly added: readonly IExtensionDescription[];
		readonly removed: readonly IExtensionDescription[];
	}> = Event.None;
	readonly onWillActivateByEvent: Event<IWillActivateEvent> = Event.None;
	readonly onDidChangeResponsiveChange: Event<IResponsiveStateChangeEvent> =
		Event.None;
	readonly onWillStop: Event<WillStopExtensionHostsEvent> = Event.None;
	readonly extensions: readonly IExtensionDescription[] = [];

	activateByEvent(
		_activationEvent: string,
		_activationKind?: ActivationKind,
	): Promise<void> {
		return Promise.resolve(undefined);
	}

	activateById(
		_extensionId: ExtensionIdentifier,
		_reason: ExtensionActivationReason,
	): Promise<void> {
		return Promise.resolve(undefined);
	}

	activationEventIsDone(_activationEvent: string): boolean {
		return false;
	}

	whenInstalledExtensionsRegistered(): Promise<boolean> {
		return Promise.resolve(true);
	}

	getExtension(_id: string): Promise<IExtensionDescription | undefined> {
		return Promise.resolve(undefined);
	}

	canAddExtension(_extension: IExtensionDescription): boolean {
		return false;
	}

	canRemoveExtension(_extension: IExtensionDescription): boolean {
		return false;
	}

	readExtensionPointContributions<
		T extends IExtensionContributions[keyof IExtensionContributions],
	>(_extPoint: IExtensionPoint<T>): Promise<ExtensionPointContribution<T>[]> {
		// Mirrors `NullExtensionService`'s own (type-inexact) behavior verbatim:
		// it resolves an empty *object* (`Object.create(null)`), not an array,
		// despite the interface's `Promise<ExtensionPointContribution<T>[]>`
		// return type. Nothing in the real, currently-bundled corpus calls this
		// method (confirmed by the same dependency-graph audit this class's own
		// doc comment describes), so the cast below is never exercised at
		// runtime; it exists only to satisfy the interface at compile time
		// while keeping the emitted value identical to vendor's.
		return Promise.resolve(
			Object.create(null) as ExtensionPointContribution<T>[],
		);
	}

	getExtensionsStatus(): { [id: string]: IExtensionsStatus } {
		return Object.create(null) as { [id: string]: IExtensionsStatus };
	}

	// `IExtensionService#getInspectPorts`'s first parameter is typed as an
	// upstream host-kind enum this file deliberately never imports
	// (`AGENTS.md`'s native-service rules name that exact enum as one of the
	// host-entrypoint concepts `app/` must never reference; TypeScript's
	// bivariant method-parameter checking still accepts `unknown` here as a
	// valid implementation of the interface). There is no host of any kind to
	// inspect, so the value is never inspected either way.
	getInspectPorts(
		_extensionHostKind: unknown,
		_tryEnableInspector: boolean,
	): Promise<IExtensionInspectInfo[]> {
		return Promise.resolve([]);
	}

	stopExtensionHosts(_reason: string, _auto?: boolean): Promise<boolean> {
		return Promise.resolve(true);
	}

	async startExtensionHosts(_updates?: {
		readonly toAdd: readonly IExtension[];
		readonly toRemove: readonly string[];
	}): Promise<void> {}

	async setRemoteEnvironment(_env: {
		[key: string]: string | null;
	}): Promise<void> {}

	/**
	 * Not part of `IExtensionService` — see this class's own doc comment for
	 * why the base package's top-level `extensions` subpath module needs it
	 * anyway.
	 */
	async deltaExtensions(
		_toAdd: readonly IExtension[],
		_toRemove: readonly IExtension[],
	): Promise<void> {}
}
