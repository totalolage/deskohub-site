import "@/shared/testing/workspace-test-env";

import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import { inArray } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { workspaceReservations } from "@/db/schema";
import { env } from "@/env";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import {
  WorkspaceReservationRepository,
  type IWorkspaceReservationRepository as WorkspaceReservationRepositoryType,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { POST } from "./route";

const realResendModule = await import(
  pathToFileURL(createRequire(import.meta.url).resolve("resend")).href
);
mock.module("resend", () => realResendModule);

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

const signResendWebhookPayload = (input: {
  readonly id: string;
  readonly timestamp: string;
  readonly payload: string;
}) => {
  const signingKey = Buffer.from(
    webhookSigningSecret.replace(/^whsec_/, ""),
    "base64"
  );
  return `v1,${createHmac("sha256", signingKey)
    .update(`${input.id}.${input.timestamp}.${input.payload}`)
    .digest("base64")}`;
};

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
  const id = `evt-${crypto.randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const request = new Request(
    "https://workspace.deskohub.test/api/webhooks/resend",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature":
          input.signature ??
          signResendWebhookPayload({ id, timestamp, payload: input.payload }),
      },
      body: input.payload,
    }
  );

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
    const postgres = postgresDatabase as WorkspacePostgresTestDatabase;
    let reservations: WorkspaceReservationRepositoryType;
    const fixtureReservationIds: WorkspaceReservationId[] = [];

    const insertProcessingPaidReservation = (id: WorkspaceReservationId) =>
      Effect.gen(function* () {
        yield* postgres.db.insert(workspaceReservations).values({
          id,
          checkoutAttemptKey: checkoutAttemptKeySchema.make(
            `attempt-${crypto.randomUUID()}`
          ),
          dotyposCustomerId: DotyposCustomerIdSchema.make(
            `customer-${crypto.randomUUID()}`
          ),
          dotyposReservationId: DotyposReservationIdSchema.make(
            `dotypos-reservation-${crypto.randomUUID()}`
          ),
          reservationState: "confirmed",
          paymentState: "paid",
          paidAt: Temporal.Instant.from("2026-01-01T11:55:00.000Z"),
          reservationConfirmedAt: Temporal.Instant.from(
            "2026-01-01T11:55:00.000Z"
          ),
          fulfillmentState: "processing",
          reservationDetails: {
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
          },
          locale: "en-US",
        });
        fixtureReservationIds.push(id);
      });

    beforeAll(async () => {
      reservations = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* WorkspaceReservationRepository;
        }).pipe(
          Effect.provide(
            WorkspaceReservationRepository.Default.pipe(
              Layer.provide(postgres.layer)
            )
          )
        )
      );
    });

    afterEach(async () => {
      if (fixtureReservationIds.length === 0) return;
      const ids = [...fixtureReservationIds];
      fixtureReservationIds.length = 0;
      await Effect.runPromise(
        postgres.db
          .delete(workspaceReservations)
          .where(inArray(workspaceReservations.id, ids))
      );
    });

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

    test("processes the same signed delivery webhook once the delivery is attached", async () => {
      const reservationId = newRouteReservationId();
      const emailId = newRouteEmailId();
      const payload = deliveredEventPayload({
        emailId,
        workspaceReservationId: reservationId,
      });
      await Effect.runPromise(insertProcessingPaidReservation(reservationId));

      const firstAttempt = await sendResendWebhook({ payload });
      expect(firstAttempt.response.status).toBe(500);
      expect(firstAttempt.body.code).toBe("resend_webhook_delivery_unattached");

      await Effect.runPromise(
        reservations.markAwaitingCustomerEmailDelivery({
          id: reservationId,
          customerEmailDeliveryId: emailId,
        })
      );

      const retry = await sendResendWebhook({ payload });

      expect(retry.response.status).toBe(200);
      expect(retry.body).toEqual({
        message: "Webhook received",
        status: "processed",
      });

      const stored = await Effect.runPromise(
        reservations.findById(reservationId)
      );
      expect(stored?.fulfillmentState).toBe("fulfilled");
      expect(stored?.activeCustomerEmailDeliveryId).toEqual(emailId);
      expect(
        stored?.fulfilledAt?.equals(Temporal.Instant.from(deliveryCreatedAt))
      ).toBe(true);
    });
  }
);
