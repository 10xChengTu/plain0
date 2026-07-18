
import { localize } from '../../../nls.js';
import { Extensions, ConfigurationScope } from '../../configuration/common/configurationRegistry.js';
import { Registry } from '../../registry/common/platform.js';

const configurationRegistry = ( Registry.as(Extensions.Configuration));
configurationRegistry.registerConfiguration({
    id: "network",
    order: 14,
    title: ( localize(2184, "Network")),
    type: "object",
    properties: {
        "network.meteredConnection": {
            type: "string",
            enum: ["auto", "on", "off"],
            enumDescriptions: [( localize(
                2185,
                "Automatically detect metered connections using the operating system's network status."
            )), ( localize(
                2186,
                "Always treat the network connection as metered. Automatic updates and downloads will be postponed."
            )), ( localize(2187, "Never treat the network connection as metered."))],
            default: "auto",
            scope: ConfigurationScope.APPLICATION,
            description: ( localize(
                2188,
                "Controls whether the current network connection should be treated as metered. When metered, automatic updates, extension downloads, and other background network activity will be postponed to reduce data usage."
            )),
            tags: ["usesOnlineServices"]
        }
    }
});
