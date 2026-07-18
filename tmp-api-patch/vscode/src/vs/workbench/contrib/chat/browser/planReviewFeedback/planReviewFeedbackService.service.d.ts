import { Event } from "../../../../../base/common/event.js";
import { IDisposable } from "../../../../../base/common/lifecycle.js";
import { URI } from "../../../../../base/common/uri.js";
import { IChatPlanReviewResult } from "../../common/chatService/chatService.js";
import { IPlanReviewFeedbackItem } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/workbench/contrib/chat/browser/planReviewFeedback/planReviewFeedbackService";
export declare const IPlanReviewFeedbackService: import("../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IPlanReviewFeedbackService>;
export interface IPlanReviewFeedbackService {
    readonly _serviceBrand: undefined;
    readonly onDidChangeFeedback: Event<URI>;
    readonly onDidChangeNavigation: Event<URI>;
    readonly onDidChangeRegistrations: Event<void>;
    registerPlanReview(planUri: URI, onSubmit: (result: IChatPlanReviewResult) => void): IDisposable;
    isActivePlanReview(uri: URI): boolean;
    addFeedback(planUri: URI, line: number, column: number, text: string): string;
    removeFeedback(planUri: URI, feedbackId: string): void;
    updateFeedback(planUri: URI, feedbackId: string, newText: string): void;
    getFeedback(planUri: URI): readonly IPlanReviewFeedbackItem[];
    clearFeedback(planUri: URI): void;
    getNextFeedback(planUri: URI, next: boolean): IPlanReviewFeedbackItem | undefined;
    getNavigationBearing(planUri: URI): {
        activeIdx: number;
        totalCount: number;
    };
    setNavigationAnchor(planUri: URI, itemId: string | undefined): void;
    submitAllFeedback(planUri: URI): void;
}
