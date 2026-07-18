
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { CHAT_PROVIDER_ID } from '../common/participants/chatParticipantContribTypes.js';

const ChatViewPaneTarget = Symbol("ChatViewPaneTarget");
function isIChatViewViewContext(context) {
    return typeof context.viewId === "string";
}
function isIChatResourceViewContext(context) {
    return !isIChatViewViewContext(context);
}
const ChatViewId = `workbench.panel.chat.view.${CHAT_PROVIDER_ID}`;
const ChatViewContainerId = "workbench.panel.chat";
const HasInstalledAgentPluginsContext = ( new RawContextKey("hasInstalledAgentPlugins", false));
const InstalledAgentPluginsViewId = "workbench.views.agentPlugins.installed";

export { ChatViewContainerId, ChatViewId, ChatViewPaneTarget, HasInstalledAgentPluginsContext, InstalledAgentPluginsViewId, isIChatResourceViewContext, isIChatViewViewContext };
