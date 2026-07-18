
import { __decorate, __param } from '../../../../../../../../../external/tslib/tslib.es6.js';
import { EditSuggestionId } from '../../../../../../editor/common/textModelEditSource.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { escapeModelIdForTelemetry } from '../../../../../../platform/telemetry/common/telemetry.js';
import { DataChannelForwardingTelemetryService, forwardToChannelIf, isCopilotLikeExtension } from '../../../../../../platform/dataChannel/browser/forwardingTelemetryService.js';
import { IRandomService } from '../../randomService.service.js';

let AiEditTelemetryServiceImpl = class AiEditTelemetryServiceImpl {
    constructor(instantiationService, _randomService) {
        this.instantiationService = instantiationService;
        this._randomService = _randomService;
        this._telemetryService = this.instantiationService.createInstance(DataChannelForwardingTelemetryService);
    }
    createSuggestionId(data) {
        const suggestionId = EditSuggestionId.newId(ns => this._randomService.generatePrefixedUuid(ns));
        this._telemetryService.publicLog2("editTelemetry.codeSuggested", {
            eventId: this._randomService.generatePrefixedUuid("evt"),
            suggestionId: suggestionId,
            presentation: data.presentation,
            feature: data.feature,
            sourceExtensionId: data.source?.extensionId,
            sourceExtensionVersion: data.source?.extensionVersion,
            sourceProviderId: data.source?.providerId,
            languageId: data.languageId,
            editCharsInserted: data.editDeltaInfo?.charsAdded,
            editCharsDeleted: data.editDeltaInfo?.charsRemoved,
            editLinesInserted: data.editDeltaInfo?.linesAdded,
            editLinesDeleted: data.editDeltaInfo?.linesRemoved,
            modeId: data.modeId,
            modelId: escapeModelIdForTelemetry(data.modelId),
            applyCodeBlockSuggestionId: data.applyCodeBlockSuggestionId,
            sourceRequestId: data.sourceRequestId,
            ...forwardToChannelIf(isCopilotLikeExtension(data.source?.extensionId))
        });
        return suggestionId;
    }
    handleCodeAccepted(data) {
        this._telemetryService.publicLog2("editTelemetry.codeAccepted", {
            eventId: this._randomService.generatePrefixedUuid("evt"),
            suggestionId: data.suggestionId,
            presentation: data.presentation,
            feature: data.feature,
            sourceExtensionId: data.source?.extensionId,
            sourceExtensionVersion: data.source?.extensionVersion,
            sourceProviderId: data.source?.providerId,
            languageId: data.languageId,
            editCharsInserted: data.editDeltaInfo?.charsAdded,
            editCharsDeleted: data.editDeltaInfo?.charsRemoved,
            editLinesInserted: data.editDeltaInfo?.linesAdded,
            editLinesDeleted: data.editDeltaInfo?.linesRemoved,
            modeId: data.modeId,
            modelId: escapeModelIdForTelemetry(data.modelId),
            applyCodeBlockSuggestionId: data.applyCodeBlockSuggestionId,
            sourceRequestId: data.sourceRequestId,
            acceptanceMethod: data.acceptanceMethod,
            ...forwardToChannelIf(isCopilotLikeExtension(data.source?.extensionId))
        });
    }
    handleCodeRejected(data) {
        this._telemetryService.publicLog2("editTelemetry.codeRejected", {
            eventId: this._randomService.generatePrefixedUuid("evt"),
            suggestionId: data.suggestionId,
            presentation: data.presentation,
            feature: data.feature,
            sourceExtensionId: data.source?.extensionId,
            sourceExtensionVersion: data.source?.extensionVersion,
            sourceProviderId: data.source?.providerId,
            languageId: data.languageId,
            editCharsInserted: data.editDeltaInfo?.charsAdded,
            editCharsDeleted: data.editDeltaInfo?.charsRemoved,
            editLinesInserted: data.editDeltaInfo?.linesAdded,
            editLinesDeleted: data.editDeltaInfo?.linesRemoved,
            modeId: data.modeId,
            modelId: escapeModelIdForTelemetry(data.modelId),
            applyCodeBlockSuggestionId: data.applyCodeBlockSuggestionId,
            sourceRequestId: data.sourceRequestId,
            rejectionMethod: data.rejectionMethod,
            ...forwardToChannelIf(isCopilotLikeExtension(data.source?.extensionId))
        });
    }
};
AiEditTelemetryServiceImpl = ( __decorate([( __param(0, IInstantiationService)), ( __param(1, IRandomService))], AiEditTelemetryServiceImpl));

export { AiEditTelemetryServiceImpl };
