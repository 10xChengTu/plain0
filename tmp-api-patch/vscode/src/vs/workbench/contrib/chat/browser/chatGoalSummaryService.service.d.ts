import { CancellationToken } from "../../../../base/common/cancellation.js";
export declare const IChatGoalSummaryService: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IChatGoalSummaryService>;
export interface IChatGoalSummaryService {
    readonly _serviceBrand: undefined;
    /**
    * Returns a short (one-phrase) summary of the user's prompt suitable for display
    * as a "Goal: <summary>" banner above the chat input. Returns `undefined` when
    * no model is available, the model declines to summarize, or the summary cannot
    * be produced.
    */
    summarize(prompt: string, token: CancellationToken): Promise<string | undefined>;
}
