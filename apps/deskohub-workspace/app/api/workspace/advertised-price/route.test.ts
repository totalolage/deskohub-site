import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { CheckoutPricingServiceMock } from "@/features/checkout/backend/checkout/checkout-pricing.service.mock";
import { buildWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote.test-utils";
import { DiscountCalculationError } from "@/features/discounts/errors";

mock.module("server-only", () => ({}));

const { makeWorkspaceAdvertisedPricePost } = await import(
  "@/features/checkout/backend/checkout/workspace-advertised-price-route.server"
);

const quoteAdvertisement = mock(({ reservation }) =>
  Effect.succeed(buildWorkspaceCheckoutQuote(reservation))
);
const POST = makeWorkspaceAdvertisedPricePost(
  CheckoutPricingServiceMock({ quoteAdvertisement })
);

const requestBody = {
  locale: "en-US",
  reservation: {
    kind: "cowork",
    details: {
      entryTier: "basic",
      coffee: true,
      date: "2099-07-30",
    },
  },
};

const request = (body: unknown, signal?: AbortSignal) =>
  new Request("https://deskohub.test/api/workspace/advertised-price", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

describe("Workspace advertised price route", () => {
  test("returns a private no-store response for a strict PII-free request", async () => {
    const response = await POST(request(requestBody));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body).toMatchObject({
      quote: {
        order: { entryTier: "basic", coffee: true },
        summary: { total: { value: 40_000, exponent: 2, currency: "CZK" } },
      },
    });
    expect(body.advertisedPriceToken).toBeString();
    expect(quoteAdvertisement).toHaveBeenCalledWith({
      reservation: requestBody.reservation.details,
      locale: "en-US",
    });
  });

  test("rejects contact data before invoking advertisement discovery", async () => {
    quoteAdvertisement.mockClear();
    const response = await POST(
      request({
        ...requestBody,
        reservation: {
          ...requestBody.reservation,
          customerEmail: "ada@example.test",
        },
      })
    );

    expect(response.status).toBe(400);
    expect(quoteAdvertisement).not.toHaveBeenCalled();
  });

  test("rejects malformed JSON before invoking advertisement discovery", async () => {
    quoteAdvertisement.mockClear();
    const response = await POST(
      new Request("https://deskohub.test/api/workspace/advertised-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      })
    );

    expect(response.status).toBe(400);
    expect(quoteAdvertisement).not.toHaveBeenCalled();
  });

  test("maps application failures to a safe 500 response", async () => {
    const failedPOST = makeWorkspaceAdvertisedPricePost(
      CheckoutPricingServiceMock({
        quoteAdvertisement: () =>
          Effect.fail(
            new DiscountCalculationError({
              reason: "invalid_discountable_subtotal",
              message: "provider application failed",
            })
          ),
      })
    );

    const response = await failedPOST(request(requestBody));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Workspace advertised price could not be loaded",
    });
  });

  test("maps Layer setup failures to a safe 500 response", async () => {
    const failedPOST = makeWorkspaceAdvertisedPricePost(
      Layer.effect(
        CheckoutPricingService,
        Effect.fail(
          new DiscountCalculationError({
            reason: "invalid_discountable_subtotal",
            message: "discount Layer setup failed",
          })
        )
      )
    );

    const response = await failedPOST(request(requestBody));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Workspace advertised price could not be loaded",
    });
  });

  test("cancels request execution when the request is aborted", async () => {
    const controller = new AbortController();
    let interruptObserved = false;
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const cancellablePOST = makeWorkspaceAdvertisedPricePost(
      CheckoutPricingServiceMock({
        quoteAdvertisement: () =>
          Effect.sync(markStarted).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                interruptObserved = true;
              })
            )
          ),
      })
    );
    const response = cancellablePOST(request(requestBody, controller.signal));

    await started;
    controller.abort();

    await expect(response).rejects.toBeDefined();
    expect(interruptObserved).toBe(true);
  });
});
