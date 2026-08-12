import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import {
  buildCoworkReservationQuote,
  type CoworkReservationQuoteOrder,
} from "@/features/checkout/checkout-quote.test-utils";
import { buildOfficeReservationQuote } from "@/features/checkout/reservation-quote-office";
import { normalizedOfficeReservationOrderSchema } from "@/features/reservation/office-reservation";
import { makeAccountingDocumentSnapshot } from "./accounting-document-snapshot";
import {
  decodeInvoiceDocument,
  formatInvoiceNumber,
  getInvoiceNumberingYear,
  invoiceDocumentSchema,
  invoiceNumberSchema,
  makeInvoiceDocument,
} from "./invoice";

const coworkOrder = {
  entryTier: "basic",
  coffee: true,
} satisfies CoworkReservationQuoteOrder;

const prepared = {
  kind: "cowork",
  reservation: {
    kind: "cowork",
    ...coworkOrder,
    date: "2099-01-01",
    name: "Original Buyer",
    email: "synthetic@example.test",
    phone: "+420 700 000 000",
  },
  quote: buildCoworkReservationQuote(coworkOrder),
} as PreparedCustomerQuote;

const source = makeAccountingDocumentSnapshot({
  workspaceReservationId: "reservation-id",
  dotyposReservationId: "dotypos-reservation-id",
  dotyposCustomerId: "dotypos-customer-id",
  locale: "en-US",
  prepared,
});

const paidAt = Temporal.Instant.from("2026-08-10T12:30:00Z");

describe("invoice", () => {
  test("formats positive annual sequences without arbitrary upper bounds", () => {
    expect(formatInvoiceNumber({ year: 2026, sequence: 1 })).toBe(
      "WS-FV-2026-000001"
    );
    expect(formatInvoiceNumber({ year: 10_000, sequence: 1_000_000 })).toBe(
      "WS-FV-10000-1000000"
    );
    expect(() => formatInvoiceNumber({ year: 2026, sequence: 0 })).toThrow(
      RangeError
    );
  });

  test("accepts invoice numbers independently of the current generated format", () => {
    expect(Schema.decodeUnknownSync(invoiceNumberSchema)("2026/42")).toBe(
      "2026/42"
    );
  });

  test("uses the Prague calendar year at the UTC New Year boundary", () => {
    expect(
      getInvoiceNumberingYear(Temporal.Instant.from("2026-12-31T22:59:59.999Z"))
    ).toBe(2026);
    expect(
      getInvoiceNumberingYear(Temporal.Instant.from("2026-12-31T23:00:00Z"))
    ).toBe(2027);
  });

  test("freezes an explicit invoice buyer without changing the source", () => {
    const document = makeInvoiceDocument({
      source,
      buyer: {
        kind: "business",
        legalName: "Invoice Buyer s.r.o.",
        companyId: "12345678",
        vatId: "CZ12345678",
        address: {
          line1: "Synthetic 1",
          city: "Praha",
          postalCode: "100 00",
          country: "CZ",
        },
      },
      paymentAttemptId: "payment-attempt-id",
      invoiceNumber: formatInvoiceNumber({ year: 2026, sequence: 42 }),
      issuedAt: Temporal.Instant.from("2026-08-10T12:34:56.789Z"),
      paidAt,
    });

    expect(document).toMatchObject({
      workspaceReservationId: "reservation-id",
      paymentAttemptId: "payment-attempt-id",
      invoiceNumber: "WS-FV-2026-000042",
      issuedAt: "2026-08-10T12:34:56.789Z",
      paidAt: "2026-08-10T12:30:00.000Z",
      supplier: source.supplier,
      reservation: source.reservation,
      quote: source.quote,
      buyer: {
        kind: "business",
        legalName: "Invoice Buyer s.r.o.",
      },
    });
    expect(document).not.toHaveProperty("schemaVersion");
    expect(source.buyer).toEqual({
      kind: "person",
      legalName: "Original Buyer",
    });
  });

  test("round-trips strictly through the document schema", async () => {
    const document = makeInvoiceDocument({
      source,
      buyer: source.buyer,
      paymentAttemptId: "payment-attempt-id",
      invoiceNumber: formatInvoiceNumber({ year: 2026, sequence: 1 }),
      issuedAt: Temporal.Instant.from("2026-08-10T12:34:56.789Z"),
      paidAt,
    });
    const decode = Schema.decodeUnknownEffect(invoiceDocumentSchema, {
      onExcessProperty: "error",
    });

    await expect(Effect.runPromise(decode(document))).resolves.toEqual(
      document
    );
    await expect(
      Effect.runPromise(decode({ ...document, unexpected: true }))
    ).rejects.toBeDefined();
  });

  test("decodes invoices issued before rendering facts were added", async () => {
    const document = makeInvoiceDocument({
      source,
      buyer: source.buyer,
      paymentAttemptId: "payment-attempt-id",
      invoiceNumber: formatInvoiceNumber({ year: 2026, sequence: 1 }),
      issuedAt: Temporal.Instant.from("2026-08-10T12:34:56.789Z"),
      paidAt,
    });
    const { paidAt: _paidAt, supplier, ...identity } = document;
    const { commercialRegister: _commercialRegister, ...legacySupplier } =
      supplier;
    const legacyDocument = { ...identity, supplier: legacySupplier };

    await expect(
      Effect.runPromise(decodeInvoiceDocument(legacyDocument))
    ).resolves.toEqual(legacyDocument);
  });

  test("rejects schema-version fields", async () => {
    const document = makeInvoiceDocument({
      source,
      buyer: source.buyer,
      paymentAttemptId: "payment-attempt-id",
      invoiceNumber: formatInvoiceNumber({ year: 2026, sequence: 1 }),
      issuedAt: Temporal.Instant.from("2026-08-10T12:34:56.789Z"),
      paidAt,
    });

    for (const schemaVersion of [1, 2]) {
      await expect(
        Effect.runPromise(decodeInvoiceDocument({ ...document, schemaVersion }))
      ).rejects.toBeDefined();
    }
  });

  test("issues from an office reservation snapshot", async () => {
    const reservation = normalizedOfficeReservationOrderSchema.make({
      kind: "office",
      startsOn: "2099-06-20",
      endsOn: "2099-06-21",
      seats: 3,
      name: "Office Buyer",
      email: "office-buyer@example.test",
      phone: "+420 700 000 000",
    });
    const officeSource = makeAccountingDocumentSnapshot({
      workspaceReservationId: "office-reservation-id",
      dotyposReservationId: "dotypos-office-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      locale: "en-US",
      prepared: {
        kind: "office",
        reservation,
        quote: Effect.runSync(buildOfficeReservationQuote(reservation)),
      },
    });
    const document = makeInvoiceDocument({
      source: officeSource,
      buyer: officeSource.buyer,
      paymentAttemptId: "office-payment-attempt-id",
      invoiceNumber: formatInvoiceNumber({ year: 2026, sequence: 2 }),
      issuedAt: Temporal.Instant.from("2026-08-10T12:34:56.789Z"),
      paidAt,
    });

    expect(document).toMatchObject({
      reservation: {
        kind: "office",
        startsOn: "2099-06-20",
        endsOn: "2099-06-21",
        seats: 3,
      },
      quote: officeSource.quote,
    });
    await expect(
      Effect.runPromise(
        Schema.decodeUnknownEffect(invoiceDocumentSchema, {
          onExcessProperty: "error",
        })(document)
      )
    ).resolves.toEqual(document);
  });
});
