import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, mock, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { type EmailMessage, EmailServiceTag } from "@deskohub/email";
import { resendSimulatorAddress, testEmailAddress } from "@deskohub/test-email";
import { ConfigProvider, Data, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { WorkspaceDatabase } from "@/db/database.service";
import { makeDatabaseClient } from "@/db/database-client";
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
const { campaignEmailKind, campaignTestEmailCategory } = await import(
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

/** A campaign test email, as the admin send-test action sends one. */
const campaignTestEmail = (): EmailMessage => ({
  from: { email: testEmailAddress("campaigns") },
  to: { email: resendSimulatorAddress("delivered", "ada") },
  subject: "[TEST] Autumn news",
  text: "Hello",
  tags: [campaignTestEmailCategory],
});

/** PostHog's answer: an accepted message id, or a refusal code. */
type PostHogAnswer =
  | { readonly message_id: string }
  | { readonly type: string; readonly code: string };

/** PostHog answering every send with `status` and `answer`. */
const postHogAnswering =
  (status: number, answer: PostHogAnswer): typeof globalThis.fetch =>
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

    /**
     * Like `WorkspaceDatabase.Default`, a layer that makes its own client each
     * time it is built, so only one shared build gives one client.
     */
    const databasePerBuild = Layer.effect(
      WorkspaceDatabase,
      Effect.map(makeDatabaseClient(testDatabase.pool), WorkspaceDatabase.make)
    );

    /**
     * Sends `message`, a campaign delivery unless given, through the
     * Workspace email layer, wrapped in `around` as a caller would, the way
     * campaign delivery composes the layer: the email layer and the caller
     * over the same database layer.
     */
    const sendCampaignDelivery = (
      fetch: typeof globalThis.fetch,
      around: <A, E, R>(
        send: Effect.Effect<A, E, R>
      ) => Effect.Effect<A, E, R | WorkspaceDatabase> = (send) => send,
      message: EmailMessage = campaignDelivery()
    ) =>
      Effect.runPromise(
        around(
          Effect.flatMap(EmailServiceTag, (email) => email.send(message))
        ).pipe(
          Effect.provide(
            makeWorkspaceEmailLayer(databasePerBuild).pipe(
              Layer.provideMerge(databasePerBuild)
            )
          ),
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

    test("tracks a campaign test email PostHog accepted, with only its category", async () => {
      const messageId = crypto.randomUUID();

      const sent = await sendCampaignDelivery(
        postHogAnswering(202, { message_id: messageId }),
        undefined,
        campaignTestEmail()
      );

      expect(sent).toMatchObject({ provider: "posthog", id: messageId });
      expect(await trackedDelivery(messageId)).toEqual([
        {
          category: campaignTestEmailCategory,
          tags: { category: campaignTestEmailCategory },
          status: "queued",
        },
      ]);
    });

    test("tracks a delivery sent inside a caller's transaction with that transaction", async () => {
      const committedId = crypto.randomUUID();
      const inTransaction = <A, E, R>(send: Effect.Effect<A, E, R>) =>
        Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
          transaction(send)
        );

      await sendCampaignDelivery(
        postHogAnswering(202, { message_id: committedId }),
        inTransaction
      );
      expect(await trackedDelivery(committedId)).toHaveLength(1);

      const rolledBackId = crypto.randomUUID();
      class CallerFailed extends Data.TaggedError("CallerFailed") {}
      await expect(
        sendCampaignDelivery(
          postHogAnswering(202, { message_id: rolledBackId }),
          (send) =>
            inTransaction(Effect.andThen(send, Effect.fail(new CallerFailed())))
        )
      ).rejects.toThrow();
      deliveryIds.push(rolledBackId);
      expect(await trackedDelivery(rolledBackId)).toEqual([]);
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
