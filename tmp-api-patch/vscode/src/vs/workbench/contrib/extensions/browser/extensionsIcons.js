
import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';

const extensionsViewIcon = registerIcon("extensions-view-icon", Codicon.extensions, ( localize(10649, "View icon of the extensions view.")));
const manageExtensionIcon = registerIcon("extensions-manage", Codicon.gear, ( localize(10650, "Icon for the 'Manage' action in the extensions view.")));
const clearSearchResultsIcon = registerIcon("extensions-clear-search-results", Codicon.clearAll, ( localize(10651, "Icon for the 'Clear Search Result' action in the extensions view.")));
const refreshIcon = registerIcon("extensions-refresh", Codicon.refresh, ( localize(10652, "Icon for the 'Refresh' action in the extensions view.")));
const filterIcon = registerIcon("extensions-filter", Codicon.filter, ( localize(10653, "Icon for the 'Filter' action in the extensions view.")));
const installLocalInRemoteIcon = registerIcon(
    "extensions-install-local-in-remote",
    Codicon.cloudDownload,
    ( localize(
    10654,
    "Icon for the 'Install Local Extension in Remote' action in the extensions view."
))
);
const installWorkspaceRecommendedIcon = registerIcon(
    "extensions-install-workspace-recommended",
    Codicon.cloudDownload,
    ( localize(
    10655,
    "Icon for the 'Install Workspace Recommended Extensions' action in the extensions view."
))
);
const configureRecommendedIcon = registerIcon("extensions-configure-recommended", Codicon.pencil, ( localize(
    10656,
    "Icon for the 'Configure Recommended Extensions' action in the extensions view."
)));
const syncEnabledIcon = registerIcon("extensions-sync-enabled", Codicon.sync, ( localize(10657, "Icon to indicate that an extension is synced.")));
const syncIgnoredIcon = registerIcon("extensions-sync-ignored", Codicon.syncIgnored, ( localize(10658, "Icon to indicate that an extension is ignored when syncing.")));
const remoteIcon = registerIcon("extensions-remote", Codicon.remote, ( localize(
    10659,
    "Icon to indicate that an extension is remote in the extensions view and editor."
)));
const installCountIcon = registerIcon("extensions-install-count", Codicon.cloudDownload, ( localize(
    10660,
    "Icon shown along with the install count in the extensions view and editor."
)));
const privateExtensionIcon = registerIcon("extensions-private", Codicon.lock, ( localize(
    10661,
    "Icon shown for private extensions in the extensions view and editor."
)));
const ratingIcon = registerIcon("extensions-rating", Codicon.star, ( localize(
    10662,
    "Icon shown along with the rating in the extensions view and editor."
)));
const preReleaseIcon = registerIcon("extensions-pre-release", Codicon.versions, ( localize(
    10663,
    "Icon shown for extensions having pre-release versions in extensions view and editor."
)));
const sponsorIcon = registerIcon("extensions-sponsor", Codicon.heartFilled, ( localize(
    10664,
    "Icon used for sponsoring extensions in the extensions view and editor."
)));
const starFullIcon = registerIcon("extensions-star-full", Codicon.starFull, ( localize(10665, "Full star icon used for the rating in the extensions editor.")));
const starHalfIcon = registerIcon("extensions-star-half", Codicon.starHalf, ( localize(10666, "Half star icon used for the rating in the extensions editor.")));
const starEmptyIcon = registerIcon("extensions-star-empty", Codicon.starEmpty, ( localize(10667, "Empty star icon used for the rating in the extensions editor.")));
const errorIcon = registerIcon("extensions-error-message", Codicon.error, ( localize(10668, "Icon shown with a error message in the extensions editor.")));
const warningIcon = registerIcon("extensions-warning-message", Codicon.warning, ( localize(10669, "Icon shown with a warning message in the extensions editor.")));
const infoIcon = registerIcon("extensions-info-message", Codicon.info, ( localize(10670, "Icon shown with an info message in the extensions editor.")));
const trustIcon = registerIcon("extension-workspace-trust", Codicon.shield, ( localize(
    10671,
    "Icon shown with a workspace trust message in the extension editor."
)));
const activationTimeIcon = registerIcon("extension-activation-time", Codicon.history, ( localize(
    10672,
    "Icon shown with a activation time message in the extension editor."
)));
const restartRequiredIcon = registerIcon("extension-restart-required", Codicon.refresh, ( localize(
    10673,
    "Icon shown when an extension requires a restart in the extensions view."
)));

export { activationTimeIcon, clearSearchResultsIcon, configureRecommendedIcon, errorIcon, extensionsViewIcon, filterIcon, infoIcon, installCountIcon, installLocalInRemoteIcon, installWorkspaceRecommendedIcon, manageExtensionIcon, preReleaseIcon, privateExtensionIcon, ratingIcon, refreshIcon, remoteIcon, restartRequiredIcon, sponsorIcon, starEmptyIcon, starFullIcon, starHalfIcon, syncEnabledIcon, syncIgnoredIcon, trustIcon, warningIcon };
