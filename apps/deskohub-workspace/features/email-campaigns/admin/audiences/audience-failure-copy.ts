import { m } from "@/features/administration/i18n";
import type { CampaignOperationFailureCopy } from "../campaign-operation-failure";

/** How saving an audience words its failures. */
export const audienceSaveFailureCopy: CampaignOperationFailureCopy = {
  fallback: (locale) =>
    m.emailCampaignsAudienceEditorSaveFailed({}, { locale }),
  codes: {
    "audience-filter-invalid": (locale) =>
      m.emailCampaignsAudienceSaveFailedCheckFilters({}, { locale }),
    "audience-filter-context": (locale) =>
      m.emailCampaignsAudienceSaveFilterUnavailable({}, { locale }),
    "audience-filter-campaign-not-found": (locale) =>
      m.emailCampaignsAudienceSaveCampaignNotFound({}, { locale }),
    "service-unavailable": (locale) =>
      m.emailCampaignsAudienceSaveFailedRetry({}, { locale }),
  },
};

/**
 * Archiving, unarchiving and deleting have no wording of their own: the
 * shared copy covers a delete that drafts block, and anything else is worth
 * a retry.
 */
export const audienceArchiveFailureCopy: CampaignOperationFailureCopy = {
  fallback: (locale) =>
    m.emailCampaignsAudienceArchiveFailedRetry({}, { locale }),
};

export const audienceUnarchiveFailureCopy: CampaignOperationFailureCopy = {
  fallback: (locale) =>
    m.emailCampaignsAudienceUnarchiveFailedRetry({}, { locale }),
};

export const audienceDeleteFailureCopy: CampaignOperationFailureCopy = {
  fallback: (locale) =>
    m.emailCampaignsAudienceDeleteFailedRetry({}, { locale }),
};
