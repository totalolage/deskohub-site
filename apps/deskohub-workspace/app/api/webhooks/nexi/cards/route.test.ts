import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { SavedCardService } from "@/features/account/backend/saved-card/saved-card.service";
import { processSavedCardWebhookRequest } from "./route";

// The parsed-path tests never reach the service; Layer.mock needs one member
// to build.
const unreachableSavedCards = Layer.mock(SavedCardService, {
  listCards: () => Effect.die("unreachable"),
});

const runWebhook = (request: Request) =>
  Effect.runPromise(
    processSavedCardWebhookRequest(request).pipe(
      Effect.provide(unreachableSavedCards) as Effect.Effect<
        Response,
        never,
        never
      >
    )
  );

describe("saved card cards webhook route", () => {
  test("malformed JSON answers the fixed 400 parse-failed body", async () => {
    const response = await runWebhook(
      new Request("https://local/api/webhooks/nexi/cards", {
        method: "POST",
        body: "{not-json",
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Webhook processing failed",
      code: "nexi_cards_webhook_parse_failed",
    });
  });

  test("a notification without a security token is ignored with 202", async () => {
    const response = await runWebhook(
      new Request("https://local/api/webhooks/nexi/cards", {
        method: "POST",
        body: JSON.stringify({
          operation: { orderId: "dhcardunknown1" },
        }),
      })
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      error: "Webhook processing failed",
      code: "nexi_cards_webhook_missing_security_token",
    });
  });
});
