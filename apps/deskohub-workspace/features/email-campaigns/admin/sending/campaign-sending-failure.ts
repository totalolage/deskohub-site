import { EMAIL_TEST_DOMAIN } from "@deskohub/test-email";
import { type Effect, type Layer, Match } from "effect";
import type { requireAdministratorAuthorization } from "@/features/administrators/server/administrator-authorization.server";
import type {
  CampaignService,
  ICampaignService,
} from "../../backend/campaign.service";
import type { ICampaignSendService } from "../../backend/campaign-send.service";
import type { CampaignConfirmationRejection } from "../../errors";

const confirmationRejectionMessages = {
  "unknown-code":
    "That code doesn't match the latest test email. Check it for typos and try again.",
  superseded:
    "A newer test email replaced that code. Use the code from the latest test email.",
  expired: "That code expired. Send a new test email to get a fresh code.",
  "content-changed":
    "The campaign changed after that test email. Send a new test email and use its code.",
  "too-many-attempts":
    "Too many wrong codes, so that code no longer works. Send a new test email to get a fresh code.",
} as const satisfies Record<CampaignConfirmationRejection, string>;

const unexpectedFailureMessage = "Something went wrong. Try again in a moment.";

/** Every failure a sending action can report, including service setup. */
export type CampaignSendingFailure =
  | Effect.Error<typeof requireAdministratorAuthorization>
  | Effect.Error<ReturnType<ICampaignSendService["testSend"]>>
  | Effect.Error<ReturnType<ICampaignSendService["send"]>>
  | Effect.Error<ReturnType<ICampaignSendService["retryUndelivered"]>>
  | Effect.Error<ReturnType<ICampaignService["duplicate"]>>
  | Layer.Error<typeof CampaignService.Live>;

/** Admin copy for every failure a sending action reports. */
export const describeCampaignSendingFailure = (cause: CampaignSendingFailure) =>
  Match.value(cause).pipe(
    Match.tagsExhaustive({
      AdministratorUnauthorizedError: () =>
        "Your admin sign-in is no longer valid. Reload the page and sign in again.",
      CampaignNotFound: () => "This campaign no longer exists.",
      CampaignReadOnly: () =>
        "This campaign already left Draft. Duplicate it to send a new copy.",
      CampaignConfirmationRejected: ({ reason }) =>
        confirmationRejectionMessages[reason],
      CampaignTestRecipientInvalid: ({ email }) =>
        `${email} isn't a valid email address.`,
      CampaignContentMissing: () =>
        "Add a subject and body in at least one language first.",
      CampaignFallbackContentMissing: () =>
        "Customers without content in their language get the Czech version, so add Czech content, or restrict the audience to one language this campaign has. Nothing was sent.",
      CampaignEmailDeliveryFailed: () =>
        "The email provider didn't accept the test email. Try again in a moment.",
      CampaignSigningKeyInvalid: () =>
        "Confirmation codes can't be issued because the signing secret is misconfigured. Ask a developer to check BETTER_AUTH_SECRETS.",
      CampaignEmailNotConfigured: ({ variables }) =>
        `Campaign email isn't configured for this deployment. Ask a developer to set ${variables.join(", ")}.`,
      WorkspaceUrlConfigError: () =>
        "The test email couldn't be built because the site URL isn't configured. Ask a developer to check the deployment's URL settings.",
      CampaignAudienceMissing: () =>
        "Choose an audience for this campaign before sending it.",
      CampaignAudienceNotFound: () =>
        "This campaign's audience no longer exists. Choose another audience; nothing was sent and the code still works.",
      CampaignRecipientResolutionError: ({ source }) =>
        `Recipients couldn't be resolved because ${{ dotypos: "Dotypos", database: "the database" }[source]} is unavailable. Nothing was sent and the code still works; try again in a moment.`,
      CampaignRecipientsOutsideTestDomain: ({ recipientCount }) =>
        `Outside production, campaign email can only go to @${EMAIL_TEST_DOMAIN} addresses, and ${recipientCount} ${recipientCount === 1 ? "address is" : "addresses are"} outside it. Nothing was sent.`,
      CampaignNoRecipients: () =>
        "The audience has no reachable recipients right now, so nothing was sent.",
      CampaignDeliveryQueueFailed: () =>
        "Delivery couldn't be queued, so the campaign is marked Failed. Retry undelivered recipients in a moment.",
      CampaignNotRetryable: () =>
        "Only a failed campaign can retry undelivered recipients.",
      ConfigError: () =>
        "Campaign sending isn't configured correctly for this deployment. Ask a developer to check its environment variables.",
      PlatformError: () => unexpectedFailureMessage,
      SchemaError: () => unexpectedFailureMessage,
      EffectDrizzleQueryError: () => unexpectedFailureMessage,
      SqlError: () => unexpectedFailureMessage,
    })
  );
