import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import type { InvoiceDocument, ManualInvoiceDocument } from "./invoice";
import {
  makeCoworkInvoiceDocument,
  makeTestManualInvoiceDocument,
} from "./invoice.test-utils";
import {
  getInvoicePaymentStatus,
  getInvoiceSettlement,
  getInvoiceTotal,
  type InvoicePaymentStatus,
  InvoiceSettlement,
  type InvoiceTotal,
} from "./invoice-settlement";

const date = plainDateStringSchema.make;
const paidOn = { status: "paid", date: date("2026-08-20") } as const;

const reservation = makeCoworkInvoiceDocument("en-US") as Exclude<
  InvoiceDocument,
  ManualInvoiceDocument
>;
const { payment } = reservation.quote;
const zeroTotalReservation = {
  ...reservation,
  quote: {
    ...reservation.quote,
    payment: {
      ...payment,
      expectedPrice: { ...payment.expectedPrice, value: 0 },
    },
  },
} as InvoiceDocument;
const due = makeTestManualInvoiceDocument("en-US", "450");
const variableSymbol = due.variableSymbol;

const documents = {
  reservation,
  "zero-total reservation": zeroTotalReservation,
  "due manual": due,
  "fractional due manual": makeTestManualInvoiceDocument("cs-CZ", "1234.5"),
  "zero-total due manual": makeTestManualInvoiceDocument("en-US", "0"),
  "negative-total due manual": makeTestManualInvoiceDocument("en-US", "-100"),
  "paid manual": makeTestManualInvoiceDocument("en-US", "450", paidOn),
  "zero-total paid manual": makeTestManualInvoiceDocument("en-US", "0", paidOn),
  "EUR due manual": { ...due, currency: "EUR", total: "0.01" },
} satisfies Record<string, InvoiceDocument>;

type Case = {
  readonly total: InvoiceTotal;
  readonly settlement: InvoiceSettlement;
  /** Status on the day before, on, and after 2026-09-01, the test due date. */
  readonly status: readonly [
    InvoicePaymentStatus,
    InvoicePaymentStatus,
    InvoicePaymentStatus,
  ];
};

const paidWithoutStatedDate = InvoiceSettlement.Paid({
  paidOn: null,
  variableSymbol: null,
});
const requested = InvoiceSettlement.PaymentRequested({
  dueDate: date("2026-09-01"),
  variableSymbol,
});
const nothingDue = InvoiceSettlement.NothingDue({
  statedDueDate: date("2026-09-01"),
});

const cases = {
  reservation: {
    total: { amount: "340.00", currency: "CZK" },
    settlement: paidWithoutStatedDate,
    status: ["paid", "paid", "paid"],
  },
  // Undecided zero-total policy: today's per-kind outcome.
  "zero-total reservation": {
    total: { amount: "0.00", currency: "CZK" },
    settlement: paidWithoutStatedDate,
    status: ["paid", "paid", "paid"],
  },
  "due manual": {
    total: { amount: "450", currency: "CZK" },
    settlement: requested,
    status: ["issued", "due", "overdue"],
  },
  "fractional due manual": {
    total: { amount: "1234.5", currency: "CZK" },
    settlement: requested,
    status: ["issued", "due", "overdue"],
  },
  // Undecided zero-total policy: today's per-kind outcome.
  "zero-total due manual": {
    total: { amount: "0", currency: "CZK" },
    settlement: nothingDue,
    status: ["issued", "issued", "issued"],
  },
  "negative-total due manual": {
    total: { amount: "-100", currency: "CZK" },
    settlement: nothingDue,
    status: ["issued", "issued", "issued"],
  },
  "paid manual": {
    total: { amount: "450", currency: "CZK" },
    settlement: InvoiceSettlement.Paid({
      paidOn: date("2026-08-20"),
      variableSymbol,
    }),
    status: ["paid", "paid", "paid"],
  },
  "zero-total paid manual": {
    total: { amount: "0", currency: "CZK" },
    settlement: InvoiceSettlement.Paid({
      paidOn: date("2026-08-20"),
      variableSymbol: null,
    }),
    status: ["paid", "paid", "paid"],
  },
  "EUR due manual": {
    total: { amount: "0.01", currency: "EUR" },
    settlement: requested,
    status: ["issued", "due", "overdue"],
  },
} satisfies Record<keyof typeof documents, Case>;

describe("invoice settlement", () => {
  test.each(Object.entries(cases) as [keyof typeof documents, Case][])(
    "settles a %s invoice",
    (name, expected) => {
      const document = documents[name];

      expect(getInvoiceTotal(document)).toEqual(expected.total);
      expect(getInvoiceSettlement(document)).toEqual(expected.settlement);
      expect(
        ["2026-08-31", "2026-09-01", "2026-09-02"].map((today) =>
          getInvoicePaymentStatus(document, date(today))
        )
      ).toEqual([...expected.status]);
    }
  );
});
