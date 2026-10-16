import { describe, expect, test } from "bun:test";
import type { AdministrationPaymentAttempt } from "./administration.service";
import {
  formatAdministrationMoney,
  getAdministrationPaymentStatus,
} from "./formatters";

const paidAttempt = {
  amount: { value: 21_750, exponent: 2, currency: "CZK" },
  refundState: "not_required",
  refundedAmount: null,
  refundedAt: null,
  stateLabel: "Paid",
  updatedAt: "2026-10-12T06:34:00Z",
} satisfies Pick<
  AdministrationPaymentAttempt,
  | "amount"
  | "refundState"
  | "refundedAmount"
  | "refundedAt"
  | "stateLabel"
  | "updatedAt"
>;

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
});
