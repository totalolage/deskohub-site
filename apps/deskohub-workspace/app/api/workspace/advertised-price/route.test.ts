import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { discountAdvertisementQuoteCodec } from "@/features/discounts/contracts";
import { DiscountServiceMock } from "@/features/discounts/discount.service.mock";
import { DiscountCalculationError } from "@/features/discounts/errors";

mock.module("server-only", () => ({}));

const { makeWorkspaceAdvertisedPricePost } = await import(
  "@/features/checkout/backend/checkout/workspace-advertised-price-route.server"
);

const advertise = mock(({ discountableSubtotal, product }) =>
  Effect.succeed(
    discountAdvertisementQuoteCodec.make({
      product,
      discountableSubtotal,
      discounts: [],
      totalDiscount: { ...discountableSubtotal, value: 0 },
      discountedSubtotal: discountableSubtotal,
    })
  )
);
const POST = makeWorkspaceAdvertisedPricePost(
  DiscountServiceMock({ advertise })
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
    expect(advertise).toHaveBeenCalledWith({
      product: { kind: "cowork", tier: "basic" },
      discountableSubtotal: { value: 35_000, exponent: 2, currency: "CZK" },
      reservationDate: "2099-07-30",
      locale: "en-US",
    });
  });

  test("rejects contact data before invoking advertisement discovery", async () => {
    advertise.mockClear();
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
    expect(advertise).not.toHaveBeenCalled();
  });

  test("rejects malformed JSON before invoking advertisement discovery", async () => {
    advertise.mockClear();
    const response = await POST(
      new Request("https://deskohub.test/api/workspace/advertised-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      })
    );

    expect(response.status).toBe(400);
    expect(advertise).not.toHaveBeenCalled();
  });

  test("maps application failures to a safe 500 response", async () => {
    const failedPOST = makeWorkspaceAdvertisedPricePost(
      DiscountServiceMock({
        advertise: () =>
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

  test("cancels request execution when the request is aborted", async () => {
    const controller = new AbortController();
    let interruptObserved = false;
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const cancellablePOST = makeWorkspaceAdvertisedPricePost(
      DiscountServiceMock({
        advertise: () =>
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
