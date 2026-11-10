import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, mock, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { type EmailMessage, EmailServiceTag } from "@deskohub/email";
import { resendSimulatorAddress, testEmailAddress } from "@deskohub/test-email";
import { ConfigProvider, Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";

mock.module("server-only", () => ({}));
mock.module("resend", () => ({
  Resend: class {
    emails = {
      send: async () => ({ data: { id: `resend-${crypto.randomUUID()}` } }),
    };
  },
}));

const { makeWorkspaceEmailLayer } = await import("./email.config");
const { campaignEmailKind } = await import(
  "@/features/email-campaigns/campaign-email-kind"
);
const { campaignSendIdSchema } = await import(
  "@/features/email-campaigns/campaign-identifiers"
);
const { emailKindTags } = await import("@/shared/backend/email/email-kind");

const testDatabase = await connectWorkspacePostgresTestDatabase();

const run = crypto.randomUUID().slice(0, 8);
const campaignSendId = campaignSendIdSchema.make(`send-${run}`);
const dotyposCustomerId = DotyposCustomerIdSchema.make(`customer-${run}`);

/** A campaign delivery, as the campaign engine sends one. */
const campaignDelivery = (): EmailMessage => ({
  from: { email: testEmailAddress("campaigns") },
  // A real destination, so the message goes through the provider chain.
  to: { email: resendSimulatorAddress("delivered", "ada") },
  subject: "Autumn news",
  text: "Hello",
  ...emailKindTags(campaignEmailKind, {
    campaignSendId,
    dotyposCustomerId,
    deploymentEnvironment: "preview",
  }),
});

/** PostHog answering every send with `status` and `answer`. */
const postHogAnswering =
  (status: number, answer: object): typeof globalThis.fetch =>
  async () =>
    Response.json(answer, { status });

describe.skipIf(!testDatabase)(
  "Workspace email layer on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const deliveryIds: string[] = [];

    afterAll(() =>
      testDatabase.pool.query(
        "delete from posthog_email_deliveries where message_id = any($1)",
        [deliveryIds]
      )
    );

    const sendCampaignDelivery = (fetch: typeof globalThis.fetch) =>
      Effect.runPromise(
        Effect.flatMap(EmailServiceTag, (email) =>
          email.send(campaignDelivery())
        ).pipe(
          Effect.provide(makeWorkspaceEmailLayer(testDatabase.layer)),
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromUnknown({
              EMAIL_API_KEY: "re_test",
              POSTHOG_EMAIL_SECRET_KEY: "phs_test",
              POSTHOG_API_HOST: "https://eu.i.posthog.com",
            })
          ),
          Effect.provideService(FetchHttpClient.Fetch, fetch)
        )
      ).then((sent) => {
        deliveryIds.push(sent.id);
        return sent;
      });

    const trackedDelivery = async (messageId: string) =>
      (
        await testDatabase.pool.query(
          "select category, tags, status from posthog_email_deliveries where message_id = $1",
          [messageId]
        )
      ).rows;

    test("tracks a campaign delivery PostHog accepted, with only the tags its reports read", async () => {
      const messageId = crypto.randomUUID();

      const sent = await sendCampaignDelivery(
        postHogAnswering(202, { message_id: messageId })
      );

      expect(sent).toMatchObject({ provider: "posthog", id: messageId });
      expect(await trackedDelivery(messageId)).toEqual([
        {
          category: campaignEmailKind.category,
          tags: {
            category: campaignEmailKind.category,
            deploymentEnvironment: "preview",
            campaignSendId,
            dotyposCustomerId,
          },
          status: "queued",
        },
      ]);
    });

    test("tracks nothing for a campaign delivery Resend took over", async () => {
      const sent = await sendCampaignDelivery(
        postHogAnswering(401, {
          type: "authentication_error",
          code: "authentication_failed",
        })
      );

      expect(sent.provider).toBe("resend");
      expect(await trackedDelivery(sent.id)).toEqual([]);
    });
  }
);
