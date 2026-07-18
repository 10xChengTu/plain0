import { CancellationToken } from "../../../../../../base/common/cancellation.js";
import { Event } from "../../../../../../base/common/event.js";
import { Disposable, IDisposable } from "../../../../../../base/common/lifecycle.js";
import { ResourceSet } from "../../../../../../base/common/map.js";
import { URI } from "../../../../../../base/common/uri.js";
import { type ITextModel } from "../../../../../../editor/common/model.js";
import { IModelService } from "../../../../../../editor/common/services/model.service.js";
import { IConfigurationService } from "../../../../../../platform/configuration/common/configuration.service.js";
import { IExtensionDescription } from "../../../../../../platform/extensions/common/extensions.js";
import { IFileService } from "../../../../../../platform/files/common/files.service.js";
import { IInstantiationService } from "../../../../../../platform/instantiation/common/instantiation.js";
import { ILabelService } from "../../../../../../platform/label/common/label.service.js";
import { ILogService } from "../../../../../../platform/log/common/log.service.js";
import { IStorageService } from "../../../../../../platform/storage/common/storage.service.js";
import { ITelemetryService } from "../../../../../../platform/telemetry/common/telemetry.service.js";
import { IUserDataProfileService } from "../../../../../services/userDataProfile/common/userDataProfile.service.js";
import { IResolvedPromptSourceFolder } from "../config/promptFileLocations.js";
import { PromptsType } from "../promptTypes.js";
import { PromptFilesLocator } from "../utils/promptFilesLocator.js";
import { ParsedPromptFile } from "../promptFileParser.js";
import { IAgentSource, IChatPromptSlashCommand, IConfiguredHooksInfo, ICustomAgent, IPromptPath, IAgentSkill, IInstructionFile, PromptsStorage, IPromptFileContext, IPromptFileResource, IPromptDiscoveryInfo, IAgentInstructionFile, Logger, IResolvedChatPromptSlashCommand } from "./promptsService.js";
import { IPromptsService } from "./promptsService.service.js";
import { ChatRequestHooks } from "../hookSchema.js";
import { IWorkspaceContextService } from "../../../../../../platform/workspace/common/workspace.service.js";
import { IWorkspaceTrustManagementService } from "../../../../../../platform/workspace/common/workspaceTrust.service.js";
import { IPathService } from "../../../../../services/path/common/pathService.service.js";
import { IAgentPluginService } from "../../plugins/agentPluginService.service.js";
/**
 * Provides prompt services.
 */
export declare class PromptsService extends Disposable implements IPromptsService {
    readonly logger: ILogService;
    private readonly labelService;
    private readonly modelService;
    protected readonly instantiationService: IInstantiationService;
    private readonly userDataService;
    private readonly configurationService;
    protected readonly fileService: IFileService;
    private readonly storageService;
    private readonly telemetryService;
    private readonly workspaceService;
    protected readonly pathService: IPathService;
    private readonly agentPluginService;
    private readonly workspaceTrustService;
    readonly _serviceBrand: undefined;
    /**
     * Prompt files locator utility.
     */
    private readonly fileLocator;
    /**
     * Cached agent discovery info.
     */
    private readonly cachedCustomAgents;
    /**
     * Cached slash command discovery info.
     */
    private readonly cachedSlashCommands;
    /**
     * Cached hooks. Invalidated when hook files change.
     */
    private readonly cachedHooks;
    /**
     * Cached skill discovery info.
     */
    private readonly cachedSkills;
    /**
     * Cached instructions.
     */
    private readonly cachedInstructions;
    private readonly agentInstructionsWatcher;
    private readonly _onDidChangeAgentInstructions;
    /**
     * Synchronous mirror of the names exposed by {@link getPromptSlashCommands},
     * maintained for {@link hasPromptSlashCommand} so callers (e.g. the chat request
     * parser) can disambiguate `<cmd>:<sub>` vs bare `<cmd>` without an async hop.
     */
    private readonly knownPromptSlashCommandNames;
    /**
     * Cache for parsed prompt files keyed by URI.
     * The number in the returned tuple is textModel.getVersionId(), which is an internal VS Code counter that increments every time the text model's content changes.
     */
    private readonly cachedParsedPromptFromModels;
    /**
     * Cached file locations commands. Caching only happens if the corresponding `fileLocatorEvents` event is used.
     */
    private readonly cachedFileLocations;
    /**
     * Lazily created events that notify listeners when the file locations for a given prompt type change.
     * An event is created on demand for each prompt type and can be used by consumers to react to updates
     * in the set of prompt files (e.g., when prompt files are added, removed, or modified).
     */
    private readonly fileLocatorEvents;
    /**
     * Owns the registry of extension-contributed prompt files (both via
     * contribution points and via provider API).
     */
    private readonly extensionPromptFiles;
    private readonly _onDidPluginPromptFilesChange;
    private readonly _onDidPluginHooksChange;
    private _pluginPromptFilesByType;
    constructor(logger: ILogService, labelService: ILabelService, modelService: IModelService, instantiationService: IInstantiationService, userDataService: IUserDataProfileService, configurationService: IConfigurationService, fileService: IFileService, storageService: IStorageService, telemetryService: ITelemetryService, workspaceService: IWorkspaceContextService, pathService: IPathService, agentPluginService: IAgentPluginService, workspaceTrustService: IWorkspaceTrustManagementService);
    private watchPluginPromptFilesForType;
    protected createPromptFilesLocator(): PromptFilesLocator;
    private getFileLocatorEvent;
    getParsedPromptFile(textModel: ITextModel): ParsedPromptFile;
    listPromptFiles(type: PromptsType, token: CancellationToken): Promise<readonly IPromptPath[]>;
    private computeListPromptFiles;
    /**
     * Collects diagnostic information about which source folders were searched for display in the debug panel.
     */
    private _collectSourceFolderDiagnostics;
    /**
     * Registers a prompt file provider (CustomAgentProvider, InstructionsProvider, or PromptFileProvider).
     * This will be called by the extension host bridge when
     * an extension registers a provider via vscode.chat.registerCustomAgentProvider(),
     * registerInstructionsProvider(), or registerPromptFileProvider().
     */
    registerPromptFileProvider(extension: IExtensionDescription, type: PromptsType, provider: {
        onDidChangePromptFiles?: Event<void>;
        providePromptFiles: (context: IPromptFileContext, token: CancellationToken) => Promise<IPromptFileResource[] | undefined>;
    }): IDisposable;
    listPromptFilesForStorage(type: PromptsType, storage: PromptsStorage, token: CancellationToken): Promise<readonly IPromptPath[]>;
    private getExtensionPromptFiles;
    getSourceFolders(type: PromptsType): Promise<readonly IPromptPath[]>;
    getResolvedSourceFolders(type: PromptsType): Promise<readonly IResolvedPromptSourceFolder[]>;
    /**
     * Emitter for slash commands change events.
     */
    get onDidChangeSlashCommands(): Event<void>;
    getPromptSlashCommands(token: CancellationToken): Promise<readonly IChatPromptSlashCommand[]>;
    /**
     * Computes discovery info for slash commands, combining prompts and skills.
     */
    private computeSlashCommandDiscoveryInfo;
    /**
     * Derives IChatPromptSlashCommand[] from cached discovery info.
     */
    private slashCommandsFromDiscoveryInfo;
    isValidSlashCommandName(command: string): boolean;
    hasPromptSlashCommand(name: string): boolean;
    private knownPromptSlashCommandsHydrationStarted;
    private refreshKnownPromptSlashCommandNames;
    resolvePromptSlashCommand(name: string, sessionType: string | undefined, token: CancellationToken): Promise<IResolvedChatPromptSlashCommand | undefined>;
    private asChatPromptSlashCommand;
    getPromptSlashCommandName(uri: URI, token: CancellationToken): Promise<string>;
    /**
     * Emitter for custom agents change events.
     */
    get onDidChangeCustomAgents(): Event<void>;
    get onDidChangeInstructions(): Event<void>;
    get onDidChangeAgentInstructions(): Event<void>;
    getCustomAgents(token: CancellationToken): Promise<readonly ICustomAgent[]>;
    /**
     * Derives ICustomAgent[] from cached discovery info.
     */
    private agentsFromDiscoveryInfo;
    private computeAgentDiscoveryInfo;
    parseNew(uri: URI, token: CancellationToken): Promise<ParsedPromptFile>;
    registerContributedFile(type: PromptsType, uri: URI, extension: IExtensionDescription, name?: string, description?: string, when?: string, sessionTypes?: readonly string[]): IDisposable;
    getPromptLocationLabel(promptPath: IPromptPath): string;
    listNestedAgentMDs(token: CancellationToken): Promise<IAgentInstructionFile[]>;
    listAgentInstructions(token: CancellationToken, logger: Logger | undefined): Promise<IAgentInstructionFile[]>;
    getAgentFileURIFromModeFile(oldURI: URI): URI | undefined;
    private readonly disabledPromptsStorageKeyPrefix;
    getDisabledPromptFiles(type: PromptsType): ResourceSet;
    setDisabledPromptFiles(type: PromptsType, uris: ResourceSet): void;
    private sanitizeAgentSkillText;
    private truncateAgentSkillName;
    private truncateAgentSkillDescription;
    get onDidChangeSkills(): Event<void>;
    get onDidChangeHooks(): Event<void>;
    findAgentSkills(token: CancellationToken): Promise<IAgentSkill[] | undefined>;
    /**
     * Derives IAgentSkill[] from cached discovery info.
     */
    private skillsFromDiscoveryInfo;
    /**
     * Computes the full skill discovery info, including source folders and telemetry.
     */
    private computeSkillDiscovery;
    getHooks(token: CancellationToken): Promise<IConfiguredHooksInfo | undefined>;
    getDiscoveryInfo(type: PromptsType, token: CancellationToken): Promise<IPromptDiscoveryInfo>;
    getInstructionFiles(token: CancellationToken): Promise<readonly IInstructionFile[]>;
    private instructionsFromDiscoveryInfo;
    private withPromptPathMetadata;
    private computeInstructionFiles;
    private computeHooks;
    /**
     * Precedence used when deduplicating skills that share the same canonical
     * name: workspace > personal > plugin > extension API > extension contribution.
     * Lower numbers win.
     */
    private getSkillPriority;
    /**
     * Returns the discovery results for skill files.
     */
    private computeSkillDiscoveryInfo;
    private getInstructionsDiscoveryInfo;
}
export declare namespace CustomAgent {
    function fromParsedPromptFile(ast: ParsedPromptFile, extra: {
        name?: string;
        description?: string;
        source: IAgentSource;
        hooks?: ChatRequestHooks;
        sessionTypes: readonly string[] | undefined;
        enabled: boolean;
    }): ICustomAgent;
}
