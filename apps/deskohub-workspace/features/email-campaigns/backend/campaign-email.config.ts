import "server-only";

import type { EmailRecipient } from "@deskohub/email";
import { EMAIL_TEST_DOMAIN } from "@deskohub/test-email";
import { Context, Effect, Layer } from "effect";
import { env } from "@/env";
import type { DeploymentEnvironment } from "@/shared/backend/config/deployment-request-timeout";
import { workspaceSiteConstants } from "@/shared/utils";
import { CampaignEmailNotConfigured } from "../errors";

export interface ICampaignEmailConfig {
  readonly deploymentEnvironment: DeploymentEnvironment;
  readonly from: EmailRecipient;
  readonly replyTo: EmailRecipient;
  /** Always receives a test send; the admin can't remove it. */
  readonly adminInbox: string;
}

/** Campaign sender, reply-to, and admin inbox for the running deployment. */
export class CampaignEmailConfig extends Context.Service<
  CampaignEmailConfig,
  ICampaignEmailConfig
>()("@deskohub-workspace/email-campaigns/CampaignEmailConfig") {
  static Default = Layer.effect(
    this,
    Effect.suspend(() =>
      resolveCampaignEmailConfig({
        deploymentEnvironment: env.VERCEL_ENV,
        EMAIL_CAMPAIGN_FROM: env.EMAIL_CAMPAIGN_FROM,
        EMAIL_CAMPAIGN_REPLY_TO: env.EMAIL_CAMPAIGN_REPLY_TO,
        EMAIL_CAMPAIGN_ADMIN_INBOX: env.EMAIL_CAMPAIGN_ADMIN_INBOX,
      })
    )
  );
}

const campaignEmailVariables = [
  "EMAIL_CAMPAIGN_FROM",
  "EMAIL_CAMPAIGN_REPLY_TO",
  "EMAIL_CAMPAIGN_ADMIN_INBOX",
] as const;

/**
 * Production needs every campaign address configured. Elsewhere a missing
 * address falls back to the email test domain, whose mail only reaches the
 * Console provider.
 */
export const resolveCampaignEmailConfig = (
  input: {
    readonly deploymentEnvironment: DeploymentEnvironment;
  } & Readonly<
    Record<(typeof campaignEmailVariables)[number], string | undefined>
  >
): Effect.Effect<ICampaignEmailConfig, CampaignEmailNotConfigured> => {
  const missing = campaignEmailVariables.filter((name) => !input[name]);
  if (input.deploymentEnvironment === "production" && missing.length > 0) {
    return Effect.fail(new CampaignEmailNotConfigured({ variables: missing }));
  }
  const from = input.EMAIL_CAMPAIGN_FROM ?? `campaigns@${EMAIL_TEST_DOMAIN}`;
  return Effect.succeed({
    deploymentEnvironment: input.deploymentEnvironment,
    from: { email: from, name: workspaceSiteConstants.brand.name },
    replyTo: { email: input.EMAIL_CAMPAIGN_REPLY_TO ?? from },
    adminInbox:
      input.EMAIL_CAMPAIGN_ADMIN_INBOX ?? `campaign-admin@${EMAIL_TEST_DOMAIN}`,
  });
};

/**
 * The settings the composer shows. The test-send inbox is null where campaign
 * email isn't configured: the composer still loads, and a test send reports
 * the missing settings.
 */
export const toCampaignSettings = (
  config: Effect.Effect<ICampaignEmailConfig, CampaignEmailNotConfigured>
) =>
  config.pipe(
    Effect.map(({ adminInbox }) => ({ testSendInbox: adminInbox })),
    Effect.catchTag("CampaignEmailNotConfigured", () =>
      Effect.succeed({ testSendInbox: null })
    )
  );
