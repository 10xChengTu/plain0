
import { localize2, localize } from '../../../../nls.js';
import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.service.js';
import { METERED_CONNECTION_SETTING_KEY } from '../../../../platform/meteredConnection/common/meteredConnection.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.service.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { MeteredConnectionStatusContribution } from './meteredConnectionStatus.js';
import '../../../../platform/meteredConnection/common/meteredConnection.config.contribution.js';

registerWorkbenchContribution2(
    MeteredConnectionStatusContribution.ID,
    MeteredConnectionStatusContribution,
    WorkbenchPhase.AfterRestored
);
registerAction2(class ConfigureMeteredConnectionAction extends Action2 {
    static {
        this.ID = "workbench.action.configureMeteredConnection";
    }
    constructor() {
        super({
            id: ConfigureMeteredConnectionAction.ID,
            title: ( localize2(12331, "Configure Metered Connection")),
            f1: true
        });
    }
    async run(accessor) {
        const quickInputService = accessor.get(IQuickInputService);
        const configurationService = accessor.get(IConfigurationService);
        const currentValue = configurationService.getValue(METERED_CONNECTION_SETTING_KEY);
        const picks = [{
            value: "auto",
            label: ( localize(12332, "Auto")),
            description: ( localize(12333, "Detect metered connections automatically")),
            picked: currentValue === "auto"
        }, {
            value: "on",
            label: ( localize(12334, "On")),
            description: ( localize(12335, "Always treat the connection as metered")),
            picked: currentValue === "on"
        }, {
            value: "off",
            label: ( localize(12336, "Off")),
            description: ( localize(12337, "Never treat the connection as metered")),
            picked: currentValue === "off"
        }];
        const pick = await quickInputService.pick(picks, {
            placeHolder: ( localize(12338, "Select Metered Connection Mode")),
            activeItem: picks.find(p => p.picked)
        });
        if (pick) {
            await configurationService.updateValue(METERED_CONNECTION_SETTING_KEY, pick.value);
        }
    }
});
