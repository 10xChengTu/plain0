
import { localize } from '../../../../nls.js';
import { isMacintosh } from '../../../../base/common/platform.js';

var OnboardingStepId;
(function(OnboardingStepId) {
    OnboardingStepId["SignIn"] = "onboarding.signIn";
    OnboardingStepId["Personalize"] = "onboarding.personalize";
    OnboardingStepId["AiPreference"] = "onboarding.aiPreference";
    OnboardingStepId["AgentSessions"] = "onboarding.agentSessions";
})(OnboardingStepId || (OnboardingStepId = {}));
function getOnboardingStepTitle(stepId) {
    switch (stepId) {
    case OnboardingStepId.SignIn:
        return localize(17035, "Sign In");
    case OnboardingStepId.Personalize:
        return localize(17036, "Make It Yours");
    case OnboardingStepId.AiPreference:
        return localize(17037, "Your AI Style");
    case OnboardingStepId.AgentSessions:
        return localize(17038, "Build with AI Agents");
    }
}
function getOnboardingStepSubtitle(stepId) {
    switch (stepId) {
    case OnboardingStepId.SignIn:
        return localize(17039, "Sync settings, unlock AI features, and connect to GitHub");
    case OnboardingStepId.Personalize:
        return localize(17040, "Choose your theme and keyboard mapping");
    case OnboardingStepId.AiPreference:
        return localize(17041, "Choose how much AI collaboration fits your workflow");
    case OnboardingStepId.AgentSessions:
        return localize(17042, "Open Chat anytime with {0}", isMacintosh ? "⌘⌃I" : "Ctrl+Alt+I");
    }
}
const ONBOARDING_STEPS = [
    OnboardingStepId.SignIn,
    OnboardingStepId.Personalize,
    OnboardingStepId.AgentSessions
];
var AiCollaborationMode;
(function(AiCollaborationMode) {
    AiCollaborationMode["CodeFirst"] = "code-first";
    AiCollaborationMode["Balanced"] = "balanced";
    AiCollaborationMode["AgentForward"] = "agent-forward";
})(AiCollaborationMode || (AiCollaborationMode = {}));
const ONBOARDING_AI_PREFERENCE_OPTIONS = [{
    id: AiCollaborationMode.CodeFirst,
    label: ( localize(17043, "I Write the Code")),
    description: ( localize(
        17044,
        "AI assists with suggestions and answers questions when you ask. You stay in control of every edit."
    )),
    icon: "edit"
}, {
    id: AiCollaborationMode.Balanced,
    label: ( localize(17045, "Side by Side")),
    description: ( localize(
        17046,
        "Inline suggestions plus a chat panel for deeper collaboration. A balance of writing and delegating."
    )),
    icon: "layoutSidebarRight"
}, {
    id: AiCollaborationMode.AgentForward,
    label: ( localize(17047, "AI Takes the Lead")),
    description: ( localize(
        17048,
        "Let the agent drive — describe what you want and review the result. Great for scaffolding and exploration."
    )),
    icon: "copilot"
}];
const ONBOARDING_STORAGE_KEY = "welcomeOnboarding.state";
const GHE_DOMAIN_REGEX = /^[a-zA-Z0-9-]+$/;
const GHE_FULL_URI_REGEX = /^(https:\/\/)?([a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+\.ghe\.com\/?$/;
var GheParseResultKind;
(function(GheParseResultKind) {
    GheParseResultKind["Empty"] = "empty";
    GheParseResultKind["SingleWord"] = "singleWord";
    GheParseResultKind["FullUri"] = "fullUri";
    GheParseResultKind["Invalid"] = "invalid";
})(GheParseResultKind || (GheParseResultKind = {}));
function parseGheInstanceInput(value) {
    const trimmed = value.trim();
    if (!trimmed) {
        return {
            kind: GheParseResultKind.Empty
        };
    }
    if (GHE_DOMAIN_REGEX.test(trimmed)) {
        return {
            kind: GheParseResultKind.SingleWord,
            resolvedUri: `https://${trimmed}.ghe.com`
        };
    }
    if (GHE_FULL_URI_REGEX.test(trimmed)) {
        const resolvedUri = trimmed.toLowerCase().startsWith("https://") ? trimmed : `https://${trimmed}`;
        return {
            kind: GheParseResultKind.FullUri,
            resolvedUri
        };
    }
    return {
        kind: GheParseResultKind.Invalid
    };
}

export { AiCollaborationMode, GHE_DOMAIN_REGEX, GHE_FULL_URI_REGEX, GheParseResultKind, ONBOARDING_AI_PREFERENCE_OPTIONS, ONBOARDING_STEPS, ONBOARDING_STORAGE_KEY, OnboardingStepId, getOnboardingStepSubtitle, getOnboardingStepTitle, parseGheInstanceInput };
