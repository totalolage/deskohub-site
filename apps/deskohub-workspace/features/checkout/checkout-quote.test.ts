import { describe, expect, test } from "bun:test";
import {
  buildWorkspaceCheckoutQuote,
  getCheckoutSummaryChangedKeys,
  type WorkspaceCheckoutOrder,
} from "./checkout-quote";

describe("workspace checkout quotes", () => {
  test("builds an access-only quote without a discount section", () => {
    const quote = buildWorkspaceCheckoutQuote({
      entryTier: "basic",
      coffee: false,
    });

    expect(quote.summary.total).toEqual({
      value: 35_000,
      exponent: 2,
      currency: "CZK",
    });
    expect(quote.summary.sections.map((section) => section.key)).toEqual([
      "order",
      "total",
    ]);
    expect(quote.summary.sections[0]?.items.map((item) => item.key)).toEqual([
      "product:basic",
    ]);
  });

  test("charges paid coffee for the Basic non-courtesy tier", () => {
    const quote = buildWorkspaceCheckoutQuote({
      entryTier: "basic",
      coffee: true,
    });

    expect(quote.summary.sections[0]?.items).toEqual([
      {
        key: "product:basic",
        amount: { value: 35_000, exponent: 2, currency: "CZK" },
      },
      {
        key: "addon:coffee",
        amount: { value: 5000, exponent: 2, currency: "CZK" },
      },
    ]);
    expect(quote.payment.expectedPrice.value).toBe(40_000);
  });

  test("shows courtesy coffee as a zero CZK line item for included tiers", () => {
    const quote = buildWorkspaceCheckoutQuote({
      entryTier: "plus",
      coffee: false,
    });

    expect(quote.order.coffee).toBe(true);
    expect(quote.summary.sections[0]?.items).toEqual([
      {
        key: "product:plus",
        amount: { value: 49_000, exponent: 2, currency: "CZK" },
      },
      {
        key: "addon:coffee",
        amount: { value: 0, exponent: 2, currency: "CZK" },
      },
    ]);
    expect(quote.payment.expectedPrice.value).toBe(49_000);
  });

  test("rejects unreachable monitor combinations consistently", () => {
    expect(() =>
      buildWorkspaceCheckoutQuote({
        entryTier: "basic",
        coffee: false,
        monitorOption: "2x27-qhd",
      })
    ).toThrow("Monitor option is unavailable");

    expect(() =>
      buildWorkspaceCheckoutQuote({
        entryTier: "profi",
        coffee: true,
      })
    ).toThrow("Monitor option is required");
  });

  test("includes customer discount as a negative display item", () => {
    const quote = buildWorkspaceCheckoutQuote(
      {
        entryTier: "basic",
        coffee: true,
      },
      {
        customerDiscount: {
          source: "dotypos-discount-group",
          discountGroupId: "5",
          percent: 5,
        },
      }
    );

    expect(quote.summary.sections[1]).toEqual({
      key: "discount",
      items: [
        {
          key: "customer-discount:dotypos-discount-group:5",
          amount: { value: -2000, exponent: 2, currency: "CZK" },
        },
      ],
      total: { value: -2000, exponent: 2, currency: "CZK" },
    });
    expect(quote.payment.expectedPrice.value).toBe(38_000);
    expect(quote.payment.customerDiscount?.amount.value).toBe(2000);
  });

  test("preserves minor-unit rounding behavior", () => {
    const quote = buildWorkspaceCheckoutQuote(
      {
        entryTier: "basic",
        coffee: false,
      },
      {
        customerDiscount: {
          source: "dotypos-discount-group",
          discountGroupId: "12.5",
          percent: 12.5,
        },
      }
    );

    expect(quote.payment.expectedPrice.value).toBe(30_625);
    expect(quote.payment.customerDiscount?.amount.value).toBe(4375);
  });

  test("fingerprint changes for different composition with the same total", () => {
    const accessOnly = buildWorkspaceCheckoutQuote({
      entryTier: "basic",
      coffee: false,
    });
    const coffeeDiscountedToSameTotal = buildWorkspaceCheckoutQuote(
      {
        entryTier: "basic",
        coffee: true,
      },
      {
        customerDiscount: {
          source: "dotypos-discount-group",
          discountGroupId: "12.5",
          percent: 12.5,
        },
      }
    );

    expect(accessOnly.summary.total.value).toBe(
      coffeeDiscountedToSameTotal.summary.total.value
    );
    expect(accessOnly.fingerprint).not.toBe(
      coffeeDiscountedToSameTotal.fingerprint
    );
  });

  test("sanitizes runtime contact and consent fields from quote output", () => {
    const orderWithRuntimeExtras = {
      entryTier: "basic",
      date: "2026-06-01",
      coffee: false,
      legalConsent: true,
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420 777 777 777",
      message: "Please keep this private.",
    } as unknown as WorkspaceCheckoutOrder;

    const quote = buildWorkspaceCheckoutQuote(orderWithRuntimeExtras);

    expect(quote.order).toEqual({
      entryTier: "basic",
      coffee: false,
    });
    expect(quote.order).not.toHaveProperty("date");
    expect(quote.order).not.toHaveProperty("legalConsent");
    expect(quote.order).not.toHaveProperty("name");
    expect(quote.order).not.toHaveProperty("email");
    expect(quote.order).not.toHaveProperty("phone");
    expect(quote.order).not.toHaveProperty("message");
  });

  test("ignores runtime contact and consent fields when fingerprinting", () => {
    const cleanQuote = buildWorkspaceCheckoutQuote({
      entryTier: "plus",
      coffee: false,
    });
    const quoteWithRuntimeExtras = buildWorkspaceCheckoutQuote({
      entryTier: "plus",
      date: "2026-06-01",
      coffee: false,
      legalConsent: true,
      name: "Grace Hopper",
      email: "grace@example.com",
      phone: "+420 111 111 111",
      message: "Do not fingerprint this.",
    } as unknown as WorkspaceCheckoutOrder);

    expect(quoteWithRuntimeExtras.fingerprint).toBe(cleanQuote.fingerprint);
  });

  test("detects changed summary section and item keys", () => {
    const accessOnly = buildWorkspaceCheckoutQuote({
      entryTier: "basic",
      coffee: false,
    });
    const withCoffee = buildWorkspaceCheckoutQuote({
      entryTier: "basic",
      coffee: true,
    });

    expect(
      getCheckoutSummaryChangedKeys(accessOnly.summary, withCoffee.summary)
    ).toEqual({
      sectionKeys: ["order", "total"],
      itemKeys: ["order/addon:coffee", "total/total:final"],
    });
  });

  test("detects changed summary currency and exponent", () => {
    const quote = buildWorkspaceCheckoutQuote({
      entryTier: "basic",
      coffee: false,
    });
    const changedCurrency = {
      ...quote.summary,
      sections: quote.summary.sections.map((section) => ({
        ...section,
        total: { ...section.total, currency: "EUR" },
        items: section.items.map((item) => ({
          ...item,
          amount: { ...item.amount, currency: "EUR" },
        })),
      })),
      total: { ...quote.summary.total, currency: "EUR" },
    };
    const changedExponent = {
      ...quote.summary,
      sections: quote.summary.sections.map((section) => ({
        ...section,
        total: { ...section.total, exponent: 0 },
        items: section.items.map((item) => ({
          ...item,
          amount: { ...item.amount, exponent: 0 },
        })),
      })),
      total: { ...quote.summary.total, exponent: 0 },
    };

    expect(
      getCheckoutSummaryChangedKeys(quote.summary, changedCurrency).itemKeys
    ).toContain("order/product:basic");
    expect(
      getCheckoutSummaryChangedKeys(quote.summary, changedExponent).sectionKeys
    ).toContain("total");
  });
});
