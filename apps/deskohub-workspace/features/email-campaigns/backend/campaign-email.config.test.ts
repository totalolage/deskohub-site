import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { isTestEmailRecipient } from "@deskohub/email";
import { testEmailAddress } from "@deskohub/test-email";
import { Cause, Effect, Exit } from "effect";
import {
  resolveCampaignEmailConfig,
  toCampaignSettings,
} from "./campaign-email.config";

const unset = {
  EMAIL_CAMPAIGN_FROM: undefined,
  EMAIL_CAMPAIGN_REPLY_TO: undefined,
  EMAIL_CAMPAIGN_ADMIN_INBOX: undefined,
};

describe("resolveCampaignEmailConfig", () => {
  test("uses the configured sender, reply-to, and admin inbox", async () => {
    const config = await Effect.runPromise(
      resolveCampaignEmailConfig({
        deploymentEnvironment: "production",
        EMAIL_CAMPAIGN_FROM: testEmailAddress("news"),
        EMAIL_CAMPAIGN_REPLY_TO: testEmailAddress("hello"),
        EMAIL_CAMPAIGN_ADMIN_INBOX: testEmailAddress("admin"),
      })
    );

    expect(config).toMatchObject({
      from: { email: testEmailAddress("news") },
      replyTo: { email: testEmailAddress("hello") },
      adminInbox: testEmailAddress("admin"),
    });
  });

  test("refuses production campaign mail without its addresses", async () => {
    const exit = await Effect.runPromiseExit(
      resolveCampaignEmailConfig({
        deploymentEnvironment: "production",
        ...unset,
        EMAIL_CAMPAIGN_FROM: testEmailAddress("news"),
      })
    );

    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({
      _tag: "CampaignEmailNotConfigured",
      variables: ["EMAIL_CAMPAIGN_REPLY_TO", "EMAIL_CAMPAIGN_ADMIN_INBOX"],
    });
  });

  test("falls back to test-domain addresses outside production", async () => {
    const config = await Effect.runPromise(
      resolveCampaignEmailConfig({ deploymentEnvironment: "preview", ...unset })
    );

    expect(isTestEmailRecipient(config.adminInbox)).toBe(true);
    expect(isTestEmailRecipient(config.from.email)).toBe(true);
    expect(config.replyTo.email).toBe(config.from.email);
  });
});

describe("toCampaignSettings", () => {
  test("reports the admin inbox as the test-send inbox", async () => {
    const settings = await Effect.runPromise(
      toCampaignSettings(
        resolveCampaignEmailConfig({
          deploymentEnvironment: "production",
          EMAIL_CAMPAIGN_FROM: testEmailAddress("news"),
          EMAIL_CAMPAIGN_REPLY_TO: testEmailAddress("hello"),
          EMAIL_CAMPAIGN_ADMIN_INBOX: testEmailAddress("admin"),
        })
      )
    );

    expect(settings).toEqual({ testSendInbox: testEmailAddress("admin") });
  });

  test("reports no test-send inbox where campaign email isn't configured", async () => {
    const settings = await Effect.runPromise(
      toCampaignSettings(
        resolveCampaignEmailConfig({
          deploymentEnvironment: "production",
          ...unset,
        })
      )
    );

    expect(settings).toEqual({ testSendInbox: null });
  });
});
