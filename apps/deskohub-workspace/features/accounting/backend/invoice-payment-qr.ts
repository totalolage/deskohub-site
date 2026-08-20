import { generateQrCodePngBuffer } from "@deskohub/qr-code";
import { BigDecimal, Data, Effect } from "effect";
import {
  getManualInvoicePayment,
  type ManualInvoiceDocument,
} from "@/features/accounting/invoice";
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

export class InvoicePaymentQrError extends Data.TaggedError(
  "InvoicePaymentQrError"
)<{ readonly message: string }> {}

export const getInvoicePaymentRequest = Effect.fn("getInvoicePaymentRequest")(
  function* (document: ManualInvoiceDocument) {
    const payment = getManualInvoicePayment(document);
    if (payment.status === "paid") return null;
    const total = BigDecimal.fromStringUnsafe(document.total);
    if (!BigDecimal.isPositive(total)) return null;

    const account = findInvoicePaymentAccount(document.currency);
    const currency = findWorkspaceCurrencyDefinition(document.currency);
    if (!account || !currency) return null;

    const amount = formatAmount(total, currency.exponent);

    const qrPayload =
      document.currency !== "CZK" ||
      BigDecimal.isGreaterThan(total, maximumQrPayment)
        ? null
        : [
            "SPD*1.0",
            `ACC:${account.iban}`,
            `AM:${amount}`,
            "CC:CZK",
            `DT:${payment.date.replaceAll("-", "")}`,
            `MSG:FAKTURA ${document.invoiceNumber}`,
            `X-VS:${document.variableSymbol}`,
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
      variableSymbol: document.variableSymbol,
      dueDate: payment.date,
      amount,
      currency: document.currency,
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
