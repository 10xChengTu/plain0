import { IObservable } from "../../../../base/common/observable.js";
import { IDisposable } from "../../../../base/common/lifecycle.js";
import { Event } from "../../../../base/common/event.js";
import { ThemeIcon } from "../../../../base/common/themables.js";
import { URI } from "../../../../base/common/uri.js";
import { AICustomizationSource, IStorageSourceFilter } from "./aiCustomizationWorkspaceService.js";
import { PromptsType } from "./promptSyntax/promptTypes.js";
import { IChatPromptSlashCommand, ICustomAgent, IResolvedChatPromptSlashCommand } from "./promptSyntax/service/promptsService.js";
import { IPromptsService } from "./promptSyntax/service/promptsService.service.js";
import { CancellationToken } from "../../../../base/common/cancellation.js";
import { ICustomizationHarnessService } from "./customizationHarnessService.service.js";
/**
 * Override for a management section's create-button behavior.
 */
export interface ISectionOverride {
    /**
     * Label for the primary button. Required when `commandId` or `rootFile`
     * is set. Ignored otherwise (the widget uses its default label).
     */
    readonly label?: string;
    /** When set, the primary button invokes this command (e.g. hooks quick pick). */
    readonly commandId?: string;
    /** When set, the primary button creates this file at the workspace root. */
    readonly rootFile?: string;
    /**
     * Custom type label for the dropdown workspace/user create actions
     * (e.g. "Rule" instead of "Instruction"). When undefined, the
     * section's default type label is used.
     */
    readonly typeLabel?: string;
    /**
     * Root-level file shortcuts added to the dropdown (e.g. `['AGENTS.md']`).
     * Each entry creates a "New {filename}" action that creates the file at
     * the workspace root. Harnesses that don't support a file simply omit it.
     */
    readonly rootFileShortcuts?: readonly string[];
    /**
     * File extension override for new files created under this section.
     * When set, files are created with this extension (e.g. `.md` for
     * Claude rules) instead of the default for the prompt type
     * (e.g. `.instructions.md`).
     */
    readonly fileExtension?: string;
}
export interface ICustomizationItemAction {
    readonly id: string;
    readonly label: string;
    readonly tooltip?: string;
    readonly icon?: ThemeIcon;
    readonly enabled?: boolean;
    run(): void | Promise<void>;
}
/**
 * Describes a single harness option for the UI toggle.
 */
export interface IHarnessDescriptor {
    /**
     * The harness/session-type identifier.
     */
    readonly id: string;
    readonly label: string;
    readonly icon: ThemeIcon;
    /**
     * Management sections that should be hidden when this harness is active.
     * For example, Claude does not support prompt files so the Prompts
     * section is hidden.
     */
    readonly hiddenSections?: readonly string[];
    /**
     * When `true`, the "Generate with AI" sparkle button is hidden and replaced
     * with a plain "New X" manual-creation button (like sessions).
     */
    readonly hideGenerateButton?: boolean;
    /**
     * Per-section overrides for the create button behavior.
     *
     * A `commandId` entry replaces the button entirely with a command
     * invocation (e.g. Claude hooks → `copilot.claude.hooks`).
     *
     * A `rootFile` entry makes the primary button create a specific file
     * at the workspace root (e.g. Claude instructions → `CLAUDE.md`).
     * When combined with `typeLabel`, the dropdown create actions use
     * that label instead of the section's default (e.g. "Rule" instead
     * of "Instruction").
     */
    readonly sectionOverrides?: ReadonlyMap<string, ISectionOverride>;
    /**
     * The chat agent ID that must be registered for this harness to appear.
     * When `undefined`, the harness is always available (e.g. Local).
     */
    readonly requiredAgentId?: string;
    /**
     * Returns the storage source filter that should be applied to customization
     * items of the given type when this harness is active.
     */
    getStorageSourceFilter(type: PromptsType): IStorageSourceFilter;
    /**
     * When set, this harness is backed by an extension-contributed provider
     * that can supply customization items directly (bypassing promptsService
     * discovery and filtering).
     */
    readonly itemProvider?: ICustomizationItemProvider;
    /**
     * When `true`, the "Troubleshoot" action is available in item context
     * menus. This opens chat with the `/troubleshoot` command pre-filled
     * for the selected customization.
     */
    readonly supportsTroubleshoot?: boolean;
    /**
     * When set, this harness uses an opt-out sync model where all eligible
     * local customizations are synced by default. The UI shows disable
     * affordances when this harness is active.
     */
    readonly syncProvider?: ICustomizationSyncProvider;
    /**
     * Optional plugin-management actions shown in the Plugins section add menu.
     * Harnesses can use these to add environment-specific commands alongside
     * the default install-from-source action (for example, configuring plugins on
     * a remote agent host). The create action remains a separate toolbar button.
     */
    readonly pluginActions?: readonly ICustomizationItemAction[];
}
/**
 * Represents a customization item provided by any source.
 */
export interface ICustomizationItem {
    /** Optional stable identity used by list widgets when URI alone is not unique. */
    readonly itemKey?: string;
    readonly uri: URI;
    readonly type: string;
    readonly name: string;
    readonly description?: string;
    /** Customization source (local, user, extension, plugin, builtin). Set by providers that know the source. */
    readonly source: AICustomizationSource;
    /** The extension identifier that contributed this customization, if any. */
    readonly extensionId: string | undefined;
    /** The URI of the plugin that contributed this customization, if any. */
    readonly pluginUri: URI | undefined;
    /** Human-readable name of the plugin that contributed this customization, if any. */
    readonly pluginLabel?: string;
    /** Server-reported loading status for this customization. */
    readonly status?: "loading" | "loaded" | "degraded" | "error";
    /** Human-readable status detail (e.g. error message or warning). */
    readonly statusMessage?: string;
    /** Whether this customization is currently enabled. */
    readonly enabled?: boolean;
    /** When set, items with the same groupKey are displayed under a shared collapsible header. */
    readonly groupKey?: string;
    /** When set, shows a small inline badge next to the item name (e.g. an applyTo glob pattern). */
    readonly badge?: string;
    /** Tooltip shown when hovering the badge. */
    readonly badgeTooltip?: string;
    /**
     * Whether this customization item can be invoked by the user.
     * Relevant for prompt / skill and custom agents
     */
    readonly userInvocable?: boolean;
    /** Optional inline/context-menu actions specific to this item. */
    readonly actions?: readonly ICustomizationItemAction[];
}
export interface ICustomizationAgentRef {
    readonly id: string;
    readonly uri: URI;
    /** Agent name (from frontmatter `name`, or file-derived) */
    readonly name: string;
    /** Optional short description for UI preview (from frontmatter `description`) */
    readonly description?: string;
}
export declare function isPluginCustomizationItem(item: {
    readonly type: string;
}): boolean;
/**
 * Provider interface for extension-contributed harnesses that supply
 * customization items directly from their SDK.
 */
export interface ICustomizationItemProvider {
    /**
     * Event that fires when the provider's customizations change.
     */
    readonly onDidChange: Event<void>;
    /**
     * Provide the customization items this harness supports.
     *
     * @param sessionResource URI of the chat session whose
     *   customizations should be included. Providers that surface
     *   session-scoped state (e.g. an agent host) should read from
     *   this session.
     */
    provideChatSessionCustomizations(sessionResource: URI, token: CancellationToken): Promise<ICustomizationItem[] | undefined>;
    /**
     * Provide the custom agents this harness supports.
     *
     * @param sessionResource URI of the chat session whose
     *   customizations should be included. Providers that surface
     *   session-scoped state (e.g. an agent host) should read from
     *   this session.
     */
    provideCustomAgents?(sessionResource: URI, token: CancellationToken): Promise<readonly ICustomAgent[]>;
    /**
     * Provide the directories where new customization files of the given
     * type can be created for this session. The result includes both
     * workspace-scoped and user-scoped folders; the caller is responsible
     * for partitioning them by storage target.
     *
     * @param sessionResource URI of the chat session whose
     *   creation locations should be returned.
     */
    provideSourceFolders?(sessionResource: URI, type: PromptsType, token: CancellationToken): Promise<readonly ICustomizationSourceFolder[] | undefined>;
}
/**
 * A directory where new customization files of a given type can be created.
 */
export interface ICustomizationSourceFolder {
    readonly uri: URI;
    /** Display label for the picker when multiple folders are offered. */
    readonly label: string;
}
/**
 * Provider interface for harnesses that use an opt-out sync model.
 *
 * Every eligible local customization is synced by default; the user
 * can disable individual items. The persisted set captures only the
 * user's opt-outs.
 */
export interface ICustomizationSyncProvider {
    readonly onDidChange: Event<void>;
    isDisabled(uri: URI): boolean;
    setDisabled(uri: URI, disabled: boolean): void;
}
/**
 * Minimal slash-command metadata resolved from the active harness.
 */
export interface ICustomizationSlashCommand {
    readonly uri: URI;
    readonly type: PromptsType.prompt | PromptsType.skill;
    readonly name: string;
    readonly description?: string;
    readonly userInvocable: boolean;
    readonly sessionTypes?: readonly string[];
}
/**
 * Builds the full source list from the base set (local, user, plugin)
 * plus any additional sources specific to the window type.
 *
 * Core passes `[PromptsStorage.extension]`; sessions passes its
 * BUILTIN_STORAGE constant.
 */
/**
 * Creates a "VS Code" harness descriptor that shows all storage sources
 * with no user-root restrictions.
 */
export declare function createVSCodeHarnessDescriptor(): IHarnessDescriptor;
/**
 * Reusable base implementation of {@link ICustomizationHarnessService}.
 * Concrete registrations only need to supply the list of harness
 * descriptors and a default harness id.
 */
export declare class CustomizationHarnessServiceBase implements ICustomizationHarnessService {
    private readonly promptsService;
    readonly _serviceBrand: undefined;
    private readonly _onDidChangeSlashCommands;
    readonly onDidChangeSlashCommands: Event<{
        readonly sessionType: string;
    }>;
    private readonly _onDidChangeCustomAgents;
    readonly onDidChangeCustomAgents: Event<{
        readonly sessionType: string;
    }>;
    private readonly _providerListeners;
    private _isDisposed;
    private readonly _activeSessionResource;
    readonly activeSessionResource: IObservable<URI>;
    private readonly _activeHarness;
    readonly activeHarness: IObservable<string>;
    private readonly _staticHarnesses;
    private readonly _externalHarnesses;
    private readonly _availableHarnesses;
    readonly availableHarnesses: IObservable<readonly IHarnessDescriptor[]>;
    constructor(staticHarnesses: readonly IHarnessDescriptor[], defaultHarness: string, promptsService: IPromptsService);
    private _getAllHarnesses;
    private _refreshAvailableHarnesses;
    private _rebindProviderListeners;
    dispose(): void;
    registerExternalHarness(descriptor: IHarnessDescriptor): IDisposable;
    findHarnessById(id: string): IHarnessDescriptor | undefined;
    setActiveSession(sessionResource: URI): void;
    getActiveDescriptor(): IHarnessDescriptor;
    getSlashCommands(sessionResource: URI, token: CancellationToken): Promise<readonly IChatPromptSlashCommand[]>;
    getCustomAgents(sessionResource: URI, token: CancellationToken): Promise<readonly ICustomAgent[]>;
    resolvePromptSlashCommand(name: string, sessionResource: URI, token: CancellationToken): Promise<IResolvedChatPromptSlashCommand | undefined>;
    getSessionResourceForHarness(sessionType: string): URI;
}
