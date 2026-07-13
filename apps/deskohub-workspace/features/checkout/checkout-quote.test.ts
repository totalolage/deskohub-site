import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import {
  buildWorkspaceCheckoutQuote,
  getCheckoutSummaryChangedKeys,
  type WorkspaceCheckoutOrderInput,
} from "./checkout-quote-v2";

const coworkReservationDate = { date: "2099-06-10" } as const;

describe("workspace checkout quotes", () => {
  test("builds an access-only quote without a discount section", () => {
    const quote = buildWorkspaceCheckoutQuote({
      ...coworkReservationDate,
      kind: "cowork",
      tier: "basic",
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
      ...coworkReservationDate,
      kind: "cowork",
      tier: "basic",
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
      ...coworkReservationDate,
      kind: "cowork",
      tier: "plus",
      coffee: true,
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

  test("includes customer discount as a negative display item", () => {
    const quote = buildWorkspaceCheckoutQuote(
      {
        ...coworkReservationDate,
        kind: "cowork",
        tier: "basic",
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
        ...coworkReservationDate,
        kind: "cowork",
        tier: "basic",
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
      ...coworkReservationDate,
      kind: "cowork",
      tier: "basic",
      coffee: false,
    });
    const coffeeDiscountedToSameTotal = buildWorkspaceCheckoutQuote(
      {
        ...coworkReservationDate,
        kind: "cowork",
        tier: "basic",
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
      kind: "cowork",
      tier: "basic",
      date: "2099-06-10",
      coffee: false,
      legalConsent: true,
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420 777 777 777",
      message: "Please keep this private.",
    } as unknown as WorkspaceCheckoutOrderInput;

    const quote = buildWorkspaceCheckoutQuote(orderWithRuntimeExtras);

    expect(quote.order).toEqual({
      _tag: "cowork",
      tier: "basic",
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
      ...coworkReservationDate,
      kind: "cowork",
      tier: "plus",
      coffee: true,
    });
    const quoteWithRuntimeExtras = buildWorkspaceCheckoutQuote({
      kind: "cowork",
      tier: "plus",
      date: "2099-06-10",
      coffee: true,
      legalConsent: true,
      name: "Grace Hopper",
      email: "grace@example.com",
      phone: "+420 111 111 111",
      message: "Do not fingerprint this.",
    } as unknown as WorkspaceCheckoutOrderInput);

    expect(quoteWithRuntimeExtras.fingerprint).toBe(cleanQuote.fingerprint);
  });

  test("excludes cowork dates but fingerprints meeting-room intervals", () => {
    const accessOnly = buildWorkspaceCheckoutQuote({
      ...coworkReservationDate,
      kind: "cowork",
      tier: "basic",
      coffee: false,
    });
    const differentCoworkDate = buildWorkspaceCheckoutQuote({
      kind: "cowork",
      tier: "basic",
      coffee: false,
      date: "2099-06-11",
    });
    const morningOnly = buildWorkspaceCheckoutQuote({
      kind: "meeting-room",
      startsAt: "2099-06-10T07:00:00Z",
      endsAt: "2099-06-10T11:00:00Z",
    });

    expect(differentCoworkDate.order).toEqual(accessOnly.order);
    expect(differentCoworkDate.fingerprint).toBe(accessOnly.fingerprint);
    expect(morningOnly.order).toMatchObject({
      startsAt: "2099-06-10T07:00:00Z",
      endsAt: "2099-06-10T11:00:00Z",
    });
    expect(morningOnly.order).not.toHaveProperty("durationMinutes");
    expect(morningOnly.fingerprint).not.toBe(accessOnly.fingerprint);
  });

  test("prices meeting room reservations by approved duration", () => {
    const oneHour = buildWorkspaceCheckoutQuote({
      kind: "meeting-room",
      startsAt: "2099-06-10T07:00:00Z",
      endsAt: "2099-06-10T08:00:00Z",
    });
    const fourHours = buildWorkspaceCheckoutQuote({
      kind: "meeting-room",
      startsAt: "2099-06-10T07:00:00Z",
      endsAt: "2099-06-10T11:00:00Z",
    });
    const fullDay = buildWorkspaceCheckoutQuote({
      kind: "meeting-room",
      startsAt: "2099-06-10T13:00:00Z",
      endsAt: "2099-06-11T13:00:00Z",
    });

    expect(oneHour.summary.sections[0]?.items).toEqual([
      {
        key: "product:meeting-room",
        meetingRoomDurationMinutes: 60,
        amount: { value: 30_000, exponent: 2, currency: "CZK" },
      },
    ]);
    expect(fourHours.payment.expectedPrice.value).toBe(60_000);
    expect(fullDay.payment.expectedPrice.value).toBe(100_000);
  });

  test("rejects unsupported product and interval combinations", () => {
    expect(() =>
      buildWorkspaceCheckoutQuote({
        kind: "meeting-room",
        startsAt: "2099-06-10T07:30:00Z",
        endsAt: "2099-06-10T08:30:00Z",
      })
    ).toThrow("Meeting room reservations must start on a whole hour");
  });

  test("detects changed summary section and item keys", () => {
    const accessOnly = buildWorkspaceCheckoutQuote({
      ...coworkReservationDate,
      kind: "cowork",
      tier: "basic",
      coffee: false,
    });
    const withCoffee = buildWorkspaceCheckoutQuote({
      ...coworkReservationDate,
      kind: "cowork",
      tier: "basic",
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
      ...coworkReservationDate,
      kind: "cowork",
      tier: "basic",
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
