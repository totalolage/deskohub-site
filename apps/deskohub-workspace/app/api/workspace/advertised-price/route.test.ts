import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { makeWorkspaceAdvertisedPricePost } from "@/features/checkout/backend/checkout/workspace-advertised-price-route.server";
import { discountAdvertisementQuoteCodec } from "@/features/discounts/contracts";
import { DiscountServiceMock } from "@/features/discounts/discount.service.mock";

mock.module("server-only", () => ({}));

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

const request = (body: unknown) =>
  new Request("https://deskohub.test/api/workspace/advertised-price", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
});
