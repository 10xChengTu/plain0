import { CancellationToken } from "../../../../../../base/common/cancellation.js";
import { Event } from "../../../../../../base/common/event.js";
import { Disposable, IDisposable } from "../../../../../../base/common/lifecycle.js";
import { URI } from "../../../../../../base/common/uri.js";
import { IModelService } from "../../../../../../editor/common/services/model.service.js";
import { IContextKeyService } from "../../../../../../platform/contextkey/common/contextkey.service.js";
import { IExtensionDescription } from "../../../../../../platform/extensions/common/extensions.js";
import { IFileService } from "../../../../../../platform/files/common/files.service.js";
import { ILogService } from "../../../../../../platform/log/common/log.service.js";
import { IExtensionService } from "../../../../../services/extensions/common/extensions.service.js";
import { IFilesConfigurationService } from "../../../../../services/filesConfiguration/common/filesConfigurationService.service.js";
import { PromptsType } from "../promptTypes.js";
import { IExtensionPromptPath, IPromptFileContext, IPromptFileResource } from "./promptsService.js";
/**
 * Event payload emitted by {@link ExtensionPromptFileService.onDidChange}.
 */
export interface IExtensionPromptFilesChangeEvent {
    readonly type: PromptsType;
}
/**
 * Owns the registry of prompt files contributed by extensions, both via
 * static contribution points (see {@link registerContributedFile}) and via
 * dynamic providers registered through the proposed extension API (see
 * {@link registerPromptFileProvider}).
 *
 * Exposes a per-type getter ({@link getExtensionPromptFiles}) that merges
 * both sources and applies any `when` clauses, plus a single change event
 * ({@link onDidChange}) carrying the affected {@link PromptsType}.
 */
export declare class ExtensionPromptFileService extends Disposable {
    private readonly logger;
    private readonly fileService;
    private readonly modelService;
    private readonly extensionService;
    private readonly filesConfigService;
    private readonly contextKeyService;
    /**
     * Files contributed via extension contribution points, keyed by type then URI.
     */
    private readonly contributedFiles;
    /**
     * Providers registered via the proposed extension API.
     */
    private readonly _promptFileProviders;
    /**
     * Context keys referenced by tracked `when` clauses (from contributed
     * files and provider results). Used to know when to re-evaluate.
     */
    private readonly _contributedWhenKeys;
    private readonly _contributedWhenClauses;
    private readonly _providerWhenClauses;
    private readonly _onDidChange;
    readonly onDidChange: Event<IExtensionPromptFilesChangeEvent>;
    /**
     * Pending URIs to mark as readonly, flushed on the next microtask.
     * Batches multiple `registerContributedFile` calls (which happen
     * synchronously in the extension point handler) into a single
     * `updateReadonly` call to avoid firing `onDidChangeReadonly` per file.
     */
    private _pendingReadonlyUris;
    private _pendingReadonlyFlush;
    constructor(logger: ILogService, fileService: IFileService, modelService: IModelService, extensionService: IExtensionService, filesConfigService: IFilesConfigurationService, contextKeyService: IContextKeyService);
    /**
     * Returns the merged list of extension-contributed prompt files for the
     * given type, filtered by their `when` clause.
     */
    getExtensionPromptFiles(type: PromptsType, token: CancellationToken): Promise<readonly IExtensionPromptPath[]>;
    /**
     * Registers a file contributed via a static contribution point. Returns
     * a disposable that removes the contribution.
     */
    registerContributedFile(type: PromptsType, uri: URI, extension: IExtensionDescription, name?: string, description?: string, when?: string, sessionTypes?: readonly string[]): IDisposable;
    /**
     * Registers a prompt file provider (CustomAgentProvider, InstructionsProvider, or PromptFileProvider).
     * This is called by the extension host bridge when an extension registers a provider via
     * vscode.chat.registerCustomAgentProvider(), registerInstructionsProvider(), or
     * registerPromptFileProvider().
     */
    registerPromptFileProvider(extension: IExtensionDescription, type: PromptsType, provider: {
        onDidChangePromptFiles?: Event<void>;
        providePromptFiles: (context: IPromptFileContext, token: CancellationToken) => Promise<IPromptFileResource[] | undefined>;
    }): IDisposable;
    private _listFromProviders;
    private _getProviderActivationEvent;
    private _enqueueReadonlyUpdate;
    private _updateContributedWhenKeys;
    private _validateAndSanitizeSkillFile;
    private _parsePromptFile;
    private _sanitizeAgentSkillText;
    private _truncateAgentSkillName;
    private _truncateAgentSkillDescription;
}
