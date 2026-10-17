import { EMAIL_TEST_DOMAIN } from "@deskohub/test-email";
import { type Effect, type Layer, Match } from "effect";
import { m } from "@/features/administration/i18n";
import type { requireAdministratorAuthorization } from "@/features/administrators/server/administrator-authorization.server";
import type { Locale } from "@/features/i18n";
import type {
  CampaignService,
  ICampaignService,
} from "../../backend/campaign.service";
import type { ICampaignSendService } from "../../backend/campaign-send.service";
import type { CampaignConfirmationRejection } from "../../errors";

const confirmationRejectionMessages = {
  "unknown-code": m.emailCampaignsSendingFailureCodeUnknown,
  superseded: m.emailCampaignsSendingFailureCodeSuperseded,
  expired: m.emailCampaignsSendingFailureCodeExpired,
  "content-changed": m.emailCampaignsSendingFailureCodeContentChanged,
  "too-many-attempts": m.emailCampaignsSendingFailureCodeTooManyAttempts,
} as const satisfies Record<
  CampaignConfirmationRejection,
  typeof m.emailCampaignsSendingFailureCodeUnknown
>;

const recipientSourceUnavailableMessages = {
  dotypos: m.emailCampaignsSendingFailureDotyposUnavailable,
  database: m.emailCampaignsSendingFailureDatabaseUnavailable,
} as const;

/** Every failure a sending action can report, including service setup. */
export type CampaignSendingFailure =
  | Effect.Error<typeof requireAdministratorAuthorization>
  | Effect.Error<ReturnType<ICampaignSendService["testSend"]>>
  | Effect.Error<ReturnType<ICampaignSendService["send"]>>
  | Effect.Error<ReturnType<ICampaignSendService["retryUndelivered"]>>
  | Effect.Error<ReturnType<ICampaignService["duplicate"]>>
  | Layer.Error<typeof CampaignService.Live>;

/** Admin copy, in the admin's locale, for every failure a sending action reports. */
export const describeCampaignSendingFailure = (
  cause: CampaignSendingFailure,
  locale: Locale
) => {
  const options = { locale };
  const unexpectedFailure = () =>
    m.emailCampaignsSendingFailureUnexpected({}, options);
  return Match.value(cause).pipe(
    Match.tagsExhaustive({
      AdministratorUnauthorizedError: () =>
        m.emailCampaignsSendingFailureUnauthorized({}, options),
      CampaignNotFound: () =>
        m.emailCampaignsSendingFailureCampaignNotFound({}, options),
      CampaignReadOnly: () =>
        m.emailCampaignsSendingFailureCampaignReadOnly({}, options),
      CampaignConfirmationRejected: ({ reason }) =>
        confirmationRejectionMessages[reason]({}, options),
      CampaignTestRecipientInvalid: ({ email }) =>
        m.emailCampaignsSendingFailureTestRecipientInvalid({ email }, options),
      CampaignContentMissing: () =>
        m.emailCampaignsSendingFailureContentMissing({}, options),
      CampaignFallbackContentMissing: () =>
        m.emailCampaignsSendingFailureFallbackContentMissing({}, options),
      CampaignEmailDeliveryFailed: () =>
        m.emailCampaignsSendingFailureEmailDeliveryFailed({}, options),
      CampaignSigningKeyInvalid: () =>
        m.emailCampaignsSendingFailureSigningKeyInvalid({}, options),
      CampaignEmailNotConfigured: ({ variables }) =>
        m.emailCampaignsSendingFailureEmailNotConfigured(
          { variables: variables.join(", ") },
          options
        ),
      WorkspaceUrlConfigError: () =>
        m.emailCampaignsSendingFailureSiteUrlNotConfigured({}, options),
      CampaignAudienceMissing: () =>
        m.emailCampaignsSendingFailureAudienceMissing({}, options),
      CampaignAudienceNotFound: () =>
        m.emailCampaignsSendingFailureAudienceNotFound({}, options),
      CampaignRecipientResolutionError: ({ source }) =>
        recipientSourceUnavailableMessages[source]({}, options),
      CampaignRecipientsOutsideTestDomain: ({ recipientCount }) =>
        m.emailCampaignsSendingFailureOutsideTestDomain(
          { count: recipientCount, domain: EMAIL_TEST_DOMAIN },
          options
        ),
      CampaignNoRecipients: () =>
        m.emailCampaignsSendingFailureNoRecipients({}, options),
      CampaignDeliveryQueueFailed: () =>
        m.emailCampaignsSendingFailureDeliveryQueueFailed({}, options),
      CampaignNotRetryable: () =>
        m.emailCampaignsSendingFailureNotRetryable({}, options),
      ConfigError: () => m.emailCampaignsSendingFailureConfigError({}, options),
      PlatformError: unexpectedFailure,
      SchemaError: unexpectedFailure,
      EffectDrizzleQueryError: unexpectedFailure,
      SqlError: unexpectedFailure,
    })
  );
};
