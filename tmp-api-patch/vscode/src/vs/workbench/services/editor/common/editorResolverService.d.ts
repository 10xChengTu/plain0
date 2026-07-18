import * as glob from "../../../../base/common/glob.js";
import { URI } from "../../../../base/common/uri.js";
import { IResourceEditorInput, ITextResourceEditorInput } from "../../../../platform/editor/common/editor.js";
import { EditorInputWithOptions, EditorInputWithOptionsAndGroup, IResourceDiffEditorInput, IResourceMultiDiffEditorInput, IResourceMergeEditorInput, IUntitledTextResourceEditorInput } from "../../../common/editor.js";
import { IEditorGroup } from "./editorGroupsService.js";
import { AtLeastOne } from "../../../../base/common/types.js";
export type EditorAssociation = {
    readonly viewType: string;
    readonly filenamePattern?: string;
};
export type EditorAssociations = readonly EditorAssociation[];
export declare const editorsAssociationsSettingId = "workbench.editorAssociations";
export declare const diffEditorsAssociationsSettingId = "workbench.diffEditorAssociations";
/**
 * Setting that controls whether the Markdown editor is the default editor for
 * `*.md` files in the Agents window. Gated behind an experiment so it can be
 * rolled out gradually. Defaults to off.
 */
export declare const markdownDefaultEditorAgentsWindowSettingId = "workbench.editor.markdownDefaultEditorInAgentsWindow";
/**
 * Builds the default value for `workbench.editorAssociations` in the Agents window.
 * Shared so that dynamic re-registrations of the setting preserve the override.
 *
 * Each editor association can be toggled independently. Passing `undefined`
 * leaves the association at its enabled default, so the static registration
 * ends up with all defaults registered. Pass `false` to fall back to the
 * markdown preview editor for `*.md` files.
 */
export declare function editorsAssociationsAgentsWindowDefault(options?: {
    markdownDefaultEditor?: boolean;
}): Record<string, string>;
export interface IEditorType {
    readonly id: string;
    readonly displayName: string;
    readonly providerDisplayName: string;
}
export declare enum RegisteredEditorPriority {
    builtin = "builtin",
    option = "option",
    exclusive = "exclusive",
    default = "default"
}
/**
 * If we didn't resolve an editor dictates what to do with the opening state
 * ABORT = Do not continue with opening the editor
 * NONE = Continue as if the resolution has been disabled as the service could not resolve one
 */
export declare enum ResolvedStatus {
    ABORT = 1,
    NONE = 2
}
export type ResolvedEditor = EditorInputWithOptionsAndGroup | ResolvedStatus;
export type RegisteredEditorOptions = {
    /**
     * If your editor cannot be opened in multiple groups for the same resource
     */
    singlePerResource?: boolean | (() => boolean);
    /**
     * Whether or not you can support opening the given resource.
     * If omitted we assume you can open everything
     */
    canSupportResource?: (resource: URI) => boolean;
};
export type RegisteredEditorPriorityInfo = {
    readonly editor: RegisteredEditorPriority;
    readonly diff: RegisteredEditorPriority;
    readonly merge: RegisteredEditorPriority;
};
export type RegisteredEditorInfo = {
    readonly id: string;
    readonly label: string;
    readonly detail?: string;
    readonly priority: RegisteredEditorPriorityInfo;
};
export type RegisteredEditorRegistrationInfo = Omit<RegisteredEditorInfo, "priority"> & {
    readonly priority: RegisteredEditorPriority | RegisteredEditorPriorityInfo;
};
export declare function toRegisteredEditorPriorityInfo(priority: RegisteredEditorPriority | RegisteredEditorPriorityInfo): RegisteredEditorPriorityInfo;
type EditorInputFactoryResult = EditorInputWithOptions | Promise<EditorInputWithOptions>;
export type EditorInputFactoryFunction = (editorInput: IResourceEditorInput | ITextResourceEditorInput, group: IEditorGroup) => EditorInputFactoryResult;
export type UntitledEditorInputFactoryFunction = (untitledEditorInput: IUntitledTextResourceEditorInput, group: IEditorGroup) => EditorInputFactoryResult;
export type DiffEditorInputFactoryFunction = (diffEditorInput: IResourceDiffEditorInput, group: IEditorGroup) => EditorInputFactoryResult;
export type MultiDiffEditorInputFactoryFunction = (multiDiffEditorInput: IResourceMultiDiffEditorInput, group: IEditorGroup) => EditorInputFactoryResult;
export type MergeEditorInputFactoryFunction = (mergeEditorInput: IResourceMergeEditorInput, group: IEditorGroup) => EditorInputFactoryResult;
type EditorInputFactories = {
    createEditorInput?: EditorInputFactoryFunction;
    createUntitledEditorInput?: UntitledEditorInputFactoryFunction;
    createDiffEditorInput?: DiffEditorInputFactoryFunction;
    createMultiDiffEditorInput?: MultiDiffEditorInputFactoryFunction;
    createMergeEditorInput?: MergeEditorInputFactoryFunction;
};
export type EditorInputFactoryObject = AtLeastOne<EditorInputFactories>;
export declare function priorityToRank(priority: RegisteredEditorPriority): number;
export declare function globMatchesResource(globPattern: string | glob.IRelativePattern, resource: URI): boolean;
export {};
