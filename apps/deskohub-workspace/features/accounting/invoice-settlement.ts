import { BigDecimal, Data, Match } from "effect";
import {
  type InvoiceDocument,
  isManualInvoiceDocument,
} from "@/features/accounting/invoice";
import type { InvoiceVariableSymbol } from "@/features/accounting/manual-invoice";
import { moneyToDecimalString } from "@/shared/money/money";
import type { PlainDate } from "@/shared/utils/temporal";

/** What an issued invoice tells its buyer about payment. */
export type InvoiceSettlement = Data.TaggedEnum<{
  Paid: {
    /**
     * The payment date a manual invoice states. A reservation invoice records
     * the payment instant (`paidAt`) on the document instead.
     */
    readonly paidOn: PlainDate | null;
    /** The bank payment reference, printed only when money changed hands. */
    readonly variableSymbol: InvoiceVariableSymbol | null;
  };
  PaymentRequested: {
    readonly dueDate: PlainDate;
    readonly variableSymbol: InvoiceVariableSymbol;
  };
  NothingDue: {
    /** The due date a manual invoice was issued with, though nothing is due. */
    readonly statedDueDate: PlainDate | null;
  };
}>;

export const InvoiceSettlement = Data.taggedEnum<InvoiceSettlement>();

/** The exact amount an invoice totals to, as the invoice states it. */
export type InvoiceTotal = {
  /** Exact decimal text, such as "1234.5" or "410.00"; never rounded. */
  readonly amount: string;
  readonly currency: string;
};

export type InvoicePaymentStatus = "paid" | "issued" | "due" | "overdue";

/**
 * How an invoice with a zero or negative total settles, per invoice kind. The
 * product policy is undecided; these keep the outcomes already-issued invoices
 * show. A manual invoice recorded as paid stays paid whatever its total.
 */
const nonPositiveTotalSettlement: Readonly<
  Record<"reservation" | "manual", "Paid" | "NothingDue">
> = {
  reservation: "Paid",
  manual: "NothingDue",
};

export const getInvoiceTotal = (document: InvoiceDocument): InvoiceTotal =>
  isManualInvoiceDocument(document)
    ? { amount: document.total, currency: document.currency }
    : {
        amount: moneyToDecimalString(document.quote.payment.expectedPrice),
        currency: document.quote.payment.expectedPrice.currency,
      };

export const getInvoiceSettlement = (
  document: InvoiceDocument
): InvoiceSettlement => {
  const positiveTotal = BigDecimal.isPositive(
    BigDecimal.fromStringUnsafe(getInvoiceTotal(document).amount)
  );
  if (!isManualInvoiceDocument(document)) {
    return positiveTotal
      ? paidWithoutStatedDate()
      : settleNonPositiveTotal("reservation", null);
  }
  // A paid manual invoice stores its payment; a due one only its `dueDate`.
  if ("payment" in document) {
    return InvoiceSettlement.Paid({
      paidOn: document.payment.date,
      variableSymbol: positiveTotal ? document.variableSymbol : null,
    });
  }
  return positiveTotal
    ? InvoiceSettlement.PaymentRequested({
        dueDate: document.dueDate,
        variableSymbol: document.variableSymbol,
      })
    : settleNonPositiveTotal("manual", document.dueDate);
};

/** The payment status operators see; `today` is the Prague calendar date. */
export const getInvoicePaymentStatus = (
  document: InvoiceDocument,
  today: PlainDate
): InvoicePaymentStatus =>
  Match.value(getInvoiceSettlement(document)).pipe(
    Match.tagsExhaustive({
      Paid: () => "paid" as const,
      NothingDue: () => "issued" as const,
      PaymentRequested: ({ dueDate }) => {
        if (dueDate < today) return "overdue";
        return dueDate === today ? "due" : "issued";
      },
    })
  );

const paidWithoutStatedDate = () =>
  InvoiceSettlement.Paid({ paidOn: null, variableSymbol: null });

const settleNonPositiveTotal = (
  kind: keyof typeof nonPositiveTotalSettlement,
  statedDueDate: PlainDate | null
): InvoiceSettlement =>
  nonPositiveTotalSettlement[kind] === "Paid"
    ? paidWithoutStatedDate()
    : InvoiceSettlement.NothingDue({ statedDueDate });
