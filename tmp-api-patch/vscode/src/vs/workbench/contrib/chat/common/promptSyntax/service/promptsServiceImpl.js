
import { __decorate, __param } from '../../../../../../../../../external/tslib/tslib.es6.js';
import { CancellationToken, CancellationTokenPool } from '../../../../../../base/common/cancellation.js';
import { isCancellationError, CancellationError } from '../../../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { parse } from '../../../../../../base/common/json.js';
import { getParseErrorMessage } from '../../../../../../base/common/jsonErrorMessages.js';
import { Disposable, MutableDisposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { StopWatch } from '../../../../../../base/common/stopwatch.js';
import '../../../../../../base/common/observableInternal/index.js';
import { ResourceMap, ResourceSet } from '../../../../../../base/common/map.js';
import { isEqual, dirname, basename } from '../../../../../../base/common/resources.js';
import { URI } from '../../../../../../base/common/uri.js';
import { OffsetRange } from '../../../../../../editor/common/core/ranges/offsetRange.js';
import { IModelService } from '../../../../../../editor/common/services/model.service.js';
import { localize } from '../../../../../../nls.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.service.js';
import { FileOperationError, FileOperationResult } from '../../../../../../platform/files/common/files.js';
import { IFileService } from '../../../../../../platform/files/common/files.service.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../../../platform/label/common/label.service.js';
import { ILogService } from '../../../../../../platform/log/common/log.service.js';
import { StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { IStorageService } from '../../../../../../platform/storage/common/storage.service.js';
import { ITelemetryService } from '../../../../../../platform/telemetry/common/telemetry.service.js';
import { IUserDataProfileService } from '../../../../../services/userDataProfile/common/userDataProfile.service.js';
import { PromptsConfig } from '../config/config.js';
import { getSkillFolderName, getCleanPromptName, AGENT_MD_FILENAME, CLAUDE_MD_FILENAME, CLAUDE_LOCAL_MD_FILENAME, CLAUDE_CONFIG_FOLDER, COPILOT_CUSTOM_INSTRUCTIONS_FILENAME, GITHUB_CONFIG_FOLDER, COPILOT_CONFIG_FOLDER, isInClaudeRulesFolder } from '../config/promptFileLocations.js';
import { PromptsType, PromptFileSource, PROMPT_LANGUAGE_ID, getPromptsTypeForLanguageId, Target } from '../promptTypes.js';
import { PromptFilesLocator } from '../utils/promptFilesLocator.js';
import { PromptFileParser, evaluateApplyToPattern, PromptHeaderAttributes } from '../promptFileParser.js';
import { PromptsStorage, matchesSessionType, IAgentSource, AgentInstructionFileType } from './promptsService.js';
import { Delayer, raceCancellationError } from '../../../../../../base/common/async.js';
import { Schemas } from '../../../../../../base/common/network.js';
import { parseSubagentHooksFromYaml } from '../hookSchema.js';
import { parseHooksFromFile, HookSourceFormat } from '../hookCompatibility.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.service.js';
import { IWorkspaceTrustManagementService } from '../../../../../../platform/workspace/common/workspaceTrust.service.js';
import { IPathService } from '../../../../../services/path/common/pathService.service.js';
import { getTarget, mapClaudeModels, mapClaudeTools } from '../languageProviders/promptFileAttributes.js';
import { getCanonicalPluginCommandId } from '../../plugins/agentPluginService.js';
import { IAgentPluginService } from '../../plugins/agentPluginService.service.js';
import { isContributionEnabled } from '../../enablement.js';
import { assertNever } from '../../../../../../base/common/assert.js';
import { ExtensionPromptFileService } from './extensionPromptFileService.js';
import { autorun } from '../../../../../../base/common/observableInternal/reactions/autorun.js';

let PromptsService = class PromptsService extends Disposable {
    constructor(
        logger,
        labelService,
        modelService,
        instantiationService,
        userDataService,
        configurationService,
        fileService,
        storageService,
        telemetryService,
        workspaceService,
        pathService,
        agentPluginService,
        workspaceTrustService
    ) {
        super();
        this.logger = logger;
        this.labelService = labelService;
        this.modelService = modelService;
        this.instantiationService = instantiationService;
        this.userDataService = userDataService;
        this.configurationService = configurationService;
        this.fileService = fileService;
        this.storageService = storageService;
        this.telemetryService = telemetryService;
        this.workspaceService = workspaceService;
        this.pathService = pathService;
        this.agentPluginService = agentPluginService;
        this.workspaceTrustService = workspaceTrustService;
        this.agentInstructionsWatcher = this._register(( new MutableDisposable()));
        this._onDidChangeAgentInstructions = this._register(( new Emitter({
            onWillAddFirstListener: () => {
                const store = ( new DisposableStore());
                const agentInstructionsUpdatedEvent = this.fileLocator.createAgentInstructionsUpdatedEvent();
                store.add(agentInstructionsUpdatedEvent);
                store.add(
                    agentInstructionsUpdatedEvent.event(() => this._onDidChangeAgentInstructions.fire())
                );
                this.agentInstructionsWatcher.value = store;
            },
            onDidRemoveLastListener: () => {
                this.agentInstructionsWatcher.clear();
            }
        })));
        this.knownPromptSlashCommandNames = ( new Set());
        this.cachedParsedPromptFromModels = ( new ResourceMap());
        this.cachedFileLocations = {};
        this.fileLocatorEvents = {};
        this._onDidPluginPromptFilesChange = this._register(( new Emitter()));
        this._onDidPluginHooksChange = this._register(( new Emitter()));
        this._pluginPromptFilesByType = ( new Map());
        this.knownPromptSlashCommandsHydrationStarted = false;
        this.disabledPromptsStorageKeyPrefix = "chat.disabledPromptFiles.";
        this.fileLocator = this.createPromptFilesLocator();
        this._register(this.modelService.onModelRemoved(model => {
            this.cachedParsedPromptFromModels.delete(model.uri);
        }));
        this.extensionPromptFiles = this._register(this.instantiationService.createInstance(ExtensionPromptFileService));
        const onDidChangeExtensionPromptFiles = this.extensionPromptFiles.onDidChange;
        this._register(onDidChangeExtensionPromptFiles(e => {
            this.cachedFileLocations[e.type] = undefined;
        }));
        const modelChangeEvent = this._register(( new ModelChangeTracker(this.modelService))).onDidPromptChange;
        this.cachedCustomAgents = this._register(( new CachedPromise(token => this.computeAgentDiscoveryInfo(token), () => Event.any(
            this.getFileLocatorEvent(PromptsType.agent),
            Event.filter(modelChangeEvent, e => e.promptType === PromptsType.agent),
            Event.filter(
                this.configurationService.onDidChangeConfiguration,
                e => e.affectsConfiguration(PromptsConfig.USE_CHAT_HOOKS)
            ),
            Event.filter(onDidChangeExtensionPromptFiles, e => e.type === PromptsType.agent),
            Event.filter(this._onDidPluginPromptFilesChange.event, t => t === PromptsType.agent),
            this.workspaceTrustService.onDidChangeTrust
        ))));
        this.cachedSlashCommands = this._register(( new CachedPromise(token => this.computeSlashCommandDiscoveryInfo(token), () => Event.any(
            this.getFileLocatorEvent(PromptsType.prompt),
            this.getFileLocatorEvent(PromptsType.skill),
            Event.filter(modelChangeEvent, e => e.promptType === PromptsType.prompt),
            Event.filter(modelChangeEvent, e => e.promptType === PromptsType.skill),
            Event.filter(
                onDidChangeExtensionPromptFiles,
                e => e.type === PromptsType.prompt || e.type === PromptsType.skill
            ),
            Event.filter(
                this._onDidPluginPromptFilesChange.event,
                t => t === PromptsType.prompt || t === PromptsType.skill
            )
        ))));
        this.cachedSkills = this._register(( new CachedPromise(token => this.computeSkillDiscovery(token), () => Event.any(
            this.getFileLocatorEvent(PromptsType.skill),
            Event.filter(modelChangeEvent, e => e.promptType === PromptsType.skill),
            Event.filter(onDidChangeExtensionPromptFiles, e => e.type === PromptsType.skill),
            Event.filter(this._onDidPluginPromptFilesChange.event, t => t === PromptsType.skill)
        ))));
        this.cachedHooks = this._register(( new CachedPromise(
            token => this.computeHooks(token),
            () => Event.any(this.getFileLocatorEvent(PromptsType.hook), Event.filter(
                this.configurationService.onDidChangeConfiguration,
                e => e.affectsConfiguration(PromptsConfig.USE_CHAT_HOOKS) || e.affectsConfiguration(PromptsConfig.USE_CLAUDE_HOOKS)
            ), this._onDidPluginHooksChange.event, this.workspaceTrustService.onDidChangeTrust)
        )));
        this.cachedInstructions = this._register(( new CachedPromise(token => this.computeInstructionFiles(token), () => Event.any(
            this.getFileLocatorEvent(PromptsType.instructions),
            Event.filter(onDidChangeExtensionPromptFiles, e => e.type === PromptsType.instructions),
            Event.filter(
                this._onDidPluginPromptFilesChange.event,
                t => t === PromptsType.instructions
            )
        ))));
        this._register(
            this.watchPluginPromptFilesForType(PromptsType.prompt, (plugin, reader) => plugin.commands.read(reader))
        );
        this._register(
            this.watchPluginPromptFilesForType(PromptsType.skill, (plugin, reader) => plugin.skills.read(reader))
        );
        this._register(
            this.watchPluginPromptFilesForType(PromptsType.agent, (plugin, reader) => plugin.agents.read(reader))
        );
        this._register(this.watchPluginPromptFilesForType(
            PromptsType.instructions,
            (plugin, reader) => plugin.instructions.read(reader)
        ));
        this._register(autorun(reader => {
            const plugins = this.agentPluginService.plugins.read(reader);
            const hookFiles = [];
            for (const plugin of plugins) {
                if (isContributionEnabled(plugin.enablement.read(reader))) {
                    for (const hook of plugin.hooks.read(reader)) {
                        hookFiles.push({
                            uri: hook.uri,
                            storage: PromptsStorage.plugin,
                            type: PromptsType.hook,
                            name: getCanonicalPluginCommandId(plugin, hook.originalId),
                            pluginUri: plugin.uri,
                            pluginLabel: plugin.label,
                            source: PromptFileSource.Plugin
                        });
                    }
                }
            }
            this._pluginPromptFilesByType.set(PromptsType.hook, hookFiles);
            this.cachedFileLocations[PromptsType.hook] = undefined;
            this._onDidPluginHooksChange.fire();
        }));
    }
    watchPluginPromptFilesForType(type, getItems) {
        return autorun(reader => {
            const plugins = this.agentPluginService.plugins.read(reader);
            const nextFiles = [];
            for (const plugin of plugins) {
                if (!isContributionEnabled(plugin.enablement.read(reader))) {
                    continue;
                }
                for (const item of getItems(plugin, reader)) {
                    nextFiles.push({
                        uri: item.uri,
                        storage: PromptsStorage.plugin,
                        type,
                        name: getCanonicalPluginCommandId(plugin, item.name),
                        pluginUri: plugin.uri,
                        pluginLabel: plugin.label,
                        source: PromptFileSource.Plugin
                    });
                }
            }
            nextFiles.sort((a, b) => `${a.name ?? ""}|${( a.uri.toString())}`.localeCompare(`${b.name ?? ""}|${( b.uri.toString())}`));
            this._pluginPromptFilesByType.set(type, nextFiles);
            this.cachedFileLocations[type] = undefined;
            this._onDidPluginPromptFilesChange.fire(type);
        });
    }
    createPromptFilesLocator() {
        return this.instantiationService.createInstance(PromptFilesLocator);
    }
    getFileLocatorEvent(type) {
        let event = this.fileLocatorEvents[type];
        if (!event) {
            event = this.fileLocatorEvents[type] = this._register(this.fileLocator.createFilesUpdatedEvent(type)).event;
            this._register(event(() => {
                this.cachedFileLocations[type] = undefined;
            }));
        }
        return event;
    }
    getParsedPromptFile(textModel) {
        const cached = this.cachedParsedPromptFromModels.get(textModel.uri);
        if (cached && cached[0] === textModel.getVersionId()) {
            return cached[1];
        }
        const ast = ( new PromptFileParser()).parse(textModel.uri, textModel.getValue());
        if (!cached || cached[0] < textModel.getVersionId()) {
            this.cachedParsedPromptFromModels.set(textModel.uri, [textModel.getVersionId(), ast]);
        }
        return ast;
    }
    async listPromptFiles(type, token) {
        let listPromise = this.cachedFileLocations[type];
        if (!listPromise) {
            listPromise = this.computeListPromptFiles(type, token);
            if (!this.fileLocatorEvents[type]) {
                return listPromise;
            }
            this.cachedFileLocations[type] = listPromise;
            return listPromise;
        }
        return listPromise;
    }
    async computeListPromptFiles(type, token) {
        const prompts = await Promise.all([
            this.fileLocator.listFiles(type, PromptsStorage.user, token).then(uris => ( uris.map(uri => ({
                uri,
                storage: PromptsStorage.user,
                type
            })))),
            this.fileLocator.listFiles(type, PromptsStorage.local, token).then(uris => ( uris.map(uri => ({
                uri,
                storage: PromptsStorage.local,
                type
            })))),
            this.getExtensionPromptFiles(type, token),
            this._pluginPromptFilesByType.get(type) ?? []
        ]);
        return prompts.flat();
    }
    async _collectSourceFolderDiagnostics(type) {
        const resolvedFolders = await this.fileLocator.getSourceFoldersInDiscoveryOrder(type);
        return ( resolvedFolders.map(folder => ({
            uri: folder.uri,
            storage: folder.storage
        })));
    }
    registerPromptFileProvider(extension, type, provider) {
        return this.extensionPromptFiles.registerPromptFileProvider(extension, type, provider);
    }
    async listPromptFilesForStorage(type, storage, token) {
        let promptPaths;
        switch (storage) {
        case PromptsStorage.extension:
            promptPaths = await this.getExtensionPromptFiles(type, token);
            break;
        case PromptsStorage.local:
            promptPaths = await this.fileLocator.listFiles(type, PromptsStorage.local, token).then(uris => ( uris.map(uri => ({
                uri,
                storage: PromptsStorage.local,
                type
            }))));
            break;
        case PromptsStorage.user:
            promptPaths = await this.fileLocator.listFiles(type, PromptsStorage.user, token).then(uris => ( uris.map(uri => ({
                uri,
                storage: PromptsStorage.user,
                type
            }))));
            break;
        case PromptsStorage.plugin:
            promptPaths = this._pluginPromptFilesByType.get(type) ?? [];
            break;
        default:
            throw ( new Error(`[listPromptFilesForStorage] Unsupported prompt storage type: ${storage}`));
        }
        return promptPaths;
    }
    getExtensionPromptFiles(type, token) {
        return this.extensionPromptFiles.getExtensionPromptFiles(type, token);
    }
    async getSourceFolders(type) {
        const result = [];
        if (type === PromptsType.hook) {
            const hooksFolders = await this.fileLocator.getHookSourceFolders();
            for (const folder of hooksFolders) {
                result.push({
                    uri: folder.uri,
                    storage: folder.storage,
                    type,
                    source: folder.source
                });
            }
        } else {
            for (const uri of await this.fileLocator.getConfigBasedSourceFolders(type)) {
                result.push({
                    uri,
                    storage: PromptsStorage.local,
                    type
                });
            }
        }
        if (type !== PromptsType.skill && type !== PromptsType.hook) {
            const userHome = this.userDataService.currentProfile.promptsHome;
            result.push({
                uri: userHome,
                storage: PromptsStorage.user,
                type
            });
        }
        return result;
    }
    async getResolvedSourceFolders(type) {
        return this.fileLocator.getResolvedSourceFolders(type);
    }
    get onDidChangeSlashCommands() {
        return this.cachedSlashCommands.onDidChangePromise;
    }
    async getPromptSlashCommands(token) {
        const discoveryInfo = await this.cachedSlashCommands.get(token);
        const result = this.slashCommandsFromDiscoveryInfo(discoveryInfo);
        return result;
    }
    async computeSlashCommandDiscoveryInfo(token) {
        const stopWatch = StopWatch.create(true);
        const promptFiles = await this.listPromptFiles(PromptsType.prompt, token);
        const useAgentSkills = this.configurationService.getValue(PromptsConfig.USE_AGENT_SKILLS);
        const skills = useAgentSkills ? await this.listPromptFiles(PromptsType.skill, token) : [];
        const disabledSkills = this.getDisabledPromptFiles(PromptsType.skill);
        const enabledSkills = skills.filter(s => !( disabledSkills.has(s.uri))).sort((a, b) => this.getSkillPriority(a) - this.getSkillPriority(b));
        const slashCommandFiles = [...promptFiles, ...enabledSkills];
        const parseResults = await Promise.all(( slashCommandFiles.map(async promptPath => {
            try {
                const parsedPromptFile = await this.parseNew(promptPath.uri, token);
                let rawName;
                if (promptPath.type === PromptsType.skill) {
                    rawName = getSkillFolderName(promptPath.uri);
                } else {
                    rawName = parsedPromptFile?.header?.name ?? promptPath.name ?? getCleanPromptName(promptPath.uri);
                }
                const name = promptPath.source === PromptFileSource.Plugin && promptPath.pluginUri ? getCanonicalPluginCommandId({
                    uri: promptPath.pluginUri,
                    label: promptPath.pluginLabel
                }, rawName) : rawName;
                const description = parsedPromptFile?.header?.description ?? promptPath.description;
                const argumentHint = parsedPromptFile?.header?.argumentHint;
                const userInvocable = parsedPromptFile?.header?.userInvocable;
                return {
                    status: "loaded",
                    promptPath: this.withPromptPathMetadata(promptPath, name, description),
                    argumentHint,
                    userInvocable
                };
            } catch (e) {
                this.logger.error(
                    `[computeSlashCommandDiscoveryInfo] Failed to parse prompt file for slash command: ${promptPath.uri}`,
                    e instanceof Error ? e.message : String(e)
                );
                return {
                    status: "skipped",
                    skipReason: "parse-error",
                    errorMessage: e instanceof Error ? e.message : String(e),
                    promptPath
                };
            }
        })));
        const seenSkillNames = ( new Set());
        const files = [];
        for (const result of parseResults) {
            if (result.status === "loaded" && result.promptPath.type === PromptsType.skill) {
                const name = result.promptPath.name;
                if (name !== undefined) {
                    if (( seenSkillNames.has(name))) {
                        files.push({
                            status: "skipped",
                            skipReason: "duplicate-name",
                            promptPath: result.promptPath
                        });
                        continue;
                    }
                    seenSkillNames.add(name);
                }
            }
            files.push(result);
        }
        const promptSourceFolders = await this._collectSourceFolderDiagnostics(PromptsType.prompt);
        const sourceFolders = [...promptSourceFolders];
        if (useAgentSkills) {
            const skillSourceFolders = await this._collectSourceFolderDiagnostics(PromptsType.skill);
            sourceFolders.push(...skillSourceFolders);
        }
        return {
            type: PromptsType.prompt,
            files,
            sourceFolders,
            durationInMillis: stopWatch.elapsed()
        };
    }
    slashCommandsFromDiscoveryInfo(discoveryInfo) {
        const result = [];
        const seen = ( new ResourceSet());
        for (const file of discoveryInfo.files) {
            if (file.status === "loaded") {
                result.push(
                    this.asChatPromptSlashCommand(file.argumentHint, file.userInvocable, file.promptPath)
                );
                seen.add(file.promptPath.uri);
            }
        }
        for (const model of this.modelService.getModels()) {
            if (model.getLanguageId() === PROMPT_LANGUAGE_ID && model.uri.scheme === Schemas.untitled && !( seen.has(model.uri))) {
                const parsedPromptFile = this.getParsedPromptFile(model);
                const name = parsedPromptFile?.header?.name ?? getCleanPromptName(model.uri);
                const description = parsedPromptFile?.header?.description;
                result.push(this.asChatPromptSlashCommand(
                    parsedPromptFile?.header?.argumentHint,
                    parsedPromptFile?.header?.userInvocable,
                    {
                        uri: model.uri,
                        storage: PromptsStorage.local,
                        type: PromptsType.prompt,
                        name,
                        description
                    }
                ));
            }
        }
        return result;
    }
    isValidSlashCommandName(command) {
        return command.match(/^[\p{L}\d_\-\.:]+$/u) !== null;
    }
    hasPromptSlashCommand(name) {
        if (!this.knownPromptSlashCommandsHydrationStarted) {
            this.knownPromptSlashCommandsHydrationStarted = true;
            this.refreshKnownPromptSlashCommandNames();
            this._register(
                this.onDidChangeSlashCommands(() => this.refreshKnownPromptSlashCommandNames())
            );
        }
        return ( this.knownPromptSlashCommandNames.has(name));
    }
    refreshKnownPromptSlashCommandNames() {
        this.getPromptSlashCommands(CancellationToken.None).then(commands => {
            this.knownPromptSlashCommandNames.clear();
            for (const cmd of commands) {
                this.knownPromptSlashCommandNames.add(cmd.name);
            }
        }, () => {});
    }
    async resolvePromptSlashCommand(name, sessionType, token) {
        const commands = await this.getPromptSlashCommands(token);
        const command = commands.find(
            cmd => cmd.name === name && matchesSessionType(cmd.sessionTypes, sessionType)
        );
        if (command) {
            return {
                ...command,
                parsedPromptFile: await this.parseNew(command.uri, token)
            };
        }
        return undefined;
    }
    asChatPromptSlashCommand(argumentHint, userInvocable, promptPath) {
        let name = promptPath.name ?? getCleanPromptName(promptPath.uri);
        name = name.replace(/[^\p{L}\d_\-\.:]+/gu, "-");
        return {
            uri: promptPath.uri,
            name: name,
            source: promptPath.source,
            storage: promptPath.storage,
            type: promptPath.type,
            extension: promptPath.extension,
            pluginUri: promptPath.pluginUri,
            pluginLabel: promptPath.pluginLabel,
            description: promptPath.description,
            argumentHint: argumentHint,
            userInvocable: userInvocable ?? true,
            sessionTypes: promptPath.sessionTypes
        };
    }
    async getPromptSlashCommandName(uri, token) {
        const slashCommands = await this.getPromptSlashCommands(token);
        const slashCommand = slashCommands.find(c => isEqual(c.uri, uri));
        if (!slashCommand) {
            return getCleanPromptName(uri);
        }
        return slashCommand.name;
    }
    get onDidChangeCustomAgents() {
        return this.cachedCustomAgents.onDidChangePromise;
    }
    get onDidChangeInstructions() {
        return this.cachedInstructions.onDidChangePromise;
    }
    get onDidChangeAgentInstructions() {
        return this._onDidChangeAgentInstructions.event;
    }
    async getCustomAgents(token) {
        const discoveryInfo = await this.cachedCustomAgents.get(token);
        const result = this.agentsFromDiscoveryInfo(discoveryInfo);
        return result;
    }
    agentsFromDiscoveryInfo(discoveryInfo) {
        const result = [];
        for (const file of discoveryInfo.files) {
            if (file.agent) {
                result.push(file.agent);
            }
        }
        return result;
    }
    async computeAgentDiscoveryInfo(token) {
        const stopWatch = StopWatch.create(true);
        const allAgentFiles = await this.listPromptFiles(PromptsType.agent, token);
        const disabledAgents = this.getDisabledPromptFiles(PromptsType.agent);
        const useChatHooks = this.configurationService.getValue(PromptsConfig.USE_CHAT_HOOKS);
        const isWorkspaceTrusted = this.workspaceTrustService.isWorkspaceTrusted();
        const userHomeUri = await this.pathService.userHome();
        const userHome = userHomeUri.scheme === Schemas.file ? userHomeUri.fsPath : userHomeUri.path;
        const defaultFolder = this.workspaceService.getWorkspace().folders[0];
        const files = await Promise.all(( allAgentFiles.map(async promptPath => {
            const uri = promptPath.uri;
            const isEnabled = !( disabledAgents.has(uri));
            try {
                const ast = await this.parseNew(uri, token);
                let hooks;
                const hooksRaw = ast.header?.hooksRaw;
                if (useChatHooks && isWorkspaceTrusted && hooksRaw) {
                    const hookWorkspaceFolder = this.workspaceService.getWorkspaceFolder(uri) ?? defaultFolder;
                    const workspaceRootUri = hookWorkspaceFolder?.uri;
                    const target = getTarget(PromptsType.agent, ast.header ?? promptPath.uri);
                    hooks = parseSubagentHooksFromYaml(hooksRaw, workspaceRootUri, userHome, target);
                }
                const extra = {
                    sessionTypes: promptPath.sessionTypes,
                    hooks,
                    name: promptPath.name,
                    description: promptPath.description,
                    source: IAgentSource.fromPromptPath(promptPath),
                    enabled: isEnabled
                };
                const agent = CustomAgent.fromParsedPromptFile(ast, extra);
                const status = isEnabled ? "loaded" : "skipped";
                const skipReason = isEnabled ? undefined : "disabled";
                return {
                    status,
                    skipReason,
                    promptPath: this.withPromptPathMetadata(promptPath, agent.name, agent.description),
                    agent
                };
            } catch (e) {
                const error = e instanceof Error ? e : ( new Error(String(e)));
                if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
                    this.logger.warn(
                        `[computeAgentDiscoveryInfo] Skipping agent file that does not exist: ${uri}`,
                        error.message
                    );
                } else if (!isCancellationError(e)) {
                    this.logger.error(`[computeAgentDiscoveryInfo] Failed to parse agent file: ${uri}`, error);
                }
                return {
                    status: "skipped",
                    skipReason: "parse-error",
                    errorMessage: error.message,
                    promptPath
                };
            }
        })));
        const sourceFolders = await this._collectSourceFolderDiagnostics(PromptsType.agent);
        return {
            type: PromptsType.agent,
            files,
            sourceFolders,
            durationInMillis: stopWatch.elapsed()
        };
    }
    async parseNew(uri, token) {
        const model = this.modelService.getModel(uri);
        if (model) {
            return this.getParsedPromptFile(model);
        }
        const fileContent = await this.fileService.readFile(uri);
        if (token.isCancellationRequested) {
            throw ( new CancellationError());
        }
        return ( new PromptFileParser()).parse(uri, ( fileContent.value.toString()));
    }
    registerContributedFile(type, uri, extension, name, description, when, sessionTypes) {
        return this.extensionPromptFiles.registerContributedFile(type, uri, extension, name, description, when, sessionTypes);
    }
    getPromptLocationLabel(promptPath) {
        switch (promptPath.storage) {
        case PromptsStorage.local:
            return this.labelService.getUriLabel(dirname(promptPath.uri), {
                relative: true
            });
        case PromptsStorage.user:
            return localize(8940, "User Data");
        case PromptsStorage.extension:
            {
                return localize(
                    8941,
                    "Extension: {0}",
                    promptPath.extension.displayName ?? promptPath.extension.id
                );
            }
        case PromptsStorage.plugin:
            return localize(8942, "Plugin");
        default:
            assertNever(promptPath, "Unknown prompt storage type");
        }
    }
    async listNestedAgentMDs(token) {
        const useAgentMD = this.configurationService.getValue(PromptsConfig.USE_AGENT_MD);
        if (!useAgentMD) {
            return [];
        }
        const useNestedAgentMD = this.configurationService.getValue(PromptsConfig.USE_NESTED_AGENT_MD);
        if (useNestedAgentMD) {
            return await this.fileLocator.findAgentMDsInWorkspace(token);
        }
        return [];
    }
    async listAgentInstructions(token, logger) {
        const resolvedAgentFiles = [];
        const promises = [];
        const includeParents = this.configurationService.getValue(PromptsConfig.USE_CUSTOMIZATIONS_IN_PARENT_REPOS) === true;
        const rootFolders = await this.fileLocator.getWorkspaceFolderRoots(includeParents, logger);
        const rootFiles = [];
        const useAgentMD = this.configurationService.getValue(PromptsConfig.USE_AGENT_MD);
        if (!useAgentMD) {
            logger?.logInfo("Agent MD files are disabled via configuration.");
        } else {
            rootFiles.push({
                fileName: AGENT_MD_FILENAME,
                type: AgentInstructionFileType.agentsMd
            });
        }
        const useClaudeMD = this.configurationService.getValue(PromptsConfig.USE_CLAUDE_MD);
        if (!useClaudeMD) {
            logger?.logInfo("Claude MD files are disabled via configuration.");
        } else {
            const claudeMdFile = {
                fileName: CLAUDE_MD_FILENAME,
                type: AgentInstructionFileType.claudeMd
            };
            rootFiles.push(claudeMdFile);
            rootFiles.push({
                fileName: CLAUDE_LOCAL_MD_FILENAME,
                type: AgentInstructionFileType.claudeMd
            });
            promises.push(this.fileLocator.findFilesInRoots(
                rootFolders,
                CLAUDE_CONFIG_FOLDER,
                [claudeMdFile],
                token,
                resolvedAgentFiles
            ));
            promises.push(this.fileLocator.findFilesInRoots(
                [await this.pathService.userHome()],
                CLAUDE_CONFIG_FOLDER,
                [claudeMdFile],
                token,
                resolvedAgentFiles
            ));
        }
        const useCopilotInstructionsFiles = this.configurationService.getValue(PromptsConfig.USE_COPILOT_INSTRUCTION_FILES);
        if (!useCopilotInstructionsFiles) {
            logger?.logInfo("Copilot instructions files are disabled via configuration.");
        } else {
            const copilotInstructionsFile = {
                fileName: COPILOT_CUSTOM_INSTRUCTIONS_FILENAME,
                type: AgentInstructionFileType.copilotInstructionsMd
            };
            promises.push(this.fileLocator.findFilesInRoots(
                rootFolders,
                GITHUB_CONFIG_FOLDER,
                [copilotInstructionsFile],
                token,
                resolvedAgentFiles
            ));
            promises.push(this.fileLocator.findFilesInRoots(
                [await this.pathService.userHome()],
                COPILOT_CONFIG_FOLDER,
                [copilotInstructionsFile],
                token,
                resolvedAgentFiles
            ));
        }
        promises.push(
            this.fileLocator.findFilesInRoots(rootFolders, undefined, rootFiles, token, resolvedAgentFiles)
        );
        await Promise.all(promises);
        if (token.isCancellationRequested) {
            return [];
        }
        const seenFileURI = ( new ResourceSet());
        const symlinks = [];
        const result = [];
        const add = file => {
            if (file.realPath) {
                symlinks.push(file);
            } else {
                result.push(file);
                seenFileURI.add(file.uri);
            }
            return true;
        };
        resolvedAgentFiles.forEach(add);
        for (const symlink of symlinks) {
            if (( seenFileURI.has(symlink.realPath))) {
                logger?.logInfo(
                    `Skipping symlinked agent instructions file ${symlink.uri} as target already included: ${symlink.realPath}`
                );
            } else {
                result.push(symlink);
                seenFileURI.add(symlink.realPath);
            }
        }
        return result.sort((a, b) => ( a.uri.toString()).localeCompare(( b.uri.toString())));
    }
    getAgentFileURIFromModeFile(oldURI) {
        return this.fileLocator.getAgentFileURIFromModeFile(oldURI);
    }
    getDisabledPromptFiles(type) {
        const disabledKey = this.disabledPromptsStorageKeyPrefix + type;
        const value = this.storageService.get(disabledKey, StorageScope.PROFILE, "[]");
        const result = ( new ResourceSet());
        try {
            const arr = JSON.parse(value);
            if (Array.isArray(arr)) {
                for (const s of arr) {
                    try {
                        result.add(URI.revive(s));
                    } catch {}
                }
            }
        } catch {}
        return result;
    }
    setDisabledPromptFiles(type, uris) {
        const disabled = ( Array.from(uris).map(uri => uri.toJSON()));
        this.storageService.store(
            this.disabledPromptsStorageKeyPrefix + type,
            JSON.stringify(disabled),
            StorageScope.PROFILE,
            StorageTarget.USER
        );
        if (type === PromptsType.agent) {
            this.cachedCustomAgents.refresh();
        } else if (type === PromptsType.skill) {
            this.cachedSkills.refresh();
            this.cachedSlashCommands.refresh();
        }
    }
    sanitizeAgentSkillText(text) {
        return text.replace(/<[^>]+>/g, "");
    }
    truncateAgentSkillName(name, uri) {
        const MAX_NAME_LENGTH = 64;
        const sanitized = this.sanitizeAgentSkillText(name);
        if (sanitized !== name) {
            this.logger.debug(`[findAgentSkills] Agent skill name contains XML tags, removed: ${uri}`);
        }
        if (sanitized.length > MAX_NAME_LENGTH) {
            this.logger.debug(
                `[findAgentSkills] Agent skill name exceeds ${MAX_NAME_LENGTH} characters, truncated: ${uri}`
            );
            return sanitized.substring(0, MAX_NAME_LENGTH);
        }
        return sanitized;
    }
    truncateAgentSkillDescription(description, uri) {
        if (!description) {
            return undefined;
        }
        const MAX_DESCRIPTION_LENGTH = 1024;
        const sanitized = this.sanitizeAgentSkillText(description);
        if (sanitized !== description) {
            this.logger.debug(
                `[findAgentSkills] Agent skill description contains XML tags, removed: ${uri}`
            );
        }
        if (sanitized.length > MAX_DESCRIPTION_LENGTH) {
            this.logger.debug(
                `[findAgentSkills] Agent skill description exceeds ${MAX_DESCRIPTION_LENGTH} characters, truncated: ${uri}`
            );
            return sanitized.substring(0, MAX_DESCRIPTION_LENGTH);
        }
        return sanitized;
    }
    get onDidChangeSkills() {
        return this.cachedSkills.onDidChangePromise;
    }
    get onDidChangeHooks() {
        return this.cachedHooks.onDidChangePromise;
    }
    async findAgentSkills(token) {
        const useAgentSkills = this.configurationService.getValue(PromptsConfig.USE_AGENT_SKILLS);
        if (!useAgentSkills) {
            return undefined;
        }
        const discoveryInfo = await this.cachedSkills.get(token);
        const result = this.skillsFromDiscoveryInfo(discoveryInfo);
        return result;
    }
    skillsFromDiscoveryInfo(discoveryInfo) {
        const result = [];
        for (const file of discoveryInfo.files) {
            if (file.status === "loaded" && file.promptPath.name) {
                const sanitizedDescription = this.truncateAgentSkillDescription(file.promptPath.description, file.promptPath.uri);
                result.push({
                    uri: file.promptPath.uri,
                    storage: file.promptPath.storage,
                    name: file.promptPath.name,
                    description: sanitizedDescription,
                    disableModelInvocation: file.disableModelInvocation ?? false,
                    userInvocable: file.userInvocable ?? true,
                    pluginUri: file.promptPath.pluginUri,
                    pluginLabel: file.promptPath.pluginLabel,
                    extension: file.promptPath.extension,
                    sessionTypes: file.promptPath.sessionTypes
                });
            }
        }
        return result;
    }
    async computeSkillDiscovery(token) {
        const stopWatch = StopWatch.create(true);
        const files = await this.computeSkillDiscoveryInfo(token);
        const sourceFolders = await this._collectSourceFolderDiagnostics(PromptsType.skill);
        const skillsBySource = ( new Map());
        for (const file of files) {
            if (file.status === "loaded" && file.promptPath.name) {
                const source = file.promptPath.source;
                if (source) {
                    skillsBySource.set(source, (skillsBySource.get(source) || 0) + 1);
                }
            }
        }
        let skippedMissingName = 0;
        let skippedMissingDescription = 0;
        let skippedDuplicateName = 0;
        let skippedParseFailed = 0;
        let skippedNameMismatch = 0;
        for (const file of files) {
            if (file.status === "skipped") {
                switch (file.skipReason) {
                case "missing-name":
                    skippedMissingName++;
                    break;
                case "missing-description":
                    skippedMissingDescription++;
                    break;
                case "duplicate-name":
                    skippedDuplicateName++;
                    break;
                case "name-mismatch":
                    skippedNameMismatch++;
                    break;
                case "parse-error":
                    skippedParseFailed++;
                    break;
                }
            }
        }
        const totalSkillsFound = files.filter(f => f.status === "loaded" && f.promptPath.name).length;
        this.telemetryService.publicLog2("agentSkillsFound", {
            totalSkillsFound,
            claudePersonal: skillsBySource.get(PromptFileSource.ClaudePersonal) ?? 0,
            claudeWorkspace: skillsBySource.get(PromptFileSource.ClaudeWorkspace) ?? 0,
            copilotPersonal: skillsBySource.get(PromptFileSource.CopilotPersonal) ?? 0,
            githubWorkspace: skillsBySource.get(PromptFileSource.GitHubWorkspace) ?? 0,
            agentsPersonal: skillsBySource.get(PromptFileSource.AgentsPersonal) ?? 0,
            agentsWorkspace: skillsBySource.get(PromptFileSource.AgentsWorkspace) ?? 0,
            configWorkspace: skillsBySource.get(PromptFileSource.ConfigWorkspace) ?? 0,
            configPersonal: skillsBySource.get(PromptFileSource.ConfigPersonal) ?? 0,
            extensionContribution: skillsBySource.get(PromptFileSource.ExtensionContribution) ?? 0,
            extensionAPI: skillsBySource.get(PromptFileSource.ExtensionAPI) ?? 0,
            plugin: skillsBySource.get(PromptFileSource.Plugin) ?? 0,
            skippedDuplicateName,
            skippedMissingName,
            skippedMissingDescription,
            skippedNameMismatch,
            skippedParseFailed
        });
        return {
            type: PromptsType.skill,
            files,
            sourceFolders,
            durationInMillis: stopWatch.elapsed()
        };
    }
    async getHooks(token) {
        const discoveryInfo = await this.cachedHooks.get(token);
        const result = discoveryInfo.hooksInfo;
        return result;
    }
    async getDiscoveryInfo(type, token) {
        switch (type) {
        case PromptsType.instructions:
            return this.cachedInstructions.get(token);
        case PromptsType.prompt:
            return this.cachedSlashCommands.get(token);
        case PromptsType.agent:
            return this.cachedCustomAgents.get(token);
        case PromptsType.skill:
            return this.cachedSkills.get(token);
        case PromptsType.hook:
            return this.cachedHooks.get(token);
        }
    }
    async getInstructionFiles(token) {
        const discoveryInfo = await this.cachedInstructions.get(token);
        const result = this.instructionsFromDiscoveryInfo(discoveryInfo);
        return result;
    }
    instructionsFromDiscoveryInfo(discoveryInfo) {
        const result = [];
        for (const file of discoveryInfo.files) {
            if (file.status === "loaded" && file.promptPath.name) {
                result.push({
                    uri: file.promptPath.uri,
                    storage: file.promptPath.storage,
                    extension: file.promptPath.extension,
                    pluginUri: file.promptPath.pluginUri,
                    source: file.promptPath.source,
                    name: file.promptPath.name,
                    description: file.promptPath.description,
                    pattern: file.pattern,
                    sessionTypes: file.promptPath.sessionTypes
                });
            }
        }
        return result;
    }
    withPromptPathMetadata(promptPath, name, description) {
        return {
            ...promptPath,
            name,
            description
        };
    }
    async computeInstructionFiles(token) {
        return await this.getInstructionsDiscoveryInfo(token);
    }
    async computeHooks(token) {
        const stopWatch = StopWatch.create(true);
        const useChatHooks = this.configurationService.getValue(PromptsConfig.USE_CHAT_HOOKS);
        if (!useChatHooks || !this.workspaceTrustService.isWorkspaceTrusted()) {
            const hookFiles = await this.listPromptFiles(PromptsType.hook, token);
            const skipReason = !useChatHooks ? "disabled" : "workspace-untrusted";
            const files = ( hookFiles.map(promptPath => ({
                status: "skipped",
                skipReason,
                promptPath: this.withPromptPathMetadata(promptPath, basename(promptPath.uri), promptPath.description)
            })));
            const sourceFolders = await this._collectSourceFolderDiagnostics(PromptsType.hook);
            return {
                type: PromptsType.hook,
                files,
                sourceFolders,
                hooksInfo: undefined,
                durationInMillis: stopWatch.elapsed()
            };
        }
        const useClaudeHooks = this.configurationService.getValue(PromptsConfig.USE_CLAUDE_HOOKS);
        const hookFiles = await this.listPromptFiles(PromptsType.hook, token);
        this.logger.trace(`[PromptsService] Found ${hookFiles.length} hook file(s).`);
        const userHomeUri = await this.pathService.userHome();
        const userHome = userHomeUri.scheme === Schemas.file ? userHomeUri.fsPath : userHomeUri.path;
        const defaultFolder = this.workspaceService.getWorkspace().folders[0];
        const fileResults = await Promise.all(( hookFiles.map(async hookFile => {
            const name = basename(hookFile.uri);
            if (hookFile.storage === PromptsStorage.plugin) {
                return {
                    file: {
                        status: "loaded",
                        promptPath: this.withPromptPathMetadata(hookFile, name, hookFile.description)
                    }
                };
            }
            try {
                const content = await this.fileService.readFile(hookFile.uri);
                const parseErrors = [];
                const json = parse(( content.value.toString()), parseErrors);
                if (parseErrors.length > 0) {
                    const first = parseErrors[0];
                    const message = getParseErrorMessage(first.error) || "Invalid JSON";
                    return {
                        file: {
                            status: "skipped",
                            skipReason: "parse-error",
                            errorMessage: `${message} at offset ${first.offset}`,
                            promptPath: this.withPromptPathMetadata(hookFile, name, hookFile.description)
                        }
                    };
                }
                if (!json || typeof json !== "object") {
                    return {
                        file: {
                            status: "skipped",
                            skipReason: "parse-error",
                            errorMessage: "Invalid hooks file: must be a JSON object",
                            promptPath: this.withPromptPathMetadata(hookFile, name, hookFile.description)
                        }
                    };
                }
                const hookWorkspaceFolder = this.workspaceService.getWorkspaceFolder(hookFile.uri) ?? defaultFolder;
                const workspaceRootUri = hookWorkspaceFolder?.uri;
                const {
                    format,
                    hooks: parsedHooks,
                    disabledAllHooks
                } = parseHooksFromFile(hookFile.uri, json, workspaceRootUri, userHome);
                if (disabledAllHooks) {
                    this.logger.trace(
                        `[PromptsService] Skipping hook file with disableAllHooks: ${hookFile.uri}`
                    );
                    return {
                        file: {
                            status: "skipped",
                            skipReason: "all-hooks-disabled",
                            promptPath: this.withPromptPathMetadata(hookFile, name, hookFile.description)
                        }
                    };
                }
                if (format === HookSourceFormat.Claude && useClaudeHooks === false) {
                    const hasAnyCommands = ( [...( parsedHooks.values())].some((
                        {
                            hooks: cmds
                        }
                    ) => cmds.length > 0));
                    this.logger.trace(
                        `[PromptsService] Skipping Claude hook file (disabled via setting): ${hookFile.uri}`
                    );
                    return {
                        file: {
                            status: "skipped",
                            skipReason: "claude-hooks-disabled",
                            promptPath: this.withPromptPathMetadata(hookFile, name, hookFile.description)
                        },
                        hasDisabledClaudeHooks: hasAnyCommands
                    };
                }
                const hooks = ( new Map());
                for (const [hookType, {
                    hooks: commands
                }] of parsedHooks) {
                    for (const command of commands) {
                        let bucket = hooks.get(hookType);
                        if (!bucket) {
                            bucket = [];
                            hooks.set(hookType, bucket);
                        }
                        bucket.push(command);
                        this.logger.trace(
                            `[PromptsService] Collected ${hookType} hook from ${hookFile.uri} (format: ${format})`
                        );
                    }
                }
                return {
                    file: {
                        status: "loaded",
                        promptPath: this.withPromptPathMetadata(hookFile, name, hookFile.description)
                    },
                    hooks,
                    sourceUri: hookFile.uri
                };
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                this.logger.warn(`[PromptsService] Failed to parse hook file: ${hookFile.uri}`, error);
                return {
                    file: {
                        status: "skipped",
                        skipReason: "parse-error",
                        errorMessage: msg,
                        promptPath: this.withPromptPathMetadata(hookFile, name, hookFile.description)
                    }
                };
            }
        })));
        const files = [];
        let hasDisabledClaudeHooks = false;
        const collectedHooks = ( new Map());
        for (const {
            file,
            hooks,
            sourceUri,
            hasDisabledClaudeHooks: disabled
        } of fileResults) {
            if (file) {
                files.push(file);
            }
            if (disabled) {
                hasDisabledClaudeHooks = true;
            }
            if (hooks && sourceUri) {
                for (const [hookType, commands] of hooks) {
                    let bucket = collectedHooks.get(hookType);
                    if (!bucket) {
                        bucket = [];
                        collectedHooks.set(hookType, bucket);
                    }
                    for (const command of commands) {
                        bucket.push({
                            ...command,
                            sourceUri
                        });
                    }
                }
            }
        }
        const plugins = this.agentPluginService.plugins.get();
        for (const plugin of plugins) {
            if (!isContributionEnabled(plugin.enablement.get())) {
                continue;
            }
            for (const hook of plugin.hooks.get()) {
                let bucket = collectedHooks.get(hook.type);
                if (!bucket) {
                    bucket = [];
                    collectedHooks.set(hook.type, bucket);
                }
                for (const command of hook.hooks) {
                    bucket.push({
                        ...command,
                        sourceUri: hook.uri
                    });
                }
            }
        }
        const sourceFolders = await this._collectSourceFolderDiagnostics(PromptsType.hook);
        if (collectedHooks.size === 0) {
            this.logger.trace("[PromptsService] No valid hooks collected.");
            return {
                type: PromptsType.hook,
                files,
                sourceFolders,
                hooksInfo: undefined,
                durationInMillis: stopWatch.elapsed()
            };
        }
        const result = Object.fromEntries(collectedHooks);
        this.logger.trace(`[PromptsService] Collected hooks: ${JSON.stringify(( Object.keys(result)))}`);
        return {
            type: PromptsType.hook,
            files,
            sourceFolders,
            hooksInfo: {
                hooks: result,
                hasDisabledClaudeHooks
            },
            durationInMillis: stopWatch.elapsed()
        };
    }
    getSkillPriority(skill) {
        if (skill.storage === PromptsStorage.local) {
            return 0;
        }
        if (skill.storage === PromptsStorage.user) {
            return 1;
        }
        if (skill.storage === PromptsStorage.plugin) {
            return 2;
        }
        if (skill.source === PromptFileSource.ExtensionAPI) {
            return 3;
        }
        if (skill.source === PromptFileSource.ExtensionContribution) {
            return 4;
        }
        return 5;
    }
    async computeSkillDiscoveryInfo(token) {
        const files = [];
        const seenNames = ( new Set());
        const nameToUri = ( new Map());
        const allSkills = [];
        const discoveredSkills = await this.fileLocator.findAgentSkills(token);
        const extensionSkills = await this.getExtensionPromptFiles(PromptsType.skill, token);
        const pluginSkills = this._pluginPromptFilesByType.get(PromptsType.skill) ?? [];
        allSkills.push(...discoveredSkills, ...extensionSkills, ...pluginSkills);
        allSkills.sort((a, b) => this.getSkillPriority(a) - this.getSkillPriority(b));
        for (const skill of allSkills) {
            const uri = skill.uri;
            const promptPath = skill;
            try {
                const parsedFile = await this.parseNew(uri, token);
                const folderName = getSkillFolderName(uri);
                let name = parsedFile.header?.name;
                const description = parsedFile.header?.description;
                if (!name) {
                    this.logger.debug(
                        `[computeSkillDiscoveryInfo] Agent skill file missing name attribute, using folder name "${folderName}": ${uri}`
                    );
                    name = folderName;
                }
                let sanitizedName = this.truncateAgentSkillName(name, uri);
                if (sanitizedName !== folderName) {
                    this.logger.debug(
                        `[computeSkillDiscoveryInfo] Agent skill name "${sanitizedName}" does not match folder name "${folderName}", using folder name: ${uri}`
                    );
                    sanitizedName = folderName;
                }
                if (( seenNames.has(sanitizedName))) {
                    this.logger.debug(
                        `[computeSkillDiscoveryInfo] Skipping duplicate agent skill name: ${sanitizedName} at ${uri}`
                    );
                    files.push({
                        status: "skipped",
                        skipReason: "duplicate-name",
                        duplicateOf: nameToUri.get(sanitizedName),
                        promptPath: this.withPromptPathMetadata(promptPath, sanitizedName, description)
                    });
                    continue;
                }
                seenNames.add(sanitizedName);
                nameToUri.set(sanitizedName, uri);
                const disableModelInvocation = parsedFile.header?.disableModelInvocation === true;
                const userInvocable = parsedFile.header?.userInvocable !== false;
                files.push({
                    status: "loaded",
                    promptPath: this.withPromptPathMetadata(promptPath, sanitizedName, description),
                    disableModelInvocation,
                    userInvocable
                });
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                this.logger.error(
                    `[computeSkillDiscoveryInfo] Failed to validate Agent skill file: ${uri}`,
                    msg
                );
                files.push({
                    status: "skipped",
                    skipReason: "parse-error",
                    errorMessage: msg,
                    promptPath
                });
            }
        }
        return files;
    }
    async getInstructionsDiscoveryInfo(token) {
        const stopWatch = StopWatch.create(true);
        const files = [];
        const instructionsFiles = await this.listPromptFiles(PromptsType.instructions, token);
        for (const promptPath of instructionsFiles) {
            const uri = promptPath.uri;
            try {
                const parsedPromptFile = await this.parseNew(uri, token);
                const name = parsedPromptFile?.header?.name ?? promptPath.name ?? getCleanPromptName(uri);
                const description = parsedPromptFile?.header?.description ?? promptPath.description;
                const pattern = evaluateApplyToPattern(parsedPromptFile.header, isInClaudeRulesFolder(uri));
                files.push({
                    status: "loaded",
                    pattern,
                    promptPath: this.withPromptPathMetadata(promptPath, name, description)
                });
            } catch (e) {
                files.push({
                    status: "skipped",
                    skipReason: "parse-error",
                    errorMessage: e instanceof Error ? e.message : String(e),
                    promptPath
                });
            }
        }
        const sourceFolders = await this._collectSourceFolderDiagnostics(PromptsType.instructions);
        return {
            type: PromptsType.instructions,
            files,
            sourceFolders,
            durationInMillis: stopWatch.elapsed()
        };
    }
};
PromptsService = ( __decorate([( __param(0, ILogService)), ( __param(1, ILabelService)), ( __param(2, IModelService)), ( __param(3, IInstantiationService)), ( __param(4, IUserDataProfileService)), ( __param(5, IConfigurationService)), ( __param(6, IFileService)), ( __param(7, IStorageService)), ( __param(8, ITelemetryService)), ( __param(9, IWorkspaceContextService)), ( __param(10, IPathService)), ( __param(11, IAgentPluginService)), ( __param(12, IWorkspaceTrustManagementService))], PromptsService));
class CachedPromise extends Disposable {
    constructor(computeFn, getEvent, delay = 0) {
        super();
        this.computeFn = computeFn;
        this.getEvent = getEvent;
        this.delay = delay;
        this.cachedPromise = undefined;
        this.cachedPool = undefined;
        this.onDidUpdatePromiseEmitter = this._register(( new Emitter()));
        const delayer = this._register(( new Delayer(this.delay)));
        this._register(this.getEvent()(() => {
            this.cachedPromise = undefined;
            delayer.trigger(() => this.onDidUpdatePromiseEmitter.fire());
        }));
    }
    get onDidChangePromise() {
        return this.onDidUpdatePromiseEmitter.event;
    }
    get(token) {
        if (this.cachedPool?.token.isCancellationRequested) {
            this.cachedPromise = undefined;
            this.cachedPool = undefined;
        }
        let pool = this.cachedPool;
        if (this.cachedPromise === undefined) {
            pool = ( new CancellationTokenPool());
            const promise = this.computeFn(pool.token).catch(err => {
                if (this.cachedPromise === promise) {
                    this.cachedPromise = undefined;
                }
                throw err;
            });
            promise.finally(() => {
                if (this.cachedPool === pool) {
                    this.cachedPool = undefined;
                }
                pool.dispose();
            });
            this.cachedPromise = promise;
            this.cachedPool = pool;
        }
        pool?.add(token);
        return raceCancellationError(this.cachedPromise, token);
    }
    refresh() {
        this.cachedPromise = undefined;
        this.onDidUpdatePromiseEmitter?.fire();
    }
}
class ModelChangeTracker extends Disposable {
    get onDidPromptChange() {
        return this.onDidPromptModelChange.event;
    }
    constructor(modelService) {
        super();
        this.listeners = ( new ResourceMap());
        this.onDidPromptModelChange = this._register(( new Emitter()));
        const onAdd = model => {
            const promptType = getPromptsTypeForLanguageId(model.getLanguageId());
            if (promptType !== undefined) {
                this.listeners.set(
                    model.uri,
                    model.onDidChangeContent(() => this.onDidPromptModelChange.fire({
                        uri: model.uri,
                        promptType
                    }))
                );
            }
            return promptType;
        };
        const onRemove = (languageId, uri) => {
            const promptType = getPromptsTypeForLanguageId(languageId);
            if (promptType !== undefined) {
                this.listeners.get(uri)?.dispose();
                this.listeners.delete(uri);
            }
            return promptType;
        };
        this._register(modelService.onModelAdded(model => onAdd(model)));
        this._register(modelService.onModelLanguageChanged(e => {
            const removedPromptType = onRemove(e.oldLanguageId, e.model.uri);
            const addedPromptType = onAdd(e.model);
            if (removedPromptType !== addedPromptType) {
                if (removedPromptType) {
                    this.onDidPromptModelChange.fire({
                        uri: e.model.uri,
                        promptType: removedPromptType
                    });
                }
                if (addedPromptType) {
                    this.onDidPromptModelChange.fire({
                        uri: e.model.uri,
                        promptType: addedPromptType
                    });
                }
            }
        }));
        this._register(
            modelService.onModelRemoved(model => onRemove(model.getLanguageId(), model.uri))
        );
    }
    dispose() {
        super.dispose();
        this.listeners.forEach(listener => listener.dispose());
        this.listeners.clear();
    }
}
var CustomAgent;
(function(CustomAgent) {
    function fromParsedPromptFile(ast, extra) {
        const uri = ast.uri;
        const {
            hooks,
            sessionTypes,
            enabled
        } = extra;
        let metadata;
        if (ast.header) {
            const advanced = ast.header.getAttribute(PromptHeaderAttributes.advancedOptions);
            if (advanced && advanced.value.type === "map") {
                metadata = {};
                for (const [key, value] of Object.entries(advanced.value)) {
                    if (value.type === "scalar") {
                        metadata[key] = value;
                    }
                }
            }
        }
        const toolReferences = [];
        if (ast.body) {
            const bodyOffset = ast.body.offset;
            const bodyVarRefs = ast.body.variableReferences;
            for (let i = bodyVarRefs.length - 1; i >= 0; i--) {
                const {
                    name,
                    offset,
                    fullLength
                } = bodyVarRefs[i];
                const range = ( new OffsetRange(offset - bodyOffset, offset - bodyOffset + fullLength));
                toolReferences.push({
                    name,
                    range
                });
            }
        }
        const agentInstructions = {
            content: ast.body?.getContent() ?? "",
            toolReferences,
            metadata
        };
        const name = ast.header?.name ?? extra.name ?? getCleanPromptName(uri);
        const description = ast.header?.description ?? extra.description;
        const target = getTarget(PromptsType.agent, ast.header ?? uri);
        const id = ( uri.toString());
        const source = extra.source;
        if (!ast.header) {
            return {
                id,
                uri,
                name,
                agentInstructions,
                source,
                target,
                visibility: {
                    userInvocable: true,
                    agentInvocable: true
                },
                sessionTypes,
                hooks,
                enabled
            };
        }
        const visibility = {
            userInvocable: ast.header.userInvocable !== false,
            agentInvocable: ast.header.infer !== undefined ? ast.header.infer === true : ast.header.disableModelInvocation !== true
        };
        let model = ast.header.model;
        if (target === Target.Claude && model) {
            model = mapClaudeModels(model);
        }
        let {
            tools,
            handOffs,
            argumentHint,
            agents
        } = ast.header;
        if (target === Target.Claude && tools) {
            tools = mapClaudeTools(tools);
        }
        return {
            id,
            uri,
            name,
            description,
            model,
            tools,
            handOffs,
            argumentHint,
            target,
            visibility,
            agents,
            agentInstructions,
            source,
            sessionTypes,
            hooks,
            enabled
        };
    }
    CustomAgent.fromParsedPromptFile = fromParsedPromptFile;
})(CustomAgent || (CustomAgent = {}));

export { CustomAgent, PromptsService };
