import { EditSuggestionId } from "../../../../../../editor/common/textModelEditSource.js";
import { IInstantiationService } from "../../../../../../platform/instantiation/common/instantiation.js";
import { IEditTelemetryCodeAcceptedData, IEditTelemetryCodeRejectedData, IEditTelemetryCodeSuggestedData } from "./aiEditTelemetryService.js";
import { IAiEditTelemetryService } from "./aiEditTelemetryService.service.js";
import { IRandomService } from "../../randomService.service.js";
export declare class AiEditTelemetryServiceImpl implements IAiEditTelemetryService {
    private readonly instantiationService;
    private readonly _randomService;
    readonly _serviceBrand: undefined;
    private readonly _telemetryService;
    constructor(instantiationService: IInstantiationService, _randomService: IRandomService);
    createSuggestionId(data: Omit<IEditTelemetryCodeSuggestedData, "suggestionId">): EditSuggestionId;
    handleCodeAccepted(data: IEditTelemetryCodeAcceptedData): void;
    handleCodeRejected(data: IEditTelemetryCodeRejectedData): void;
}
