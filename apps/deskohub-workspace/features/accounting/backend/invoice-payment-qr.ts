import { generateQrCodePngBuffer } from "@deskohub/qr-code";
import { BigDecimal, Data, Effect } from "effect";
import type { InvoiceDocument } from "@/features/accounting/invoice";
import {
  getInvoiceSettlement,
  getInvoiceTotal,
  InvoiceSettlement,
} from "@/features/accounting/invoice-settlement";
import { findInvoicePaymentAccount } from "@/features/accounting/manual-invoice";
import {
  findWorkspaceCurrencyDefinition,
  type WorkspaceCurrencyCode,
} from "@/shared/money/currencies";

const maximumQrPayment = BigDecimal.fromStringUnsafe("9999999.99");

export interface InvoicePaymentRequest {
  readonly accountNumber: string;
  readonly bankName: string;
  readonly iban: string;
  readonly bic: string;
  readonly variableSymbol: string;
  readonly dueDate: string;
  readonly amount: string;
  readonly currency: WorkspaceCurrencyCode;
  readonly qrPayload: string | null;
  readonly qrCode: Buffer | null;
}

class InvoicePaymentQrError extends Data.TaggedError("InvoicePaymentQrError")<{
  readonly message: string;
}> {}

export const getInvoicePaymentRequest = Effect.fn("getInvoicePaymentRequest")(
  function* (document: InvoiceDocument) {
    const settlement = getInvoiceSettlement(document);
    if (!InvoiceSettlement.$is("PaymentRequested")(settlement)) return null;
    const invoiceTotal = getInvoiceTotal(document);
    const total = BigDecimal.fromStringUnsafe(invoiceTotal.amount);

    const currency = findWorkspaceCurrencyDefinition(invoiceTotal.currency);
    if (!currency) return null;
    const account = findInvoicePaymentAccount(currency.code);
    if (!account) return null;

    const amount = formatAmount(total, currency.exponent);

    const qrPayload =
      currency.code !== "CZK" ||
      BigDecimal.isGreaterThan(total, maximumQrPayment)
        ? null
        : [
            "SPD*1.0",
            `ACC:${account.iban}`,
            `AM:${amount}`,
            "CC:CZK",
            `DT:${settlement.dueDate.replaceAll("-", "")}`,
            `MSG:FAKTURA ${document.invoiceNumber}`,
            `X-VS:${settlement.variableSymbol}`,
          ].join("*");
    const qrCode = qrPayload
      ? yield* Effect.tryPromise({
          try: () =>
            generateQrCodePngBuffer(qrPayload, {
              errorCorrectionLevel: "M",
              margin: 4,
              width: 320,
              darkColor: "#000000ff",
              lightColor: "#ffffffff",
            }),
          catch: () =>
            new InvoicePaymentQrError({
              message: "Invoice payment QR code could not be generated.",
            }),
        })
      : null;

    return {
      ...account,
      variableSymbol: settlement.variableSymbol,
      dueDate: settlement.dueDate,
      amount,
      currency: currency.code,
      qrPayload,
      qrCode,
    } satisfies InvoicePaymentRequest;
  }
);

const formatAmount = (amount: BigDecimal.BigDecimal, exponent: number) => {
  if (exponent === 0) return BigDecimal.scale(amount, 0).value.toString();
  const scaled = BigDecimal.scale(amount, exponent)
    .value.toString()
    .padStart(exponent + 1, "0");
  return `${scaled.slice(0, -exponent)}.${scaled.slice(-exponent)}`;
};
