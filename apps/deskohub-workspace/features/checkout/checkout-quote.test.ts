import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import type { WorkspaceProductMonitorOption } from "@/features/checkout/product-catalog";
import { workspaceProductMonitorOptions } from "@/features/checkout/product-catalog";
import type { AppliedDiscount, DiscountQuote } from "@/features/discounts";
import { discountIdSchema } from "@/features/discounts/contracts";
import {
  buildCoworkCheckoutSummary,
  buildCoworkReservationQuote as buildCoworkPriceQuote,
  type CoworkReservationQuoteOrder,
} from "./checkout-quote.test-utils";
import { getCheckoutSummaryChangedKeys } from "./checkout-summary";
import { buildCoworkReservationQuote as buildCoworkReservationQuoteEffect } from "./reservation-quote-cowork";

const buildCoworkReservationQuote = (
  order: CoworkReservationQuoteOrder,
  options: Parameters<typeof buildCoworkPriceQuote>[1] = {}
) => ({
  ...buildCoworkPriceQuote(order, options),
  summary: buildCoworkCheckoutSummary(order, options),
});

const money = (value: number) => ({
  value,
  exponent: 2,
  currency: "CZK",
});

const discountId = Schema.decodeUnknownSync(discountIdSchema);

const discountQuote = (
  applications: readonly AppliedDiscount[]
): DiscountQuote => ({
  product: { kind: "cowork", tier: "open-space" },
  discountableSubtotal: money(29_000),
  discounts: applications,
  totalDiscount: money(
    applications.reduce(
      (total, application) => total + application.amount.value,
      0
    )
  ),
  discountedSubtotal: applications.at(-1)?.subtotalAfter ?? money(29_000),
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
  subtotalBefore: money(29_000),
  amount: money(14_500),
  subtotalAfter: money(14_500),
  ...overrides,
});

describe("cowork reservation quotes", () => {
  test("builds an access-only quote without a discount section", () => {
    const quote = buildCoworkReservationQuote({
      entryTier: "open-space",
      coffee: false,
    });

    expect(quote.summary.total).toEqual({
      value: 29_000,
      exponent: 2,
      currency: "CZK",
    });
    expect(quote.summary.sections.map((section) => section.key)).toEqual([
      "order",
      "total",
    ]);
    expect(quote.summary.sections[0]?.items.map((item) => item.key)).toEqual([
      "product:cowork:open-space",
    ]);
  });

  test("charges paid coffee for the Basic non-courtesy tier", () => {
    const quote = buildCoworkReservationQuote({
      entryTier: "open-space",
      coffee: true,
    });

    expect(quote.summary.sections[0]?.items).toEqual([
      {
        key: "product:cowork:open-space",
        product: { kind: "cowork", tier: "open-space" },
        amount: { value: 29_000, exponent: 2, currency: "CZK" },
      },
      {
        key: "addon:coffee",
        amount: { value: 5000, exponent: 2, currency: "CZK" },
      },
    ]);
  });

  test("keeps included coffee out of the reserved-desk summary", () => {
    const quote = buildCoworkReservationQuote({
      entryTier: "reserved-desk",
      coffee: true,
    });

    expect(quote.summary.sections[0]?.items.map((item) => item.key)).toEqual([
      "product:cowork:reserved-desk",
    ]);
  });

  test("lists the reserved-desk workstation and monitor in the summary", () => {
    const withWorkstation = buildCoworkReservationQuote({
      entryTier: "reserved-desk",
      coffee: true,
      monitorOption: "2x27-qhd",
    });

    expect(
      withWorkstation.summary.sections[0]?.items.map((item) => item.key)
    ).toEqual([
      "product:cowork:reserved-desk",
      "addon:workstation",
      "monitor:2x27-qhd",
    ]);
  });

  test("keeps the fingerprint stable across every catalog configuration and split by workstation presence", () => {
    const quoteWith = (monitorOption?: WorkspaceProductMonitorOption | "") =>
      Effect.runSync(
        buildCoworkReservationQuoteEffect({
          kind: "cowork",
          entryTier: "reserved-desk",
          coffee: true,
          ...(monitorOption !== undefined && { monitorOption }),
        })
      );

    const configured = workspaceProductMonitorOptions.map(
      (monitorOption) => quoteWith(monitorOption).fingerprint
    );

    // Every catalog monitor configuration is the same priced workstation.
    for (const fingerprint of configured) {
      expect(fingerprint).toBe(configured[0]);
    }

    const absent = quoteWith().fingerprint;
    const empty = quoteWith("").fingerprint;

    // Absent and empty selections are no-workstation quotes.
    expect(absent).toBe(empty);
    expect(configured[0]).not.toBe(absent);
  });

  test("applies generic cowork discounts without discounting paid coffee", () => {
    const application = percentageApplication();
    const quote = buildCoworkReservationQuote(
      {
        entryTier: "open-space",
        coffee: true,
      },
      {
        discountQuote: discountQuote([application]),
      }
    );

    expect(quote.summary.sections.map((section) => section.key)).toEqual([
      "order",
      "total",
    ]);
    expect(quote.summary.sections[0]).toEqual({
      key: "order",
      items: [
        {
          key: "product:cowork:open-space",
          product: { kind: "cowork", tier: "open-space" },
          amount: { value: 14_500, exponent: 2, currency: "CZK" },
          originalAmount: { value: 29_000, exponent: 2, currency: "CZK" },
          discounts: [
            {
              discount: application.discount,
              amount: application.amount,
            },
          ],
        },
        {
          key: "addon:coffee",
          amount: { value: 5000, exponent: 2, currency: "CZK" },
        },
      ],
      total: { value: 19_500, exponent: 2, currency: "CZK" },
    });
  });

  test("fingerprint includes the complete generic discount snapshot", () => {
    const application = percentageApplication();
    const fingerprint = buildCoworkReservationQuote(
      { entryTier: "open-space", coffee: false },
      { discountQuote: discountQuote([application]) }
    ).fingerprint;
    const variants: readonly AppliedDiscount[] = [
      {
        ...application,
        discount: {
          ...application.discount,
          id: discountId("replacement-sale"),
        },
      },
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
        buildCoworkReservationQuote(
          { entryTier: "open-space", coffee: false },
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
      subtotalBefore: money(14_500),
      amount: money(2500),
      subtotalAfter: money(15_000),
    };

    const ordered = buildCoworkReservationQuote(
      { entryTier: "open-space", coffee: false },
      { discountQuote: discountQuote([first, second]) }
    );
    const reversed = buildCoworkReservationQuote(
      { entryTier: "open-space", coffee: false },
      { discountQuote: discountQuote([second, first]) }
    );

    expect(ordered.fingerprint).not.toBe(reversed.fingerprint);
  });

  test("detects changed summary section and item keys", () => {
    const accessOnly = buildCoworkReservationQuote({
      entryTier: "open-space",
      coffee: false,
    });
    const withCoffee = buildCoworkReservationQuote({
      entryTier: "open-space",
      coffee: true,
    });

    expect(
      getCheckoutSummaryChangedKeys(accessOnly.summary, withCoffee.summary)
    ).toEqual({
      sectionKeys: ["order", "total"],
      itemKeys: ["addon:coffee", "total:final"],
    });
  });

  test("detects every inline discount composition change at an equal final price", () => {
    const first = percentageApplication();
    const second: AppliedDiscount = {
      discount: {
        id: discountId("member-bonus"),
        label: "Member bonus",
        adjustment: { kind: "fixed", amount: money(2500) },
      },
      subtotalBefore: money(14_500),
      amount: money(2500),
      subtotalAfter: money(15_000),
    };
    const quote = buildCoworkReservationQuote(
      { entryTier: "open-space", coffee: false },
      { discountQuote: discountQuote([first, second]) }
    );
    const productItem = quote.summary.sections[0]?.items[0];
    if (!(productItem && "discounts" in productItem)) {
      throw new Error("Expected a discounted product summary item");
    }

    const variants = [
      {
        ...productItem,
        originalAmount: money(productItem.originalAmount.value + 1),
      },
      {
        ...productItem,
        discounts: productItem.discounts.map((summaryDiscount, index) =>
          index === 0
            ? {
                ...summaryDiscount,
                discount: {
                  ...summaryDiscount.discount,
                  id: discountId("replacement-sale"),
                },
              }
            : summaryDiscount
        ),
      },
      {
        ...productItem,
        discounts: [...productItem.discounts].reverse(),
      },
      {
        ...productItem,
        discounts: productItem.discounts.map((summaryDiscount, index) =>
          index === 0
            ? {
                ...summaryDiscount,
                discount: {
                  ...summaryDiscount.discount,
                  label: "Renamed sale",
                },
              }
            : summaryDiscount
        ),
      },
      {
        ...productItem,
        discounts: productItem.discounts.map((summaryDiscount, index) =>
          index === 0
            ? {
                ...summaryDiscount,
                discount: {
                  ...summaryDiscount.discount,
                  adjustment: {
                    kind: "percentage" as const,
                    basisPoints: 4999,
                  },
                },
              }
            : summaryDiscount
        ),
      },
      {
        ...productItem,
        discounts: productItem.discounts.map((summaryDiscount, index) =>
          index === 0
            ? {
                ...summaryDiscount,
                amount: money(summaryDiscount.amount.value - 1),
              }
            : summaryDiscount
        ),
      },
    ];

    for (const variant of variants) {
      const changedSummary = {
        ...quote.summary,
        sections: quote.summary.sections.map((section) =>
          section.key === "order"
            ? { ...section, items: [variant, ...section.items.slice(1)] }
            : section
        ),
      };

      expect(
        getCheckoutSummaryChangedKeys(quote.summary, changedSummary).itemKeys
      ).toContain("product:cowork:open-space");
    }
  });

  test("detects changed summary currency and exponent", () => {
    const quote = buildCoworkReservationQuote({
      entryTier: "open-space",
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
    ).toContain("product:cowork:open-space");
    expect(
      getCheckoutSummaryChangedKeys(quote.summary, changedExponent).sectionKeys
    ).toContain("total");
  });
});
