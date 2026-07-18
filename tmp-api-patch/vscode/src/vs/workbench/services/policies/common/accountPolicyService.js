
import '../../../../base/common/event.js';
import { localize } from '../../../../nls.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import '../../../../platform/instantiation/common/instantiation.js';
import '../../../../base/common/errors.js';
import '../../../../base/common/iterator.js';
import '../../../../base/common/lifecycle.js';

const APPROVED_ACCOUNT_ORGANIZATIONS_POLICY_NAME = "ChatApprovedAccountOrganizations";
var AccountPolicyGateState;
(function(AccountPolicyGateState) {
    AccountPolicyGateState["Inactive"] = "inactive";
    AccountPolicyGateState["Satisfied"] = "satisfied";
    AccountPolicyGateState["Restricted"] = "restricted";
})(AccountPolicyGateState || (AccountPolicyGateState = {}));
var AccountPolicyGateUnsatisfiedReason;
(function(AccountPolicyGateUnsatisfiedReason) {
    AccountPolicyGateUnsatisfiedReason["NoAccount"] = "noAccount";
    AccountPolicyGateUnsatisfiedReason["WrongProvider"] = "wrongProvider";
    AccountPolicyGateUnsatisfiedReason["OrgNotApproved"] = "orgNotApproved";
    AccountPolicyGateUnsatisfiedReason["PolicyNotResolved"] = "policyNotResolved";
})(
    AccountPolicyGateUnsatisfiedReason || (AccountPolicyGateUnsatisfiedReason = {})
);
const ChatAccountPolicyGateActiveContext = ( new RawContextKey("chatAccountPolicyGateActive", false, {
    type: "boolean",
    description: ( localize(
        17841,
        "True when the 'Require Approved Account' policy is in effect and the user is not yet signed into an approved GitHub organization, so all AI features are disabled until they sign in."
    ))
}));

export { APPROVED_ACCOUNT_ORGANIZATIONS_POLICY_NAME, AccountPolicyGateState, AccountPolicyGateUnsatisfiedReason, ChatAccountPolicyGateActiveContext };
