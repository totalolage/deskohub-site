import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { discountIdSchema } from "@/features/discounts/contracts";
import type { InvoiceDocument } from "./invoice";
import {
  makeCoworkInvoiceDocument,
  makeGoodsInvoiceDocument,
  makeMeetingRoomInvoiceDocument,
  makeOfficeInvoiceDocument,
  makeTestManualInvoiceDocument,
} from "./invoice.test-utils";
import { getInvoicePresentation } from "./invoice-presentation";

const normalize = (value: string) => value.replaceAll(/\s/g, " ");

describe("invoice presentation", () => {
  test("lays out identifiers beside issuance, fulfilment, and payment dates", () => {
    const presentation = getInvoicePresentation(
      makeMeetingRoomInvoiceDocument("en-US")
    );

    expect(presentation).toHaveProperty("factColumns", [
      [
        { label: "Invoice number", value: "WS-FV-2026-000002" },
        { label: "Order number", value: "reservation-2" },
      ],
      [
        { label: "Issuance date", value: "Aug 12, 2026" },
        { label: "Fulfilment date", value: "Aug 11, 2026" },
        { label: "Payment date", value: "Aug 10, 2026" },
      ],
    ]);
  });

  test.each([
    ["cs-CZ", "Faktura", "Basic Day Pass", "11. 8. 2026"],
    ["en-US", "Invoice", "Basic Day Pass", "Aug 11, 2026"],
  ] as const)("projects a %s cowork invoice", (locale, title, itemDescription, serviceDate) => {
    const presentation = getInvoicePresentation(
      makeCoworkInvoiceDocument(locale)
    );

    expect(presentation.title).toBe(title);
    expect(presentation.status).toBe(locale === "cs-CZ" ? "Uhrazeno" : "Paid");
    expect(presentation.factColumns.flat()).toContainEqual({
      label: locale === "cs-CZ" ? "Datum plnění" : "Fulfilment date",
      value: serviceDate,
    });
    expect(presentation.lines.map(({ description }) => description)).toEqual([
      itemDescription,
      locale === "cs-CZ" ? "Káva" : "Coffee",
    ]);
    expect(normalize(presentation.total)).toBe(
      locale === "cs-CZ" ? "400 Kč" : "CZK 400"
    );
  });

  test.each([
    ["cs-CZ", "Zasedací místnost · 4 hodiny", "11. 8. 2026"],
    ["en-US", "Meeting room · 4 hours", "Aug 11, 2026"],
  ] as const)("projects a %s meeting-room invoice", (locale, description, expectedServiceDate) => {
    const presentation = getInvoicePresentation(
      makeMeetingRoomInvoiceDocument(locale)
    );
    const serviceDate = presentation.factColumns
      .flat()
      .find(
        (fact) =>
          fact?.label ===
          (locale === "cs-CZ" ? "Datum plnění" : "Fulfilment date")
      )?.value;

    expect(presentation.lines[0]?.description).toBe(description);
    expect(serviceDate).toBe(expectedServiceDate);
    expect(serviceDate).not.toContain(":");
    expect(presentation.lines).toHaveLength(1);
  });

  test.each([
    ["cs-CZ", "Soukromá kancelář · 2 dny · 3 místa", "11. 8. 2026"],
    ["en-US", "Private office · 2 days · 3 seats", "Aug 11, 2026"],
  ] as const)("projects a %s office invoice", (locale, description, expectedServiceDate) => {
    const presentation = getInvoicePresentation(
      makeOfficeInvoiceDocument(locale)
    );
    const serviceDate = presentation.factColumns
      .flat()
      .find(
        (fact) =>
          fact?.label ===
          (locale === "cs-CZ" ? "Datum plnění" : "Fulfilment date")
      )?.value;

    expect(presentation.lines[0]?.description).toBe(description);
    expect(serviceDate).toBe(expectedServiceDate);
  });

  test("uses locale plural rules for invoice quantities", () => {
    const original = makeOfficeInvoiceDocument("cs-CZ");
    const document = {
      ...original,
      quote: {
        ...original.quote,
        items: original.quote.items.map((item) =>
          item.type === "office" ? { ...item, dayCount: 5, seats: 5 } : item
        ),
      },
    } as InvoiceDocument;

    expect(getInvoicePresentation(document).lines[0]?.description).toBe(
      "Soukromá kancelář · 5 dní · 5 míst"
    );
  });

  test("projects immutable supplier and business-buyer legal details", () => {
    const presentation = getInvoicePresentation(
      makeCoworkInvoiceDocument("cs-CZ", { businessBuyer: true })
    );

    expect(presentation.supplier).toEqual({
      heading: "Dodavatel",
      name: "Desktechub s.r.o.",
      details: [
        "Turnovská 430/10",
        "Libeň",
        "180 00 Praha 8",
        "Česko",
        "IČO: 24531596",
        "Obchodní rejstřík: C 442830, Městský soud v Praze",
        "workspace@deskohub.cz",
      ],
    });
    expect(presentation.buyer).toEqual({
      heading: "Odběratel",
      name: "Žluťoučký kůň s.r.o.",
      details: [
        "Příčná 12",
        "Dům číslo 3",
        "110 00 Praha",
        "Česko",
        "IČO: 12345678",
        "DIČ: CZ12345678",
      ],
    });
    expect(presentation.nonVatStatement).toBe("Nejsme plátci DPH.");
  });

  test("shows immutable discounts before the final paid total", () => {
    const original = makeCoworkInvoiceDocument("en-US");
    const money = (value: number) => ({
      value,
      exponent: 2,
      currency: "CZK" as const,
    });
    const document = {
      ...original,
      quote: {
        ...original.quote,
        payment: {
          expectedPrice: money(22_500),
          undiscountedPrice: money(40_000),
          discounts: [
            {
              discount: {
                id: Schema.decodeUnknownSync(discountIdSchema)("summer-sale"),
                label: "Summer sale",
                adjustment: { kind: "percentage" as const, basisPoints: 5000 },
              },
              subtotalBefore: money(35_000),
              amount: money(17_500),
              subtotalAfter: money(17_500),
            },
          ],
        },
      },
    } as InvoiceDocument;

    const presentation = getInvoicePresentation(document);

    expect(presentation.lines.at(-1)).toEqual({
      kind: "discount",
      description: "Discount: Summer sale",
      amount: "−CZK 175",
    });
    expect(normalize(presentation.total)).toBe("CZK 225");
  });

  test("projects allocated goods discounts and the exact fulfilment date", () => {
    const presentation = getInvoicePresentation(makeGoodsInvoiceDocument());

    expect(presentation.factColumns).toEqual([
      [
        { label: "Invoice number", value: "WS-FV-2026-000004" },
        { label: "Order number", value: "goods-order-1" },
      ],
      [
        { label: "Issuance date", value: "Aug 12, 2026" },
        { label: "Fulfilment date", value: "Aug 12, 2026" },
        { label: "Payment date", value: "Aug 10, 2026" },
      ],
    ]);
    expect(presentation.lines).toEqual([
      {
        kind: "item",
        description: "Sparkling water × 2",
        amount: "CZK 100",
      },
      { kind: "item", description: "Sandwich × 1", amount: "CZK 50" },
      {
        kind: "discount",
        description: "Discount: Member price",
        amount: "−CZK 25",
      },
    ]);
    expect(normalize(presentation.total)).toBe("CZK 125");
  });

  test("does not fabricate facts absent from a legacy issued invoice", () => {
    const current = makeCoworkInvoiceDocument("en-US");
    const {
      fulfilledAt: _fulfilledAt,
      paidAt: _paidAt,
      supplier,
      ...identity
    } = current;
    const { commercialRegister: _commercialRegister, ...legacySupplier } =
      supplier;
    const presentation = getInvoicePresentation({
      ...identity,
      supplier: legacySupplier,
    });

    const factLabels = presentation.factColumns
      .flat()
      .map((fact) => fact?.label);
    expect(factLabels).not.toContain("Fulfilment date");
    expect(factLabels).not.toContain("Payment date");
    expect(presentation.supplier.details).not.toContainEqual(
      expect.stringContaining("Commercial register")
    );
  });

  test.each([
    "0",
    "-100",
  ])("does not request payment for a %s total manual invoice", (price) => {
    const presentation = getInvoicePresentation(
      makeTestManualInvoiceDocument("en-US", price)
    );

    expect(presentation.status).toBe("Issued");
    expect(presentation.totalLabel).toBe("Total");
    expect(presentation.factColumns.flat()).not.toContainEqual(
      expect.objectContaining({ label: "Due date" })
    );
    expect(presentation.factColumns.flat()).not.toContainEqual(
      expect.objectContaining({ label: "Variable symbol" })
    );
  });

  test("presents an already-paid manual invoice as paid", () => {
    const document = makeTestManualInvoiceDocument("en-US", "450", {
      status: "paid",
      date: "2026-08-20",
    });
    const presentation = getInvoicePresentation(document);

    expect(presentation.status).toBe("Paid");
    expect(presentation.totalLabel).toBe("Total paid");
    expect(presentation.factColumns.flat()).toContainEqual({
      label: "Payment date",
      value: "Aug 20, 2026",
    });
    expect(presentation.factColumns.flat()).not.toContainEqual(
      expect.objectContaining({ label: "Due date" })
    );
  });
});
