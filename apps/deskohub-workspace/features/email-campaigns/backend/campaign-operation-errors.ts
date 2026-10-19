import {
  type CampaignOperationError,
  OperationConflict,
  OperationInputInvalid,
  OperationNotFound,
  OperationUnavailable,
} from "@deskohub/workspace-admin-api";
import { Match } from "effect";
import type { AutomationConditionAudienceMissing } from "../automation/backend/automation-evaluation-facts.service";
import type { AutomationUnitFetchFailure } from "../automation/backend/automation-unit-handler";
import {
  AutomationCalendarNeverOccurs,
  type AutomationFlowInvalid,
  type AutomationFlowLocation,
} from "../automation/errors";
import type {
  AudienceFilterContextInvalid,
  CampaignAudienceArchived,
  CampaignAudienceInUse,
  CampaignAudienceMissing,
  CampaignAudienceNotFound,
  CampaignConfirmationRejected,
  CampaignContentInvalid,
  CampaignContentMissing,
  CampaignDeliveryMismatch,
  CampaignDeliveryQueueFailed,
  CampaignEmailDeliveryFailed,
  CampaignEmailNotConfigured,
  CampaignFallbackContentMissing,
  CampaignNoRecipients,
  CampaignNotFound,
  CampaignNotRetryable,
  CampaignReadOnly,
  CampaignRecipientResolutionError,
  CampaignRecipientsOutsideTestDomain,
  CampaignSigningKeyInvalid,
  CampaignTestRecipientInvalid,
} from "../errors";

/**
 * Every failure a campaign operation handler can raise: a domain error, a
 * port error a handler raises itself, or an infrastructure failure.
 */
export type CampaignOperationCause =
  | CampaignOperationError
  | AutomationCalendarNeverOccurs
  | AutomationConditionAudienceMissing
  | AutomationFlowInvalid
  | AutomationUnitFetchFailure
  | AudienceFilterContextInvalid
  | CampaignAudienceArchived
  | CampaignAudienceInUse
  | CampaignAudienceMissing
  | CampaignAudienceNotFound
  | CampaignConfirmationRejected
  | CampaignContentInvalid
  | CampaignContentMissing
  | CampaignDeliveryMismatch
  | CampaignDeliveryQueueFailed
  | CampaignEmailDeliveryFailed
  | CampaignEmailNotConfigured
  | CampaignFallbackContentMissing
  | CampaignNoRecipients
  | CampaignNotFound
  | CampaignNotRetryable
  | CampaignReadOnly
  | CampaignRecipientResolutionError
  | CampaignRecipientsOutsideTestDomain
  | CampaignSigningKeyInvalid
  | CampaignTestRecipientInvalid
  | { readonly _tag: string };

const confirmationRejectionMessages = {
  "unknown-code":
    "The confirmation code doesn't match the latest test send. Check it for typos.",
  superseded:
    "A newer test send replaced this confirmation code. Use the code from the latest test email.",
  expired: "The confirmation code expired. Run a new test send.",
  "content-changed":
    "The campaign changed after the test send. Run a new test send.",
  "too-many-attempts":
    "Too many wrong confirmation codes were entered. Run a new test send.",
} satisfies Record<CampaignConfirmationRejected["reason"], string>;

/**
 * Maps a domain failure to its port category with a stable `code` and an
 * English, actionable message that holds no customer data. The original
 * failure stays as `cause`. Port errors pass through unchanged.
 */
export const toOperationError = (
  cause: CampaignOperationCause
): CampaignOperationError =>
  Match.value(cause).pipe(
    Match.tag(
      "OperationUnauthorized",
      "OperationInputInvalid",
      "OperationConflict",
      "OperationNotFound",
      "OperationUnavailable",
      "OperationInProgress",
      (failure) => failure
    ),
    Match.tag(
      "CampaignNotFound",
      () =>
        new OperationNotFound({
          code: "campaign-not-found",
          message: "The campaign was not found.",
          cause,
        })
    ),
    Match.tag(
      "CampaignAudienceNotFound",
      () =>
        new OperationNotFound({
          code: "audience-not-found",
          message: "The audience was not found.",
          cause,
        })
    ),
    Match.tag(
      "CampaignContentInvalid",
      (failure) =>
        new OperationInputInvalid({
          code: "content-invalid",
          message: `The campaign content is invalid: ${failure.cause.message}`,
          cause,
        })
    ),
    Match.tag(
      "CampaignTestRecipientInvalid",
      ({ email }) =>
        new OperationInputInvalid({
          code: "test-recipient-invalid",
          message: `The test recipient "${email}" isn't a valid email address.`,
          cause,
        })
    ),
    Match.tag(
      "AudienceFilterContextInvalid",
      ({ uses }) =>
        new OperationInputInvalid({
          code: "audience-filter-context",
          message: `The audience filter uses ${[
            ...uses.attributes.map((attribute) => `the ${attribute} attribute`),
            ...uses.periods.map((period) => `${period} periods`),
            ...uses.campaignSources.map(
              (source) => `${source} campaign sources`
            ),
          ].join(", ")}, which saved audiences and campaigns can't use yet.`,
          cause,
        })
    ),
    Match.tag(
      "CampaignReadOnly",
      ({ status }) =>
        new OperationConflict({
          code: "campaign-read-only",
          message: `The campaign is ${status}, so it can no longer be changed.`,
          cause,
        })
    ),
    Match.tag(
      "CampaignDeliveryMismatch",
      () =>
        new OperationConflict({
          code: "campaign-delivery-mismatch",
          message:
            "This campaign sends automatically, so it can't be edited, deleted, test sent, sent, retried, or duplicated like a one-off campaign.",
          cause,
        })
    ),
    Match.tag(
      "CampaignAudienceInUse",
      ({ draftCampaignIds }) =>
        new OperationConflict({
          code: "audience-in-use",
          message: `Draft campaigns use this audience (${draftCampaignIds.join(", ")}). Archive it instead, or move those drafts to another audience.`,
          cause,
        })
    ),
    Match.tag(
      "CampaignAudienceArchived",
      () =>
        new OperationConflict({
          code: "audience-archived",
          message: "The audience is archived. Choose another audience.",
          cause,
        })
    ),
    Match.orElse(toAutomationOperationError)
  );

/** Where in a flow a problem is, as the message names it. */
const describeFlowLocation = (location: AutomationFlowLocation) =>
  Match.value(location).pipe(
    Match.tagsExhaustive({
      Trigger: () => "the schedule trigger",
      Step: ({ stepId }) => `step "${stepId}"`,
    })
  );

/** Failures of an automation's flow, its conditions and its Dotypos reads. */
const toAutomationOperationError = (
  cause: CampaignOperationCause
): CampaignOperationError =>
  Match.value(cause).pipe(
    Match.tag(
      "AutomationFlowInvalid",
      ({ message }) =>
        new OperationInputInvalid({
          code: "flow-invalid",
          message,
          cause,
        })
    ),
    Match.tag(
      "AutomationCalendarNeverOccurs",
      ({ location }) =>
        new OperationInputInvalid({
          code: AutomationCalendarNeverOccurs.code,
          message: `The calendar of ${describeFlowLocation(location)} never happens in the next 8 years. Choose another combination.`,
          cause,
        })
    ),
    Match.tag(
      "AutomationConditionAudienceMissing",
      ({ audienceId }) =>
        new OperationNotFound({
          code: "audience-missing",
          message: `A condition refers to the saved audience ${audienceId}, which no longer exists. Choose another audience.`,
          cause,
        })
    ),
    Match.tag(
      "AutomationUnitFetchFailure",
      ({ code }) =>
        new OperationUnavailable({
          code,
          message:
            "The Dotypos API is unavailable, so customers couldn't be read. Try again shortly.",
          cause,
        })
    ),
    Match.orElse(toSendOperationError)
  );

/** Failures of a test send, a confirmed send, or a retry. */
const toSendOperationError = (
  cause: CampaignOperationCause
): CampaignOperationError =>
  Match.value(cause).pipe(
    Match.tag(
      "CampaignConfirmationRejected",
      ({ reason }) =>
        new OperationConflict({
          code: `confirmation-${reason}`,
          message: confirmationRejectionMessages[reason],
          cause,
        })
    ),
    Match.tag(
      "CampaignRecipientsOutsideTestDomain",
      ({ recipientCount }) =>
        new OperationConflict({
          code: "recipients-outside-test-domain",
          message: `Outside production, campaign mail may reach only the email test domain, and ${recipientCount} recipients are outside it.`,
          cause,
        })
    ),
    Match.tag(
      "CampaignContentMissing",
      () =>
        new OperationConflict({
          code: "content-missing",
          message: "The campaign has no content in any locale.",
          cause,
        })
    ),
    Match.tag(
      "CampaignFallbackContentMissing",
      () =>
        new OperationConflict({
          code: "fallback-content-missing",
          message:
            "Customers without content in their language get the Czech version, so add Czech (cs-CZ) content, or restrict the audience to one locale the campaign has content for. Nothing was sent.",
          cause,
        })
    ),
    Match.tag(
      "CampaignAudienceMissing",
      () =>
        new OperationConflict({
          code: "campaign-audience-missing",
          message: "The campaign has no audience. Set one first.",
          cause,
        })
    ),
    Match.tag(
      "CampaignNoRecipients",
      () =>
        new OperationConflict({
          code: "no-recipients",
          message: "The campaign's audience doesn't reach any recipient.",
          cause,
        })
    ),
    Match.tag(
      "CampaignNotRetryable",
      ({ status }) =>
        new OperationConflict({
          code: "campaign-not-retryable",
          message: `Only a failed campaign can be retried, and this one is ${status}.`,
          cause,
        })
    ),
    Match.tag(
      "CampaignRecipientResolutionError",
      ({ source }) =>
        new OperationUnavailable({
          code: "recipient-resolution-unavailable",
          message: `Recipients couldn't be resolved because the ${source === "dotypos" ? "Dotypos API" : "database"} is unavailable. Try again shortly.`,
          cause,
        })
    ),
    Match.tag(
      "CampaignEmailDeliveryFailed",
      () =>
        new OperationUnavailable({
          code: "email-delivery-failed",
          message: "The test email couldn't be sent. Try again shortly.",
          cause,
        })
    ),
    Match.tag(
      "CampaignDeliveryQueueFailed",
      () =>
        new OperationUnavailable({
          code: "delivery-queue-failed",
          message:
            "The send was confirmed, but its delivery couldn't be queued. The campaign is now failed; retry its undelivered recipients.",
          cause,
        })
    ),
    Match.orElse(toSetupOperationError)
  );

/** Campaign sending setup the deployment lacks, else a generic outage. */
const toSetupOperationError = (
  cause: CampaignOperationCause
): CampaignOperationError =>
  Match.value(cause).pipe(
    Match.tag(
      "CampaignEmailNotConfigured",
      ({ variables }) =>
        new OperationUnavailable({
          code: "email-not-configured",
          message: `Campaign email isn't configured for this deployment, so it can't send campaign mail. Ask a developer to set ${variables.join(", ")}.`,
          cause,
        })
    ),
    Match.tag(
      "CampaignSigningKeyInvalid",
      () =>
        new OperationUnavailable({
          code: "signing-key-invalid",
          message:
            "Confirmation codes can't be issued or checked because the signing secret is misconfigured. Ask a developer to check BETTER_AUTH_SECRETS.",
          cause,
        })
    ),
    Match.orElse(
      () =>
        new OperationUnavailable({
          code: "service-unavailable",
          message: "The campaign service is temporarily unavailable.",
          cause,
        })
    )
  );
