import { CancellationToken } from "../../../../../base/common/cancellation.js";
import { IToolData } from "../../common/tools/languageModelToolsService.js";
import { ToolRiskPromptKind, IToolRiskAssessment } from "@codingame/monaco-vscode-katex-common/vscode/vs/workbench/contrib/chat/browser/tools/chatToolRiskAssessmentService";
export declare const IChatToolRiskAssessmentService: import("../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IChatToolRiskAssessmentService>;
export interface IChatToolRiskAssessmentService {
    readonly _serviceBrand: undefined;
    /** Returns whether the feature is enabled by configuration. */
    isEnabled(): boolean;
    /** Synchronously read a previously cached assessment, or undefined if none. */
    getCached(tool: IToolData, parameters: unknown, kind?: ToolRiskPromptKind): IToolRiskAssessment | undefined;
    /**
    * Get a cached or freshly-computed risk assessment for a tool call. Returns `undefined` when no
    * model is available or the assessment cannot be parsed, or when the feature is disabled unless
    * `options.ignoreEnablement` is set (used by the Autopilot risk gate).
    */
    assess(tool: IToolData, parameters: unknown, token: CancellationToken, kind?: ToolRiskPromptKind, options?: {
        ignoreEnablement?: boolean;
    }): Promise<IToolRiskAssessment | undefined>;
}
