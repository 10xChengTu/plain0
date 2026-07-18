
import { localize } from '../../../../../nls.js';

const DEFAULT_LOCAL_ECHO_EXCLUDE = ["vim", "vi", "nano", "tmux"];
var TerminalTypeAheadSettingId;
(function(TerminalTypeAheadSettingId) {
    TerminalTypeAheadSettingId["LocalEchoLatencyThreshold"] = "terminal.integrated.localEchoLatencyThreshold";
    TerminalTypeAheadSettingId["LocalEchoEnabled"] = "terminal.integrated.localEchoEnabled";
    TerminalTypeAheadSettingId["LocalEchoExcludePrograms"] = "terminal.integrated.localEchoExcludePrograms";
    TerminalTypeAheadSettingId["LocalEchoStyle"] = "terminal.integrated.localEchoStyle";
})(TerminalTypeAheadSettingId || (TerminalTypeAheadSettingId = {}));
const terminalTypeAheadConfiguration = {
    [TerminalTypeAheadSettingId.LocalEchoLatencyThreshold]: {
        description: ( localize(
            15797,
            "Length of network delay, in milliseconds, where local edits will be echoed on the terminal without waiting for server acknowledgement. If '0', local echo will always be on, and if '-1' it will be disabled."
        )),
        type: "integer",
        minimum: -1,
        default: 30,
        tags: ["preview"]
    },
    [TerminalTypeAheadSettingId.LocalEchoEnabled]: {
        markdownDescription: ( localize(
            15798,
            "When local echo should be enabled. This will override {0}",
            "`#terminal.integrated.localEchoLatencyThreshold#`"
        )),
        type: "string",
        enum: ["on", "off", "auto"],
        enumDescriptions: [( localize(15799, "Always enabled")), ( localize(15800, "Always disabled")), ( localize(15801, "Enabled only for remote workspaces"))],
        default: "off",
        tags: ["preview"]
    },
    [TerminalTypeAheadSettingId.LocalEchoExcludePrograms]: {
        description: ( localize(
            15802,
            "Local echo will be disabled when any of these program names are found in the terminal title."
        )),
        type: "array",
        items: {
            type: "string",
            uniqueItems: true
        },
        default: DEFAULT_LOCAL_ECHO_EXCLUDE,
        tags: ["preview"]
    },
    [TerminalTypeAheadSettingId.LocalEchoStyle]: {
        description: ( localize(
            15803,
            "Terminal style of locally echoed text; either a font style or an RGB color."
        )),
        default: "dim",
        anyOf: [{
            enum: ["bold", "dim", "italic", "underlined", "inverted", "#ff0000"]
        }, {
            type: "string",
            format: "color-hex"
        }],
        tags: ["preview"]
    }
};

export { DEFAULT_LOCAL_ECHO_EXCLUDE, TerminalTypeAheadSettingId, terminalTypeAheadConfiguration };
