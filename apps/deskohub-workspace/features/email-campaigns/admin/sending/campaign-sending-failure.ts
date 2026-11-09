import { m } from "@/features/administration/i18n";
import type { CampaignOperationFailureCopy } from "../campaign-operation-failure";

/**
 * How a test send, a send, a retry or a duplication words its failures;
 * `fallback` names the action that failed.
 */
export const campaignSendingFailureCopy = (
  fallback: CampaignOperationFailureCopy["fallback"]
): CampaignOperationFailureCopy => ({
  fallback,
  codes: {
    "campaign-not-found": (locale) =>
      m.emailCampaignsSendingFailureCampaignNotFound({}, { locale }),
    "campaign-read-only": (locale) =>
      m.emailCampaignsSendingFailureCampaignReadOnly({}, { locale }),
    "audience-not-found": (locale) =>
      m.emailCampaignsSendingFailureAudienceNotFound({}, { locale }),
    "service-unavailable": (locale) =>
      m.emailCampaignsSendingFailureUnexpected({}, { locale }),
  },
});
