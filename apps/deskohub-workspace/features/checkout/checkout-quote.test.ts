import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import type { AppliedDiscount, DiscountQuote } from "@/features/discounts";
import { discountIdSchema } from "@/features/discounts/contracts";
import {
  buildWorkspaceCheckoutQuote,
  getCheckoutSummaryChangedKeys,
  type WorkspaceCheckoutOrder,
} from "./checkout-quote";

const money = (value: number) => ({
  value,
  exponent: 2,
  currency: "CZK",
});

const discountId = Schema.decodeUnknownSync(discountIdSchema);

const discountQuote = (
  applications: readonly AppliedDiscount[]
): DiscountQuote => ({
  product: { kind: "cowork", tier: "basic" },
  discountableSubtotal: money(35_000),
  discounts: applications,
  totalDiscount: money(
    applications.reduce(
      (total, application) => total + application.amount.value,
      0
    )
  ),
  discountedSubtotal: applications.at(-1)?.subtotalAfter ?? money(35_000),
});

const percentageApplication = (
  overrides: Partial<AppliedDiscount> = {}
): AppliedDiscount => ({
  discount: {
    id: discountId("calendar-sale"),
    label: "Summer sale",
    adjustment: { kind: "percentage", basisPoints: 5000 },
    expiresAt: "2026-08-01T22:00:00.000Z",
    countdownStartsAt: "2026-07-31T22:00:00.000Z",
  },
  subtotalBefore: money(35_000),
  amount: money(17_500),
  subtotalAfter: money(17_500),
  ...overrides,
});

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
    expect(quote).not.toHaveProperty("schema");
    expect(quote.summary).not.toHaveProperty("schema");
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
    ).toThrow("monitorOption");

    expect(() =>
      buildWorkspaceCheckoutQuote({
        entryTier: "profi",
        coffee: true,
      })
    ).toThrow("monitorOption");
  });

  test("applies generic cowork discounts without discounting paid coffee", () => {
    const application = percentageApplication();
    const quote = buildWorkspaceCheckoutQuote(
      {
        entryTier: "basic",
        coffee: true,
      },
      {
        discountQuote: discountQuote([application]),
      }
    );

    expect(quote.summary.sections[1]).toEqual({
      key: "discount",
      items: [
        {
          key: "discount:calendar-sale",
          label: "Summer sale",
          amount: { value: -17_500, exponent: 2, currency: "CZK" },
        },
      ],
      total: { value: -17_500, exponent: 2, currency: "CZK" },
    });
    expect(quote.payment.expectedPrice.value).toBe(22_500);
    expect(quote.payment.undiscountedPrice.value).toBe(40_000);
    expect(quote.payment.discounts).toEqual([application]);
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
        discountQuote: discountQuote([
          {
            discount: {
              id: discountId("coffee-offset"),
              label: "Coffee offset",
              adjustment: { kind: "fixed", amount: money(5000) },
            },
            subtotalBefore: money(35_000),
            amount: money(5000),
            subtotalAfter: money(30_000),
          },
        ]),
      }
    );

    expect(accessOnly.summary.total.value).toBe(
      coffeeDiscountedToSameTotal.summary.total.value
    );
    expect(accessOnly.fingerprint).not.toBe(
      coffeeDiscountedToSameTotal.fingerprint
    );
  });

  test("fingerprint includes the complete generic discount snapshot", () => {
    const application = percentageApplication();
    const fingerprint = buildWorkspaceCheckoutQuote(
      { entryTier: "basic", coffee: false },
      { discountQuote: discountQuote([application]) }
    ).fingerprint;
    const variants: readonly AppliedDiscount[] = [
      {
        ...application,
        discount: { ...application.discount, label: "Renamed sale" },
      },
      {
        ...application,
        discount: {
          ...application.discount,
          adjustment: { kind: "percentage", basisPoints: 4000 },
        },
      },
      {
        ...application,
        discount: {
          ...application.discount,
          expiresAt: "2026-08-02T22:00:00.000Z",
        },
      },
      {
        ...application,
        discount: {
          ...application.discount,
          countdownStartsAt: "2026-08-01T22:00:00.000Z",
        },
      },
      { ...application, subtotalBefore: money(34_999) },
      { ...application, amount: money(17_499) },
      { ...application, subtotalAfter: money(17_501) },
    ];

    for (const variant of variants) {
      expect(
        buildWorkspaceCheckoutQuote(
          { entryTier: "basic", coffee: false },
          { discountQuote: discountQuote([variant]) }
        ).fingerprint
      ).not.toBe(fingerprint);
    }
  });

  test("fingerprint preserves generic discount application order", () => {
    const first = percentageApplication();
    const second: AppliedDiscount = {
      discount: {
        id: discountId("member-bonus"),
        label: "Member bonus",
        adjustment: { kind: "fixed", amount: money(2500) },
      },
      subtotalBefore: money(17_500),
      amount: money(2500),
      subtotalAfter: money(15_000),
    };

    const ordered = buildWorkspaceCheckoutQuote(
      { entryTier: "basic", coffee: false },
      { discountQuote: discountQuote([first, second]) }
    );
    const reversed = buildWorkspaceCheckoutQuote(
      { entryTier: "basic", coffee: false },
      { discountQuote: discountQuote([second, first]) }
    );

    expect(ordered.fingerprint).not.toBe(reversed.fingerprint);
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

  test("detects a changed public item label when its amount is unchanged", () => {
    const quote = buildWorkspaceCheckoutQuote(
      { entryTier: "basic", coffee: false },
      { discountQuote: discountQuote([percentageApplication()]) }
    );
    const renamedSummary = {
      ...quote.summary,
      sections: quote.summary.sections.map((section) => ({
        ...section,
        items: section.items.map((item) =>
          item.key === "discount:calendar-sale"
            ? { ...item, label: "Renamed sale" }
            : item
        ),
      })),
    };

    expect(
      getCheckoutSummaryChangedKeys(quote.summary, renamedSummary)
    ).toEqual({
      sectionKeys: [],
      itemKeys: ["discount/discount:calendar-sale"],
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
