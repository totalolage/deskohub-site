import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const webhookServicePath = join(import.meta.dirname, "nexi-webhook.service.ts");

describe("NexiWebhookService", () => {
  test("links received webhook rows to resolved payment attempts", () => {
    const source = readFileSync(webhookServicePath, "utf8");

    expect(source).toContain(".linkPaymentAttempt({");
    expect(source).toContain("paymentAttemptId: attempt.id");
  });

  test("marks paid fulfillment failures failed instead of processed", () => {
    const source = readFileSync(webhookServicePath, "utf8");

    expect(source).toContain('errorCode: "nexi_webhook_fulfillment_failed"');
    expect(source).toContain("failAfterMarkingEvent(");
    expect(source).toContain(
      "yield* webhookEvents\n            .markProcessed({"
    );
  });
});
