
import { localize } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';

const getStartedIcon = registerIcon("remote-explorer-get-started", Codicon.star, ( localize(13467, "Getting started icon in the remote explorer view.")));
const documentationIcon = registerIcon("remote-explorer-documentation", Codicon.book, ( localize(13468, "Documentation icon in the remote explorer view.")));
registerIcon("remote-explorer-feedback", Codicon.twitter, ( localize(13469, "Feedback icon in the remote explorer view.")));
const reviewIssuesIcon = registerIcon("remote-explorer-review-issues", Codicon.issues, ( localize(13470, "Review issue icon in the remote explorer view.")));
const reportIssuesIcon = registerIcon("remote-explorer-report-issues", Codicon.comment, ( localize(13471, "Report issue icon in the remote explorer view.")));
const remoteExplorerViewIcon = registerIcon("remote-explorer-view-icon", Codicon.remoteExplorer, ( localize(13472, "View icon of the remote explorer view.")));
const portsViewIcon = registerIcon("ports-view-icon", Codicon.plug, ( localize(13473, "View icon of the remote ports view.")));
registerIcon("ports-view-icon", Codicon.plug, ( localize(13474, "Icon representing a remote port.")));
const privatePortIcon = registerIcon("private-ports-view-icon", Codicon.lock, ( localize(13475, "Icon representing a private remote port.")));
const forwardPortIcon = registerIcon("ports-forward-icon", Codicon.plus, ( localize(13476, "Icon for the forward action.")));
const stopForwardIcon = registerIcon("ports-stop-forward-icon", Codicon.x, ( localize(13477, "Icon for the stop forwarding action.")));
const openBrowserIcon = registerIcon("ports-open-browser-icon", Codicon.globe, ( localize(13478, "Icon for the open browser action.")));
const openPreviewIcon = registerIcon("ports-open-preview-icon", Codicon.openPreview, ( localize(13479, "Icon for the open preview action.")));
const copyAddressIcon = registerIcon("ports-copy-address-icon", Codicon.clippy, ( localize(13480, "Icon for the copy local address action.")));
const labelPortIcon = registerIcon("ports-label-icon", Codicon.tag, ( localize(13481, "Icon for the label port action.")));
const forwardedPortWithoutProcessIcon = registerIcon(
    "ports-forwarded-without-process-icon",
    Codicon.circleOutline,
    ( localize(13482, "Icon for forwarded ports that don't have a running process."))
);
const forwardedPortWithProcessIcon = registerIcon("ports-forwarded-with-process-icon", Codicon.circleFilled, ( localize(13483, "Icon for forwarded ports that do have a running process.")));

export { copyAddressIcon, documentationIcon, forwardPortIcon, forwardedPortWithProcessIcon, forwardedPortWithoutProcessIcon, getStartedIcon, labelPortIcon, openBrowserIcon, openPreviewIcon, portsViewIcon, privatePortIcon, remoteExplorerViewIcon, reportIssuesIcon, reviewIssuesIcon, stopForwardIcon };
