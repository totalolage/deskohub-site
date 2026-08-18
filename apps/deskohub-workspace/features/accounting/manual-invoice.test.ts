import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { workspaceCurrencyDefinitions } from "@/shared/money/currencies";
import {
  formatInvoiceNumber,
  getInvoiceVariableSymbol,
  makeManualInvoiceDocument,
} from "./invoice";
import {
  findInvoicePaymentAccount,
  invoiceEnabledCurrencyDefinitions,
  manualInvoiceInputSchema,
  normalizeManualInvoiceInput,
} from "./manual-invoice";

const decodeInput = Schema.decodeUnknownSync(manualInvoiceInputSchema, {
  onExcessProperty: "error",
});

const input = decodeInput({
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
  lines: [
    { description: "Pronájem prostoru", price: "1000.20" },
    { description: "Sleva", price: "-0.20" },
    { description: "Pozornost", price: "0" },
  ],
  provenance: { source: "admin-ui", actor: "synthetic-admin" },
});

describe("manual invoice", () => {
  test("uses the canonical supported currencies and configured payment accounts", () => {
    for (const { code } of workspaceCurrencyDefinitions) {
      expect(() => decodeInput({ ...input, currency: code })).not.toThrow();
    }
    expect(() => decodeInput({ ...input, currency: "USD" })).toThrow();
    expect(invoiceEnabledCurrencyDefinitions.map(({ code }) => code)).toEqual([
      "CZK",
    ]);
    expect(findInvoicePaymentAccount("CZK")?.iban).toBe(
      "CZ0620100000002303459272"
    );
    expect(findInvoicePaymentAccount("EUR")).toBeUndefined();
  });

  test("normalizes and totals signed decimal strings exactly", async () => {
    const normalized = await Effect.runPromise(
      normalizeManualInvoiceInput(input)
    );
    expect(normalized.lines.map(({ price }) => price)).toEqual([
      "1000.2",
      "-0.2",
      "0",
    ]);
    expect(normalized.total).toBe("1000");
  });

  test("rejects precision beyond the selected currency", async () => {
    await expect(
      Effect.runPromise(
        normalizeManualInvoiceInput({
          ...input,
          lines: [{ description: "Too precise", price: "0.001" }],
        })
      )
    ).rejects.toMatchObject({ _tag: "ManualInvoiceValidationError" });
  });

  test("derives the Czech variable symbol from the allocated number", async () => {
    const invoiceNumber = formatInvoiceNumber({ year: 2026, sequence: 42 });
    expect(getInvoiceVariableSymbol(invoiceNumber)).toBe("2026000042");
    const normalized = await Effect.runPromise(
      normalizeManualInvoiceInput(input)
    );
    const document = makeManualInvoiceDocument({
      normalized,
      invoiceNumber,
      issuedAt: Temporal.Instant.from("2026-08-18T12:00:00Z"),
    });
    expect(document.variableSymbol).toBe("2026000042");
    expect(document.provenance).toEqual({
      source: "admin-ui",
      actor: "synthetic-admin",
      system: "deskohub-workspace",
      generatedAt: document.issuedAt,
    });
  });

  test("accepts only a one-to-ten digit variable symbol", () => {
    expect(() =>
      decodeInput({ ...input, variableSymbol: "1234567890" })
    ).not.toThrow();
    expect(() => decodeInput({ ...input, variableSymbol: "" })).toThrow();
    expect(() =>
      decodeInput({ ...input, variableSymbol: "12345678901" })
    ).toThrow();
    expect(() => decodeInput({ ...input, variableSymbol: "12A" })).toThrow();
  });
});
