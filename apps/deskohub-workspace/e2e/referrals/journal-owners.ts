import type { WorkspaceE2EAccountJournalOwner } from "../account/reconcile";
import {
  type WorkspaceE2EReferralCaseId,
  workspaceE2EReferralCaseIds,
} from "../playwright-checkout/case-catalog";

/**
 * The exact run-scoped recipient labels each referral-lane case may own. A
 * case journals only identities derived from its own labels, so suite cleanup
 * validates every journaled row against this closed set.
 */
export const workspaceE2EReferralRecipientLabels = {
  "referral-auto-linked-sign-in": [
    "ral-referrer",
    "ral-other-referrer",
    "ral-usable",
    "ral-unusable",
    "ral-attributed",
  ],
  "referral-checkout-code-entry": [
    "rce-referrer",
    "rce-link-referrer",
    "rce-customer",
  ],
  "referral-profile-completion-checkout": [
    "rpc-referrer",
    "rpc-other-referrer",
    "rpc-customer",
  ],
  "referral-profile-completion-unusable-link": ["rpu-referrer", "rpu-customer"],
  "referral-referrer-screen": [
    "rrs-referrer",
    "rrs-invitee-a",
    "rrs-invitee-b",
    "rrs-invitee-c",
    "rrs-other-referrer",
  ],
  "referral-share-link-checkout": [
    "rsl-referrer",
    "rsl-customer",
    "rsl-invitee",
  ],
} as const satisfies Record<WorkspaceE2EReferralCaseId, readonly string[]>;

export const workspaceE2EReferralJournalOwners: readonly WorkspaceE2EAccountJournalOwner[] =
  workspaceE2EReferralCaseIds.map((caseId) => ({
    ownerId: caseId,
    recipientLabels: workspaceE2EReferralRecipientLabels[caseId],
  }));
