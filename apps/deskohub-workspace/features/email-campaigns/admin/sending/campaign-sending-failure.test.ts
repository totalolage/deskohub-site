import { describe, expect, test } from "bun:test";
import { EMAIL_TEST_DOMAIN } from "@deskohub/test-email";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Config, ConfigProvider, Effect, PlatformError, Schema } from "effect";
import { SqlError } from "effect/unstable/sql";
import { WorkspaceUrlConfigError } from "@/shared/backend/config/workspace-url.config";
import {
  campaignAudienceIdSchema,
  campaignIdSchema,
} from "../../campaign-identifiers";
import {
  CampaignAudienceMissing,
  CampaignAudienceNotFound,
  CampaignConfirmationRejected,
  CampaignContentMissing,
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
} from "../../errors";
import { describeCampaignSendingFailure } from "./campaign-sending-failure";

const campaignId = campaignIdSchema.make("synthetic-campaign");
const unexpectedFailure = "Something went wrong. Try again in a moment.";
const configError = await Effect.runPromise(
  Effect.flip(
    Config.string("SYNTHETIC_MISSING").parse(ConfigProvider.fromUnknown({}))
  )
);
const schemaError = await Effect.runPromise(
  Effect.flip(Schema.decodeUnknownEffect(Schema.String)(1))
);

// The administrator authorization error is module-private; actions.test.ts
// covers its copy through the real authorization check.
const failureCases = [
  {
    name: "unknown confirmation code",
    error: new CampaignConfirmationRejected({
      campaignId,
      reason: "unknown-code",
    }),
    message:
      "That code doesn't match the latest test email. Check it for typos and try again.",
  },
  {
    name: "superseded confirmation code",
    error: new CampaignConfirmationRejected({
      campaignId,
      reason: "superseded",
    }),
    message:
      "A newer test email replaced that code. Use the code from the latest test email.",
  },
  {
    name: "expired confirmation code",
    error: new CampaignConfirmationRejected({ campaignId, reason: "expired" }),
    message: "That code expired. Send a new test email to get a fresh code.",
  },
  {
    name: "changed campaign content",
    error: new CampaignConfirmationRejected({
      campaignId,
      reason: "content-changed",
    }),
    message:
      "The campaign changed after that test email. Send a new test email and use its code.",
  },
  {
    name: "confirmation attempts exceeded",
    error: new CampaignConfirmationRejected({
      campaignId,
      reason: "too-many-attempts",
    }),
    message:
      "Too many wrong codes, so that code no longer works. Send a new test email to get a fresh code.",
  },
  {
    name: "campaign not found",
    error: new CampaignNotFound({ campaignId }),
    message: "This campaign no longer exists.",
  },
  {
    name: "campaign is read only",
    error: new CampaignReadOnly({ campaignId, status: "sent" }),
    message:
      "This campaign already left Draft. Duplicate it to send a new copy.",
  },
  {
    name: "invalid test recipient",
    error: new CampaignTestRecipientInvalid({
      email: "invalid-synthetic-address",
    }),
    message: "invalid-synthetic-address isn't a valid email address.",
  },
  {
    name: "missing content",
    error: new CampaignContentMissing({ campaignId }),
    message: "Add a subject and body in at least one language first.",
  },
  {
    name: "Czech fallback content missing",
    error: new CampaignFallbackContentMissing({ campaignId }),
    message:
      "Customers without content in their language get the Czech version, so add Czech content, or restrict the audience to one language this campaign has. Nothing was sent.",
  },
  {
    name: "test email refused",
    error: new CampaignEmailDeliveryFailed({ cause: "synthetic" }),
    message:
      "The email provider didn't accept the test email. Try again in a moment.",
  },
  {
    name: "invalid signing secret",
    error: new CampaignSigningKeyInvalid({
      message: "BETTER_AUTH_SECRETS is not configured.",
    }),
    message:
      "Confirmation codes can't be issued because the signing secret is misconfigured. Ask a developer to check BETTER_AUTH_SECRETS.",
  },
  {
    name: "unconfigured campaign email",
    error: new CampaignEmailNotConfigured({
      variables: ["EMAIL_CAMPAIGN_FROM", "EMAIL_CAMPAIGN_ADMIN_INBOX"],
    }),
    message:
      "Campaign email isn't configured for this deployment. Ask a developer to set EMAIL_CAMPAIGN_FROM, EMAIL_CAMPAIGN_ADMIN_INBOX.",
  },
  {
    name: "unconfigured site URL",
    error: new WorkspaceUrlConfigError({ message: "synthetic" }),
    message:
      "The test email couldn't be built because the site URL isn't configured. Ask a developer to check the deployment's URL settings.",
  },
  {
    name: "missing audience",
    error: new CampaignAudienceMissing({ campaignId }),
    message: "Choose an audience for this campaign before sending it.",
  },
  {
    name: "deleted audience",
    error: new CampaignAudienceNotFound({
      audienceId: campaignAudienceIdSchema.make("synthetic-audience"),
    }),
    message:
      "This campaign's audience no longer exists. Choose another audience; nothing was sent and the code still works.",
  },
  {
    name: "Dotypos unavailable during resolution",
    error: CampaignRecipientResolutionError.dotypos("synthetic"),
    message:
      "Recipients couldn't be resolved because Dotypos is unavailable. Nothing was sent and the code still works; try again in a moment.",
  },
  {
    name: "database unavailable during resolution",
    error: CampaignRecipientResolutionError.database("synthetic"),
    message:
      "Recipients couldn't be resolved because the database is unavailable. Nothing was sent and the code still works; try again in a moment.",
  },
  {
    name: "one recipient outside the test domain",
    error: new CampaignRecipientsOutsideTestDomain({ recipientCount: 1 }),
    message: `Outside production, campaign email can only go to @${EMAIL_TEST_DOMAIN} addresses, and 1 address is outside it. Nothing was sent.`,
  },
  {
    name: "multiple recipients outside the test domain",
    error: new CampaignRecipientsOutsideTestDomain({ recipientCount: 3 }),
    message: `Outside production, campaign email can only go to @${EMAIL_TEST_DOMAIN} addresses, and 3 addresses are outside it. Nothing was sent.`,
  },
  {
    name: "no reachable recipients",
    error: new CampaignNoRecipients({ campaignId }),
    message:
      "The audience has no reachable recipients right now, so nothing was sent.",
  },
  {
    name: "delivery queue failure",
    error: new CampaignDeliveryQueueFailed({ campaignId, cause: "synthetic" }),
    message:
      "Delivery couldn't be queued, so the campaign is marked Failed. Retry undelivered recipients in a moment.",
  },
  {
    name: "campaign not retryable",
    error: new CampaignNotRetryable({ campaignId, status: "sent" }),
    message: "Only a failed campaign can retry undelivered recipients.",
  },
  {
    name: "missing deployment configuration",
    error: configError,
    message:
      "Campaign sending isn't configured correctly for this deployment. Ask a developer to check its environment variables.",
  },
  {
    name: "schema failure",
    error: schemaError,
    message: unexpectedFailure,
  },
  {
    name: "platform failure",
    error: PlatformError.badArgument({
      module: "Crypto",
      method: "randomBytes",
    }),
    message: unexpectedFailure,
  },
  {
    name: "Drizzle query failure",
    error: new EffectDrizzleQueryError({
      query: "select 1",
      params: [],
      cause: new Error("synthetic"),
    }),
    message: unexpectedFailure,
  },
  {
    name: "SQL failure",
    error: new SqlError.SqlError({
      reason: new SqlError.UnknownError({
        cause: new Error("synthetic database failure"),
        message: "synthetic database failure",
        operation: "send",
      }),
    }),
    message: unexpectedFailure,
  },
] as const;

describe("describeCampaignSendingFailure", () => {
  test.each(failureCases)("describes $name", ({ error, message }) => {
    expect(describeCampaignSendingFailure(error, "en-US")).toBe(message);
  });

  test("describes failures in Czech with Czech plural forms", () => {
    expect(
      describeCampaignSendingFailure(
        new CampaignRecipientsOutsideTestDomain({ recipientCount: 3 }),
        "cs-CZ"
      )
    ).toBe(
      `Mimo produkci lze e-maily kampaní posílat jen na adresy @${EMAIL_TEST_DOMAIN} a 3 adresy mezi ně nepatří. Nic nebylo odesláno.`
    );
    expect(
      describeCampaignSendingFailure(
        new CampaignRecipientsOutsideTestDomain({ recipientCount: 5 }),
        "cs-CZ"
      )
    ).toBe(
      `Mimo produkci lze e-maily kampaní posílat jen na adresy @${EMAIL_TEST_DOMAIN} a 5 adres mezi ně nepatří. Nic nebylo odesláno.`
    );
  });
});
