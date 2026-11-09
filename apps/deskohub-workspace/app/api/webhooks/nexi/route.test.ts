import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import type { INexiWebhookService } from "@/features/checkout/backend/payment/nexi-webhook.service";

const nexiWebhookModule = await import(
  "@/features/checkout/backend/payment/nexi-webhook.service"
);
const { NexiWebhookProcessingError } = nexiWebhookModule;

type NexiWebhookFailureCode = InstanceType<
  typeof NexiWebhookProcessingError
>["errorCode"];

let failureCode: NexiWebhookFailureCode | undefined;
const notifications: Parameters<
  INexiWebhookService["processNotification"]
>[0][] = [];

const FakeNexiWebhookService = Context.Service<
  FakeNexiWebhookService,
  INexiWebhookService
>()("@test/FakeNexiWebhookService");

Object.assign(FakeNexiWebhookService, {
  Live: Layer.succeed(FakeNexiWebhookService, {
    processNotification: (payload) => {
      notifications.push(payload);
      return failureCode
        ? Effect.fail(
            new NexiWebhookProcessingError({
              errorCode: failureCode,
              message: "Nexi webhook test failure",
            })
          )
        : Effect.succeed({ status: "accepted" as const });
    },
  }),
});

mock.module("@/features/checkout/backend/payment/nexi-webhook.service", () => ({
  ...nexiWebhookModule,
  NexiWebhookService: FakeNexiWebhookService,
}));

const { POST } = await import("./route");

const notify = (body: string) =>
  POST(
    new Request("https://workspace.test/api/webhooks/nexi", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    })
  );

describe("POST /api/webhooks/nexi", () => {
  beforeEach(() => {
    failureCode = undefined;
    notifications.length = 0;
  });

  test("acknowledges a processed notification with its status", async () => {
    const response = await notify('{"event":"payment.charge.created.v2"}');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      '{"message":"Webhook received","status":"accepted"}'
    );
    expect(notifications).toEqual([{ event: "payment.charge.created.v2" }]);
  });

  test("rejects a body that is not JSON without processing it", async () => {
    const response = await notify("not json");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Webhook processing failed",
      code: "nexi_webhook_parse_failed",
    });
    expect(notifications).toHaveLength(0);
  });

  test("declines a security token mismatch so Nexi stops retrying", async () => {
    failureCode = "nexi_webhook_verification_mismatch";

    const response = await notify("{}");

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      error: "Webhook processing failed",
      code: "nexi_webhook_verification_mismatch",
    });
  });

  test("asks Nexi to retry a notification whose fulfillment failed", async () => {
    failureCode = "nexi_webhook_fulfillment_failed";

    const response = await notify("{}");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Webhook processing failed",
      code: "nexi_webhook_fulfillment_failed",
    });
  });
});
