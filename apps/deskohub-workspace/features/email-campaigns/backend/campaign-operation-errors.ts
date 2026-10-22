import {
  type CampaignOperationError,
  emailAutomationScheduleMinutes,
  OperationConflict,
  OperationInputInvalid,
  OperationNotFound,
  OperationUnavailable,
} from "@deskohub/workspace-admin-api";
import { Match } from "effect";
import type { CalendarExpressionNeverOccurs } from "@/shared/utils/calendar-expression";
import type { AutomationUnitFetchFailure } from "../automation/backend/automation-unit-handler";
import {
  AutomationArchived,
  AutomationCalendarNeverOccurs,
  type AutomationConditionAudienceMissing,
  AutomationDraftChanged,
  type AutomationFlowInvalid,
  type AutomationFlowLocation,
  AutomationPageCursorInvalid,
  AutomationPreviewNotFound,
  AutomationPreviewRequired,
  AutomationRunNotFound,
  AutomationScheduleMinutesNotAllowed,
  AutomationStatusConflict,
  type AutomationVersionNotFound,
} from "../automation/errors";
import {
  AudienceFilterCampaignNotFound,
  type AudienceFilterContextInvalid,
  type CampaignAudienceArchived,
  CampaignAudienceInUse,
  type CampaignAudienceMissing,
  type CampaignAudienceNotFound,
  CampaignBodyDocumentInvalid,
  CampaignBodyMarkdownInvalid,
  type CampaignConfirmationRejected,
  type CampaignContentInvalid,
  type CampaignContentMissing,
  CampaignDeliveryMismatch,
  type CampaignDeliveryQueueFailed,
  type CampaignEmailDeliveryFailed,
  type CampaignEmailNotConfigured,
  type CampaignFallbackContentMissing,
  CampaignLocaleContentMissing,
  type CampaignNoRecipients,
  type CampaignNotFound,
  type CampaignNotRetryable,
  CampaignPublished,
  CampaignReadOnly,
  type CampaignRecipientResolutionError,
  type CampaignRecipientsOutsideTestDomain,
  type CampaignSigningKeyInvalid,
  type CampaignTestRecipientInvalid,
} from "../errors";

/**
 * Every failure a campaign operation handler can raise: a domain error, a
 * port error a handler raises itself, or an infrastructure failure.
 */
export type CampaignOperationCause =
  | CampaignOperationError
  | AudienceFilterCampaignNotFound
  | AutomationArchived
  | AutomationCalendarNeverOccurs
  | AutomationDraftChanged
  | AutomationPageCursorInvalid
  | AutomationPreviewNotFound
  | AutomationPreviewRequired
  | AutomationRunNotFound
  | AutomationScheduleMinutesNotAllowed
  | AutomationStatusConflict
  | AutomationVersionNotFound
  | CalendarExpressionNeverOccurs
  | AutomationConditionAudienceMissing
  | AutomationFlowInvalid
  | AutomationUnitFetchFailure
  | AudienceFilterContextInvalid
  | CampaignAudienceArchived
  | CampaignAudienceInUse
  | CampaignAudienceMissing
  | CampaignAudienceNotFound
  | CampaignBodyDocumentInvalid
  | CampaignBodyMarkdownInvalid
  | CampaignConfirmationRejected
  | CampaignContentInvalid
  | CampaignContentMissing
  | CampaignDeliveryMismatch
  | CampaignDeliveryQueueFailed
  | CampaignEmailDeliveryFailed
  | CampaignEmailNotConfigured
  | CampaignFallbackContentMissing
  | CampaignLocaleContentMissing
  | CampaignNoRecipients
  | CampaignNotFound
  | CampaignNotRetryable
  | CampaignPublished
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
      "CampaignBodyMarkdownInvalid",
      ({ locale, cause: invalid }) =>
        new OperationInputInvalid({
          code: CampaignBodyMarkdownInvalid.code,
          message: `The ${locale} body isn't valid campaign Markdown: ${invalid.message}`,
          cause,
        })
    ),
    Match.tag(
      "CampaignBodyDocumentInvalid",
      ({ locale, cause: invalid }) =>
        new OperationInputInvalid({
          code: CampaignBodyDocumentInvalid.code,
          message: `The ${locale} body document breaks the campaign content rules: ${invalid.message}`,
          cause,
        })
    ),
    Match.tag(
      "CampaignLocaleContentMissing",
      ({ locale }) =>
        new OperationInputInvalid({
          code: CampaignLocaleContentMissing.code,
          message: `The campaign has no ${locale} content yet, so it needs a subject and a body.`,
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
          ].join(", ")}, which only automation conditions can use.`,
          cause,
        })
    ),
    Match.tag(
      "AudienceFilterCampaignNotFound",
      ({ campaignIds }) =>
        new OperationInputInvalid({
          code: AudienceFilterCampaignNotFound.code,
          message: `The audience filter counts emails of campaigns that don't exist (${campaignIds.join(", ")}).`,
          cause,
        })
    ),
    Match.tag(
      "CampaignReadOnly",
      ({ status }) =>
        new OperationConflict({
          code: CampaignReadOnly.code,
          message: `The campaign is ${status}, so it can no longer be changed.`,
          cause,
        })
    ),
    Match.tag(
      "CampaignDeliveryMismatch",
      ({ delivery }) =>
        new OperationConflict({
          code: CampaignDeliveryMismatch.code,
          message:
            delivery === "automated"
              ? "This campaign sends automatically, so it can't be test sent, sent, or retried like a one-off campaign."
              : "This is a one-off campaign, so it has no automation. Create an automated campaign instead.",
          cause,
        })
    ),
    Match.tag(
      "CampaignAudienceInUse",
      ({ draftCampaignIds, automationCampaignIds = [] }) =>
        new OperationConflict({
          code: CampaignAudienceInUse.code,
          message: [
            draftCampaignIds.length > 0
              ? `Draft campaigns use this audience (${draftCampaignIds.join(", ")}).`
              : undefined,
            automationCampaignIds.length > 0
              ? `Automation conditions refer to it (${automationCampaignIds.join(", ")}).`
              : undefined,
            "Archive it instead, or move those campaigns to another audience.",
          ]
            .filter((sentence) => sentence !== undefined)
            .join(" "),
          cause,
        })
    ),
    Match.tag(
      "CampaignPublished",
      () =>
        new OperationConflict({
          code: CampaignPublished.code,
          message:
            "This automation has a published version, so it can't be deleted. Archive it instead.",
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

/** Minutes past the hour as ":00, :15, and :30". */
const minutesPastTheHour = (minutes: readonly number[]) =>
  new Intl.ListFormat("en", { type: "conjunction" }).format(
    minutes.map((minute) => `:${String(minute).padStart(2, "0")}`)
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
      "AutomationScheduleMinutesNotAllowed",
      ({ minutes }) =>
        new OperationInputInvalid({
          code: AutomationScheduleMinutesNotAllowed.code,
          message: `The schedule trigger fires at ${minutesPastTheHour(minutes)}. A schedule can fire only at ${minutesPastTheHour(emailAutomationScheduleMinutes)}.`,
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
    Match.tag(
      "CalendarExpressionNeverOccurs",
      () =>
        new OperationInputInvalid({
          code: AutomationCalendarNeverOccurs.code,
          message:
            "The calendar never happens in the next 8 years. Choose another combination.",
          cause,
        })
    ),
    Match.orElse(toAutomationLifecycleOperationError)
  );

/** Refusals of the automation lifecycle, its versions and its run log. */
const toAutomationLifecycleOperationError = (
  cause: CampaignOperationCause
): CampaignOperationError =>
  Match.value(cause).pipe(
    Match.tag(
      "AutomationPreviewRequired",
      () =>
        new OperationConflict({
          code: AutomationPreviewRequired.code,
          message:
            "Activation needs a completed dry run of this automation's current draft. Run a dry run and wait for it to complete.",
          cause,
        })
    ),
    Match.tag(
      "AutomationDraftChanged",
      () =>
        new OperationConflict({
          code: AutomationDraftChanged.code,
          message:
            "The flow or the audience changed after this dry run. Run a new dry run, then activate with it.",
          cause,
        })
    ),
    Match.tag(
      "AutomationArchived",
      () =>
        new OperationConflict({
          code: AutomationArchived.code,
          message:
            "The automation is archived and can't change any more. Duplicate the campaign to start again.",
          cause,
        })
    ),
    Match.tag(
      "AutomationStatusConflict",
      ({ operation, status }) =>
        new OperationConflict({
          code: AutomationStatusConflict.code,
          message:
            operation === "pause"
              ? `Only an active automation can be paused, and this one is ${status}.`
              : `Only a paused automation can be resumed, and this one is ${status}.`,
          cause,
        })
    ),
    Match.tag(
      "AutomationVersionNotFound",
      ({ versionNumber }) =>
        new OperationNotFound({
          code: "automation-version-not-found",
          message: `The automation has no version ${versionNumber}.`,
          cause,
        })
    ),
    Match.tag(
      "AutomationPreviewNotFound",
      () =>
        new OperationNotFound({
          code: AutomationPreviewNotFound.code,
          message:
            "The dry run was not found. Dry runs are kept for 24 hours; start a new one.",
          cause,
        })
    ),
    Match.tag(
      "AutomationRunNotFound",
      () =>
        new OperationNotFound({
          code: AutomationRunNotFound.code,
          message: "The automation run was not found.",
          cause,
        })
    ),
    Match.tag(
      "AutomationPageCursorInvalid",
      () =>
        new OperationInputInvalid({
          code: AutomationPageCursorInvalid.code,
          message:
            "The page cursor is invalid. Start again from the first page.",
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
