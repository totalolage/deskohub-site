import { describe, expect, test } from "bun:test";
import {
  type CustomerInvoiceSummary,
  formatInvoiceAmount,
  formatInvoiceMinorUnits,
  getCustomerInvoiceSummary,
  renderCustomerInvoiceCsv,
} from "@/features/accounting/customer-invoice";
import {
  makeCoworkInvoiceDocument,
  makeTestManualInvoiceDocument,
} from "@/features/accounting/invoice.test-utils";

const issuedAt = Temporal.Instant.from("2026-08-12T12:34:56.789Z");

describe("customer invoice summary", () => {
  test("derives paid facts from a reservation invoice document", () => {
    const document = makeCoworkInvoiceDocument("en-US");
    const summary = getCustomerInvoiceSummary({
      id: "invoice-1",
      issuedAt,
      document,
    });
    expect(summary.paymentStatus).toBe("paid");
    expect(summary.dueDate).toBeNull();
    expect(summary.currency).toBe(
      document.quote.payment.expectedPrice.currency
    );
    expect(summary.total).toBe(
      formatInvoiceMinorUnits(
        document.quote.payment.expectedPrice.value,
        document.quote.payment.expectedPrice.exponent
      )
    );
    expect(summary.invoiceNumber).toBe(document.invoiceNumber);
  });

  test("derives due facts from a manual invoice document", () => {
    const document = makeTestManualInvoiceDocument("cs-CZ", "450", {
      status: "due",
      date: "2026-09-01",
    });
    const summary = getCustomerInvoiceSummary({
      id: "invoice-2",
      issuedAt,
      document,
    });
    expect(summary.paymentStatus).toBe("due");
    expect(summary.dueDate).toBe("2026-09-01");
    expect(summary.currency).toBe("CZK");
    expect(summary.total).toBe("450");
  });

  test("treats a settled manual invoice as paid without a due date", () => {
    const document = makeTestManualInvoiceDocument("en-US", "450", {
      status: "paid",
      date: "2026-08-20",
    });
    const summary = getCustomerInvoiceSummary({
      id: "invoice-3",
      issuedAt,
      document,
    });
    expect(summary.paymentStatus).toBe("paid");
    expect(summary.dueDate).toBeNull();
  });

  test("ignores a due date for a zero-total manual invoice", () => {
    const document = makeTestManualInvoiceDocument("en-US", "0", {
      status: "due",
      date: "2026-09-01",
    });
    const summary = getCustomerInvoiceSummary({
      id: "invoice-4",
      issuedAt,
      document,
    });
    expect(summary.paymentStatus).toBe("paid");
    expect(summary.dueDate).toBeNull();
  });

  test("stays stable when mutable provider data would change", () => {
    const document = makeCoworkInvoiceDocument("en-US");
    const first = getCustomerInvoiceSummary({
      id: "invoice-1",
      issuedAt,
      document,
    });
    const second = getCustomerInvoiceSummary({
      id: "invoice-1",
      issuedAt,
      document,
    });
    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toContain("Ada");
  });
});

describe("formatInvoiceMinorUnits", () => {
  test("formats minor units with the currency exponent", () => {
    expect(formatInvoiceMinorUnits(45000, 2)).toBe("450.00");
    expect(formatInvoiceMinorUnits(450, 0)).toBe("450");
    expect(formatInvoiceMinorUnits(-45050, 2)).toBe("-450.50");
  });
});

describe("formatInvoiceAmount", () => {
  test("formats ordinary amounts identically in both locales", () => {
    expect(formatInvoiceAmount("450", "CZK", "cs-CZ")).toBe("450\u00a0Kč");
    expect(formatInvoiceAmount("450.00", "CZK", "cs-CZ")).toBe(
      "450,00\u00a0Kč"
    );
    expect(formatInvoiceAmount("450", "USD", "en-US")).toBe("$450");
    expect(formatInvoiceAmount("450.00", "USD", "en-US")).toBe("$450.00");
    expect(formatInvoiceAmount("1234.5", "USD", "en-US")).toBe("$1,234.5");
    expect(formatInvoiceAmount("1234.5", "CZK", "cs-CZ")).toBe(
      "1\u00a0234,5\u00a0Kč"
    );
  });

  test("keeps exact digits for amounts beyond the safe-integer range", () => {
    const beyondSafeInteger = "9007199254740993.25";
    expect(formatInvoiceAmount(beyondSafeInteger, "USD", "en-US")).toBe(
      "$9,007,199,254,740,993.25"
    );
    expect(formatInvoiceAmount(beyondSafeInteger, "CZK", "cs-CZ")).toBe(
      "9\u00a0007\u00a0199\u00a0254\u00a0740\u00a0993,25\u00a0Kč"
    );
  });
});

describe("renderCustomerInvoiceCsv", () => {
  const summaries: readonly CustomerInvoiceSummary[] = [
    {
      id: "invoice-1",
      invoiceNumber: "WS-FV-2026-000042",
      issuedAt: "2026-08-12T12:34:56.789Z",
      total: "450",
      currency: "CZK",
      paymentStatus: "due",
      dueDate: "2026-09-01",
    },
    {
      id: "invoice-2",
      invoiceNumber: "WS-FV-2026-000007",
      issuedAt: "2026-07-01T09:00:00.000Z",
      total: "1200",
      currency: "CZK",
      paymentStatus: "paid",
      dueDate: null,
    },
  ];

  test("writes localized headers and real ledger facts", () => {
    const csv = renderCustomerInvoiceCsv(summaries, "en-US");
    const [header, first, second] = csv.split("\r\n");
    expect(header).toBe(
      "Invoice number,Issuance date,Amount,Currency,Status,Due date"
    );
    expect(first).toContain("WS-FV-2026-000042");
    expect(first).toContain(",450,CZK,");
    expect(first).toContain("2026-09-01");
    expect(second).toContain("WS-FV-2026-000007");
    expect(second.endsWith(",")).toBe(true);
  });

  test("localizes headers and statuses for Czech exports", () => {
    const csv = renderCustomerInvoiceCsv(summaries, "cs-CZ");
    const [header, first] = csv.split("\r\n");
    expect(header).toBe(
      "Číslo faktury,Datum vystavení,Částka,Měna,Stav,Datum splatnosti"
    );
    expect(first).toContain("WS-FV-2026-000042");
  });

  test("keeps one row per issued invoice without duplicates", () => {
    const csv = renderCustomerInvoiceCsv(summaries, "en-US");
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv.match(/WS-FV-2026-000042/g)).toHaveLength(1);
  });

  test("derives summaries from both invoice kinds without joins", () => {
    const manual = makeTestManualInvoiceDocument("en-US");
    const reservation = makeCoworkInvoiceDocument("en-US");
    const rows = [
      getCustomerInvoiceSummary({
        id: "manual-id",
        issuedAt,
        document: manual,
      }),
      getCustomerInvoiceSummary({
        id: "reservation-id",
        issuedAt,
        document: reservation,
      }),
    ];
    expect(rows[0].id).toBe("manual-id");
    expect(rows[1].id).toBe("reservation-id");
    expect(rows[0].currency).toBe("CZK");
    expect(rows[1].currency).toBe(
      reservation.quote.payment.expectedPrice.currency
    );
  });
});
