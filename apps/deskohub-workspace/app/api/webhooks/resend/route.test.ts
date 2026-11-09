import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import { Effect } from "effect";
import { customerMarketingConsents } from "@/db/schema";
import {
  createWorkspaceEnv,
  env,
  getAccountingDocumentSnapshotSecret,
} from "@/env";
import {
  deleteCampaigns,
  seedCampaignSend,
} from "@/features/email-campaigns/backend/email-campaigns.test-utils";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  restoreRealResendModule,
  signedResendWebhookRequest,
} from "@/shared/backend/email/delivery-reports.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";

// Resend webhooks verify through a Resend client, which needs an API key the
// test environment deliberately omits; stub one before the route reads env.
mock.module("@/env", () => ({
  createWorkspaceEnv,
  env: new Proxy(env, {
    get: (target, key) =>
      key === "EMAIL_API_KEY" ? "re_test" : Reflect.get(target, key),
  }),
  getAccountingDocumentSnapshotSecret,
}));

const { POST } = await import("./route");

await restoreRealResendModule();

const webhookSigningSecret = env.RESEND_WEBHOOK_SECRET;
if (!webhookSigningSecret) {
  throw new Error(
    "The workspace test environment must set RESEND_WEBHOOK_SECRET."
  );
}

const deliveryCreatedAt = "2026-01-01T12:05:00.000Z";

const deliveredEventPayload = (input: {
  readonly emailId: string;
  readonly workspaceReservationId: string;
}) =>
  JSON.stringify({
    type: "email.delivered",
    created_at: deliveryCreatedAt,
    data: {
      email_id: input.emailId,
      tags: [
        { name: "source", value: "workspace-paid-fulfillment" },
        { name: "category", value: "workspace-paid-reservation-access" },
        { name: "deploymentEnvironment", value: env.VERCEL_ENV },
        { name: "workspaceReservationId", value: input.workspaceReservationId },
      ],
    },
  });

interface ResendWebhookResponseBody {
  readonly error?: string;
  readonly code?: string;
  readonly message?: string;
  readonly status?: string;
  readonly reason?: string;
}

const sendResendWebhook = async (input: {
  readonly payload: string;
  readonly signature?: string;
}) => {
  const { request } = signedResendWebhookRequest({
    secret: webhookSigningSecret,
    ...input,
  });

  const response = await POST(request);
  return {
    response,
    body: (await response.json()) as ResendWebhookResponseBody,
  };
};

const newRouteReservationId = () =>
  workspaceReservationIdSchema.make(`reservation-${crypto.randomUUID()}`);
const newRouteEmailId = () =>
  EmailDeliveryIdSchema.make(`resend-${crypto.randomUUID()}`);

describe("POST /api/webhooks/resend signature boundary", () => {
  test("rejects a delivery webhook whose Svix signature does not verify", async () => {
    const payload = deliveredEventPayload({
      emailId: newRouteEmailId(),
      workspaceReservationId: newRouteReservationId(),
    });

    const { response, body } = await sendResendWebhook({
      payload,
      signature: "v1,",
    });

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: "Webhook processing failed",
      code: "resend_webhook_verification_failed",
    });
  });
});

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!postgresDatabase)(
  "POST /api/webhooks/resend with Postgres",
  () => {
    test("maps a signed delivery webhook for an unattached delivery to a retryable 500", async () => {
      const payload = deliveredEventPayload({
        emailId: newRouteEmailId(),
        workspaceReservationId: newRouteReservationId(),
      });

      const { response, body } = await sendResendWebhook({ payload });

      expect(response.status).toBe(500);
      expect(body).toEqual({
        error: "Webhook processing failed",
        code: "resend_webhook_delivery_unattached",
      });
    });

    test("records a campaign bounce on the recipient and leaves consent alone", async () => {
      if (!postgresDatabase) return;
      const dotyposCustomerId = DotyposCustomerIdSchema.make(
        `webhook-${crypto.randomUUID()}`
      );
      const emailId = newRouteEmailId();
      const { campaignId, sendId } = await seedCampaignSend(
        postgresDatabase.db,
        {
          purpose: "marketing",
          status: "sent",
          recipients: [
            { dotyposCustomerId, status: "sent", providerMessageId: emailId },
          ],
        }
      );
      await Effect.runPromise(
        postgresDatabase.db.insert(customerMarketingConsents).values({
          dotyposCustomerId,
          documentHash: "hash",
          locale: "cs-CZ",
          grantedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
        })
      );

      try {
        const { response, body } = await sendResendWebhook({
          payload: JSON.stringify({
            type: "email.bounced",
            created_at: deliveryCreatedAt,
            data: {
              email_id: emailId,
              tags: {
                category: "email-campaign",
                campaignSendId: sendId,
                dotyposCustomerId,
                deploymentEnvironment: env.VERCEL_ENV,
              },
            },
          }),
        });

        expect(response.status).toBe(200);
        expect(body.status).toBe("processed");
        const { rows: recipients } = await postgresDatabase.pool.query(
          "select status from email_campaign_recipients where send_id = $1",
          [sendId]
        );
        expect(recipients).toEqual([{ status: "bounced" }]);
        const { rows: consents } = await postgresDatabase.pool.query(
          "select withdrawn_at from customer_marketing_consents where dotypos_customer_id = $1",
          [dotyposCustomerId]
        );
        expect(consents).toEqual([{ withdrawn_at: null }]);
      } finally {
        await deleteCampaigns(postgresDatabase.pool, [campaignId]);
        await postgresDatabase.pool.query(
          "delete from customer_marketing_consents where dotypos_customer_id = $1",
          [dotyposCustomerId]
        );
      }
    });
  }
);
