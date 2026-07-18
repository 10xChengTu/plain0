import { EditSuggestionId } from "../../../../../../editor/common/textModelEditSource.js";
import { IEditTelemetryCodeSuggestedData, IEditTelemetryCodeAcceptedData, IEditTelemetryCodeRejectedData } from "./aiEditTelemetryService.js";
export declare const IAiEditTelemetryService: import("../../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IAiEditTelemetryService>;
export interface IAiEditTelemetryService {
    readonly _serviceBrand: undefined;
    createSuggestionId(data: Omit<IEditTelemetryCodeSuggestedData, "suggestionId">): EditSuggestionId;
    handleCodeAccepted(data: IEditTelemetryCodeAcceptedData): void;
    handleCodeRejected(data: IEditTelemetryCodeRejectedData): void;
}
