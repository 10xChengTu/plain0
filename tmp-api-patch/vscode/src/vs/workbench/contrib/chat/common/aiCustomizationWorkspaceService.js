

var AICustomizationSources;
(function(AICustomizationSources) {
    AICustomizationSources.local = "local";
    AICustomizationSources.user = "user";
    AICustomizationSources.extension = "extension";
    AICustomizationSources.plugin = "plugin";
    AICustomizationSources.builtin = "builtin";
    AICustomizationSources.all = [
        AICustomizationSources.local,
        AICustomizationSources.user,
        AICustomizationSources.extension,
        AICustomizationSources.plugin,
        AICustomizationSources.builtin
    ];
})(AICustomizationSources || (AICustomizationSources = {}));
const BUILTIN_STORAGE = AICustomizationSources.builtin;
const AICustomizationManagementSection = {
    Agents: "agents",
    Skills: "skills",
    Instructions: "instructions",
    Prompts: "prompts",
    Hooks: "hooks",
    Automations: "automations",
    McpServers: "mcpServers",
    Plugins: "plugins",
    Models: "models",
    Tools: "tools"
};
function applySourceFilter(items, filter) {
    const sourceSet = ( new Set(filter.sources));
    return items.filter(item => ( sourceSet.has(item.source)));
}

export { AICustomizationManagementSection, AICustomizationSources, BUILTIN_STORAGE, applySourceFilter };
