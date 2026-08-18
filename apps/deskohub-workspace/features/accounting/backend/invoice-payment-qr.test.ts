import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  formatInvoiceNumber,
  makeManualInvoiceDocument,
} from "@/features/accounting/invoice";
import {
  manualInvoiceInputSchema,
  normalizeManualInvoiceInput,
} from "@/features/accounting/manual-invoice";
import { getInvoicePaymentRequest } from "./invoice-payment-qr";

const makeDocument = async (price: string) => {
  const input = Schema.decodeUnknownSync(manualInvoiceInputSchema)({
    invoiceId: "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb23",
    dotyposCustomerId: "synthetic-customer",
    buyer: {
      kind: "person",
      legalName: "Ada Lovelace",
      address: {
        line1: "Synthetic 1",
        city: "Praha",
        postalCode: "100 00",
        country: "CZ",
      },
    },
    deliveryEmail: "invoice@example.test",
    locale: "cs-CZ",
    serviceDate: "2026-08-18",
    dueDate: "2026-09-01",
    currency: "CZK",
    variableSymbol: "42",
    lines: [{ description: "Pronájem prostoru", price }],
    provenance: { source: "admin-ui", actor: "synthetic-admin" },
  });
  return makeManualInvoiceDocument({
    normalized: await Effect.runPromise(normalizeManualInvoiceInput(input)),
    invoiceNumber: formatInvoiceNumber({ year: 2026, sequence: 42 }),
    issuedAt: Temporal.Instant.from("2026-08-18T12:00:00Z"),
  });
};

describe("invoice payment QR", () => {
  test("generates the ČBA SPAYD payload and QR from configured bank details", async () => {
    const payment = await Effect.runPromise(
      getInvoicePaymentRequest(await makeDocument("450"))
    );
    expect(payment?.qrPayload).toBe(
      "SPD*1.0*ACC:CZ0620100000002303459272*AM:450.00*CC:CZK*DT:20260901*MSG:FAKTURA WS-FV-2026-000042*X-VS:42"
    );
    expect(payment?.qrCode?.subarray(1, 4).toString()).toBe("PNG");
  });

  test("omits payment instructions for non-positive totals", async () => {
    expect(
      await Effect.runPromise(getInvoicePaymentRequest(await makeDocument("0")))
    ).toBeNull();
    expect(
      await Effect.runPromise(
        getInvoicePaymentRequest(await makeDocument("-1"))
      )
    ).toBeNull();
  });

  test("keeps textual details but omits QR beyond the SPAYD amount ceiling", async () => {
    const payment = await Effect.runPromise(
      getInvoicePaymentRequest(await makeDocument("10000000"))
    );
    expect(payment?.amount).toBe("10000000.00");
    expect(payment?.qrPayload).toBeNull();
    expect(payment?.qrCode).toBeNull();
  });
});
