import { describe, expect, test } from "bun:test";
import type { AdministrationPaymentAttempt } from "./administration.service";
import {
  formatAdministrationDateTime,
  formatAdministrationExportDateTime,
  formatAdministrationMoney,
  formatAdministrationPlainDate,
  formatAdministrationReservationDate,
  getAdministrationMoneyAmount,
  getAdministrationPaymentStatus,
} from "./formatters";

const paidAttempt = {
  amount: { value: 21_750, exponent: 2, currency: "CZK" },
  refundState: "not_required",
  refundedAmount: null,
  refundedAt: null,
  state: "paid",
  failureCode: null,
  updatedAt: "2026-10-12T06:34:00Z",
} satisfies Pick<
  AdministrationPaymentAttempt,
  | "amount"
  | "failureCode"
  | "refundState"
  | "refundedAmount"
  | "refundedAt"
  | "state"
  | "updatedAt"
>;

describe("administration formatters", () => {
  test("formats dates and cowork reservations in en-US", () => {
    expect(formatAdministrationDateTime("2026-10-12T06:34:00Z", "en-US")).toBe(
      "Oct 12, 2026, 08:34"
    );
    expect(formatAdministrationPlainDate("2026-10-12", "en-US")).toBe(
      "Oct 12, 2026"
    );
    expect(
      formatAdministrationReservationDate(
        { date: "2026-10-12", startsAt: null, type: "cowork" },
        "en-US"
      )
    ).toBe("Oct 12, 2026");
  });

  test("formats dates and cowork reservations in cs-CZ", () => {
    expect(formatAdministrationDateTime("2026-10-12T06:34:00Z", "cs-CZ")).toBe(
      "12. 10. 2026 8:34"
    );
    expect(formatAdministrationPlainDate("2026-10-12", "cs-CZ")).toBe(
      "12. 10. 2026"
    );
    expect(
      formatAdministrationReservationDate(
        { date: "2026-10-12", startsAt: null, type: "cowork" },
        "cs-CZ"
      )
    ).toBe("12. 10. 2026");
  });

  test("formats money in en-US", () => {
    expect(
      formatAdministrationMoney(
        { value: 21_750, exponent: 2, currency: "CZK" },
        "en-US"
      )
    ).toBe("CZK\u00a0217.50");
    expect(
      formatAdministrationMoney(
        { value: 120_000, exponent: 2, currency: "CZK" },
        "en-US"
      )
    ).toBe("CZK\u00a01,200");
  });

  test("formats money in cs-CZ", () => {
    expect(
      formatAdministrationMoney(
        { value: 21_750, exponent: 2, currency: "CZK" },
        "cs-CZ"
      )
    ).toBe("217,50\u00a0Kč");
    expect(
      formatAdministrationMoney(
        { value: 120_000, exponent: 2, currency: "CZK" },
        "cs-CZ"
      )
    ).toBe("1\u00a0200\u00a0Kč");
  });
});

describe("getAdministrationPaymentStatus", () => {
  test("keeps the attempt state for a payment without a refund", () => {
    expect(getAdministrationPaymentStatus(paidAttempt, "en-US")).toEqual({
      label: "Paid",
      at: "2026-10-12T06:34:00Z",
      refunded: false,
      retainedAmount: null,
      needsRefund: false,
    });
  });

  test("flags a payment that still has to be refunded", () => {
    expect(
      getAdministrationPaymentStatus(
        {
          ...paidAttempt,
          refundState: "required",
        },
        "en-US"
      )
    ).toMatchObject({ label: "Paid", refunded: false, needsRefund: true });
  });

  test("replaces the paid state with the full refund and its time", () => {
    expect(
      getAdministrationPaymentStatus(
        {
          ...paidAttempt,
          refundState: "refunded",
          refundedAmount: paidAttempt.amount,
          refundedAt: "2026-10-12T09:00:00Z",
        },
        "en-US"
      )
    ).toEqual({
      label: "Refunded",
      at: "2026-10-12T09:00:00Z",
      refunded: true,
      retainedAmount: null,
      needsRefund: false,
    });
  });

  test("names the refunded amount and keeps the rest of a partial refund", () => {
    expect(
      getAdministrationPaymentStatus(
        {
          ...paidAttempt,
          refundState: "refunded",
          refundedAmount: { ...paidAttempt.amount, value: 10_000 },
          refundedAt: "2026-10-12T09:00:00Z",
        },
        "en-US"
      )
    ).toEqual({
      label: `Partially refunded ${formatAdministrationMoney(
        {
          ...paidAttempt.amount,
          value: 10_000,
        },
        "en-US"
      )}`,
      at: "2026-10-12T09:00:00Z",
      refunded: true,
      retainedAmount: { value: 11_750, exponent: 2, currency: "CZK" },
      needsRefund: false,
    });
  });

  test("labels the payment state in the route locale", () => {
    expect(getAdministrationPaymentStatus(paidAttempt, "cs-CZ").label).toBe(
      "Zaplaceno"
    );
    expect(
      getAdministrationPaymentStatus(
        { ...paidAttempt, state: "expired" },
        "cs-CZ"
      ).label
    ).toBe("Nezdařilo se");
  });

  test("labels a payment the hold cleanup abandoned", () => {
    expect(
      getAdministrationPaymentStatus(
        {
          ...paidAttempt,
          state: "cancelled",
          failureCode: "payment_abandoned_after_provider_cutoff",
        },
        "en-US"
      ).label
    ).toBe("Abandoned");
  });

  test("labels refunds in the route locale", () => {
    const refunded = {
      ...paidAttempt,
      refundState: "refunded",
      refundedAt: "2026-10-12T09:00:00Z",
    } as const;
    expect(
      getAdministrationPaymentStatus(
        { ...refunded, refundedAmount: paidAttempt.amount },
        "cs-CZ"
      ).label
    ).toBe("Vráceno");
    const refundedAmount = { ...paidAttempt.amount, value: 10_000 };
    expect(
      getAdministrationPaymentStatus({ ...refunded, refundedAmount }, "cs-CZ")
        .label
    ).toBe(
      `Částečně vráceno ${formatAdministrationMoney(refundedAmount, "cs-CZ")}`
    );
  });
});

describe("export values", () => {
  test("writes date-times on Prague time in summer and winter", () => {
    expect(formatAdministrationExportDateTime("2026-08-20T08:00:00Z")).toBe(
      "2026-08-20 10:00"
    );
    expect(formatAdministrationExportDateTime("2026-01-15T23:30:00Z")).toBe(
      "2026-01-16 00:30"
    );
  });

  test("writes amounts in currency units", () => {
    expect(
      getAdministrationMoneyAmount({
        value: 125_050,
        exponent: 2,
        currency: "CZK",
      })
    ).toBe(1250.5);
    expect(
      getAdministrationMoneyAmount({ value: 900, exponent: 0, currency: "CZK" })
    ).toBe(900);
  });
});
