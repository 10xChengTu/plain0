import { CancellationToken } from "../../../../base/common/cancellation.js";
import { Event } from "../../../../base/common/event.js";
import { IDisposable } from "../../../../base/common/lifecycle.js";
import { IObservable } from "../../../../base/common/observable.js";
import { URI } from "../../../../base/common/uri.js";
import { IHarnessDescriptor } from "./customizationHarnessService.js";
import { IChatPromptSlashCommand, ICustomAgent, IResolvedChatPromptSlashCommand } from "./promptSyntax/service/promptsService.js";
export declare const ICustomizationHarnessService: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<ICustomizationHarnessService>;
/**
* Service that manages the active customization harness and provides
* per-type storage source filters based on the selected harness.
*
* The default (core) registration exposes a single "VS Code" harness
* that shows all storage sources. The sessions window overrides this
* to provide CLI-scoped harnesses.
*/
export interface ICustomizationHarnessService {
    readonly _serviceBrand: undefined;
    /**
    * The currently active chat session resource.
    */
    readonly activeSessionResource: IObservable<URI>;
    /**
    * The currently active harness.
    */
    readonly activeHarness: IObservable<string>;
    /**
    * All harnesses available in this window.
    * When only one harness is available the UI should hide the toggle.
    */
    readonly availableHarnesses: IObservable<readonly IHarnessDescriptor[]>;
    /**
    * Finds the descriptor of the harness with the given id, or `undefined` if no such harness exists.
    * @param sessionType The harness id (sessionType)
    */
    findHarnessById(sessionType: string): IHarnessDescriptor | undefined;
    /**
    * Changes the active session. The new session's type must be present in
    * `availableHarnesses`.
    */
    setActiveSession(sessionResource: URI): void;
    /**
    * Returns the descriptor of the currently active harness.
    */
    getActiveDescriptor(): IHarnessDescriptor;
    /**
    * Registers an external harness contributed by an extension.
    * The harness appears in the UI toggle alongside static harnesses.
    * Returns a disposable that removes the harness when disposed.
    */
    registerExternalHarness(descriptor: IHarnessDescriptor): IDisposable;
    /**
    * Fires when one of the provided slash commands changes.
    */
    readonly onDidChangeSlashCommands: Event<{
        readonly sessionType: string;
    }>;
    /**
    * Fires when one of the provided custom agents changes.
    */
    readonly onDidChangeCustomAgents: Event<{
        readonly sessionType: string;
    }>;
    /**
    * Returns the prompt and skill slash commands for the given session type.
    * Provider-backed harnesses contribute their own items directly; the default
    * VS Code harness falls back to the core prompts service.
    *
    * @param sessionResource URI of the chat session whose customizations
    *   should be considered. Forwarded to the underlying
    *   {@link ICustomizationItemProvider.provideChatSessionCustomizations}.
    */
    getSlashCommands(sessionResource: URI, token: CancellationToken): Promise<readonly IChatPromptSlashCommand[]>;
    /**
    * Returns the custom agents for the given session type.
    * Provider-backed harnesses select items via their own provider and resolve
    * details via the core prompts service.
    *
    * @param sessionResource URI of the chat session whose customizations
    *   should be considered. Forwarded to the underlying
    *   {@link ICustomizationItemProvider.provideChatSessionCustomizations}.
    */
    getCustomAgents(sessionResource: URI, token: CancellationToken): Promise<readonly ICustomAgent[]>;
    /**
    * Resolves a slash command to its full metadata, including the parsed prompt file for prompt commands.
    * Provider-backed harnesses resolve their own items directly; the default VS Code harness falls back to the core prompts service.
    *
    * @param sessionResource URI of the chat session whose customizations
    *   should be considered when looking up the slash command.
    */
    resolvePromptSlashCommand(name: string, sessionResource: URI, token: CancellationToken): Promise<IResolvedChatPromptSlashCommand | undefined>;
    /**
    * Returns the best session resource to use for a harness lookup.
    * Implementations should prefer the most recently used session for the
    * given session type and fall back to an untitled session resource.
    */
    getSessionResourceForHarness(sessionType: string): URI;
}
