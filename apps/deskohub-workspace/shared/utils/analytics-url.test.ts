import { describe, expect, test } from "bun:test";
import { sanitizeAnalyticsUrl } from "./analytics-url";

describe("sanitizeAnalyticsUrl", () => {
  test.each([
    [
      "https://deskohub.test/en-US/reservation/status/synthetic-reservation-id",
      "https://deskohub.test/en-US/reservation/status/[id]",
    ],
    [
      "https://deskohub.test/cs-CZ/reservation/access/synthetic-reservation-id?accessToken=synthetic-capability&view=door",
      "https://deskohub.test/cs-CZ/reservation/access/[id]?view=door",
    ],
    [
      "https://deskohub.test/en-US/reservation/invoice/synthetic-reservation-id",
      "https://deskohub.test/en-US/reservation/invoice/[id]",
    ],
    [
      "https://deskohub.test/admin/invoices/synthetic-invoice-id/pdf",
      "https://deskohub.test/admin/invoices/[id]/pdf",
    ],
    [
      "https://deskohub.test/admin/orders/synthetic-order-id",
      "https://deskohub.test/admin/orders/[id]",
    ],
    [
      "https://deskohub.test/en-US/checkout/pay/return/synthetic-order-id?payState=synthetic-state",
      "https://deskohub.test/en-US/checkout/pay/return/[id]",
    ],
  ])(
    "normalizes operational URLs without losing their route",
    (input, output) => {
      expect(sanitizeAnalyticsUrl(input)).toBe(output);
    }
  );

  test("leaves ordinary marketing URLs unchanged", () => {
    const url =
      "https://deskohub.test/en-US/reservation/cowork?utm_source=deskohub&utm_medium=sale_banner";

    expect(sanitizeAnalyticsUrl(url)).toBe(url);
  });

  test("strips the synthetic discount rejection identifier", () => {
    expect(
      sanitizeAnalyticsUrl(
        "https://deskohub.test/en-US/checkout/pay?discountCodeError=unavailable&discountCodeErrorId=synthetic-rejection-id"
      )
    ).toBe(
      "https://deskohub.test/en-US/checkout/pay?discountCodeError=unavailable"
    );
  });
});
