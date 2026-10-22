import { EMAIL_TEST_DOMAIN } from "@deskohub/test-email";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";

/** Admin copy for one failure, in the admin's locale. */
type FailureCopy = (locale: Locale) => string;

type FailureCopyByCode = { readonly [code: string]: FailureCopy };

/** How one campaign action words its failures. */
export type CampaignOperationFailureCopy = {
  /** For a code without copy of its own, such as an outage or invalid input. */
  readonly fallback: FailureCopy;
  /** This action's own wording of a code, in place of the shared one. */
  readonly codes?: FailureCopyByCode;
};

/**
 * The wording every campaign action shares for a port failure `code`. The
 * port's English `message` never reaches the Admin UI.
 */
const sharedFailureCopy: FailureCopyByCode = {
  "administrator-required": (locale) =>
    m.emailCampaignsSendingFailureUnauthorized({}, { locale }),
  "campaign-not-found": (locale) =>
    m.emailCampaignsDraftNotFound({}, { locale }),
  "audience-not-found": (locale) =>
    m.emailCampaignsAudienceNotFound({}, { locale }),
  "audience-archived": (locale) =>
    m.emailCampaignsComposerSaveAudienceArchived({}, { locale }),
  "audience-in-use": (locale) =>
    m.emailCampaignsAudienceInUseByDrafts({}, { locale }),
  "campaign-delivery-mismatch": (locale) =>
    m.emailCampaignsDeliveryMismatch({}, { locale }),
  "campaign-audience-missing": (locale) =>
    m.emailCampaignsSendingFailureAudienceMissing({}, { locale }),
  "confirmation-unknown-code": (locale) =>
    m.emailCampaignsSendingFailureCodeUnknown({}, { locale }),
  "confirmation-superseded": (locale) =>
    m.emailCampaignsSendingFailureCodeSuperseded({}, { locale }),
  "confirmation-expired": (locale) =>
    m.emailCampaignsSendingFailureCodeExpired({}, { locale }),
  "confirmation-content-changed": (locale) =>
    m.emailCampaignsSendingFailureCodeContentChanged({}, { locale }),
  "confirmation-too-many-attempts": (locale) =>
    m.emailCampaignsSendingFailureCodeTooManyAttempts({}, { locale }),
  "test-recipient-invalid": (locale) =>
    m.emailCampaignsSendingFailureTestRecipientsInvalid({}, { locale }),
  "recipients-outside-test-domain": (locale) =>
    m.emailCampaignsSendingFailureRecipientsOutsideTestDomain(
      { domain: EMAIL_TEST_DOMAIN },
      { locale }
    ),
  "content-missing": (locale) =>
    m.emailCampaignsSendingFailureContentMissing({}, { locale }),
  "fallback-content-missing": (locale) =>
    m.emailCampaignsSendingFailureFallbackContentMissing({}, { locale }),
  "no-recipients": (locale) =>
    m.emailCampaignsSendingFailureNoRecipients({}, { locale }),
  "campaign-not-retryable": (locale) =>
    m.emailCampaignsSendingFailureNotRetryable({}, { locale }),
  "recipient-resolution-unavailable": (locale) =>
    m.emailCampaignsSendingFailureRecipientsUnavailable({}, { locale }),
  "email-delivery-failed": (locale) =>
    m.emailCampaignsSendingFailureEmailDeliveryFailed({}, { locale }),
  "delivery-queue-failed": (locale) =>
    m.emailCampaignsSendingFailureDeliveryQueueFailed({}, { locale }),
  "email-not-configured": (locale) =>
    m.emailCampaignsSendingFailureEmailSetupMissing({}, { locale }),
  "signing-key-invalid": (locale) =>
    m.emailCampaignsSendingFailureSigningKeyInvalid({}, { locale }),
};

const copyFor = (copy: FailureCopyByCode | undefined, code: string) =>
  copy !== undefined && Object.hasOwn(copy, code) ? copy[code] : undefined;

/**
 * Admin copy for a failed campaign operation: the action's own wording of
 * the code, else the shared wording, else the action's fallback.
 */
export const describeCampaignOperationFailure = (
  { code }: { readonly code: string },
  copy: CampaignOperationFailureCopy,
  locale: Locale
) =>
  (
    copyFor(copy.codes, code) ??
    copyFor(sharedFailureCopy, code) ??
    copy.fallback
  )(locale);
