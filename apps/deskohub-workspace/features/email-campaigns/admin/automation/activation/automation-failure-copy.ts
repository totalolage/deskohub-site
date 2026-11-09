import { m } from "@/features/administration/i18n";
import type { CampaignOperationFailureCopy } from "../../campaign-operation-failure";

/** Codes any automation lifecycle change can fail with. */
const lifecycleCodes: CampaignOperationFailureCopy["codes"] = {
  "automation-archived": (locale) =>
    m.emailAutomationActivationFailureArchived({}, { locale }),
  "automation-status-conflict": (locale) =>
    m.emailAutomationActivationFailureStatusConflict({}, { locale }),
};

export const dryRunFailureCopy: CampaignOperationFailureCopy = {
  fallback: (locale) => m.emailAutomationActivationDryRunFailed({}, { locale }),
  codes: {
    ...lifecycleCodes,
    "flow-invalid": (locale) =>
      m.emailAutomationActivationFailureFlowInvalid({}, { locale }),
  },
};

export const activateFailureCopy: CampaignOperationFailureCopy = {
  fallback: (locale) =>
    m.emailAutomationActivationActivateFailed({}, { locale }),
  codes: {
    ...lifecycleCodes,
    "automation-preview-required": (locale) =>
      m.emailAutomationActivationFailurePreviewRequired({}, { locale }),
    "automation-draft-changed": (locale) =>
      m.emailAutomationActivationFailureDraftChanged({}, { locale }),
    "flow-invalid": (locale) =>
      m.emailAutomationActivationFailureFlowInvalid({}, { locale }),
    "audience-archived": (locale) =>
      m.emailAutomationActivationFailureAudienceArchived({}, { locale }),
    "fallback-content-missing": (locale) =>
      m.emailAutomationActivationFailureFallbackContentMissing({}, { locale }),
  },
};

export const pauseFailureCopy: CampaignOperationFailureCopy = {
  fallback: (locale) => m.emailAutomationActivationPauseFailed({}, { locale }),
  codes: lifecycleCodes,
};

export const resumeFailureCopy: CampaignOperationFailureCopy = {
  fallback: (locale) => m.emailAutomationActivationResumeFailed({}, { locale }),
  codes: lifecycleCodes,
};

export const archiveFailureCopy: CampaignOperationFailureCopy = {
  fallback: (locale) =>
    m.emailAutomationActivationArchiveFailed({}, { locale }),
  codes: lifecycleCodes,
};

/** Why a dry run job ended as `failed`, from its open `errorCode`. */
export const dryRunJobFailureCopy: CampaignOperationFailureCopy = {
  fallback: (locale) =>
    m.emailAutomationActivationJobFailedReason({}, { locale }),
  codes: {
    "preview-stalled": (locale) =>
      m.emailAutomationActivationJobStalled({}, { locale }),
  },
};
