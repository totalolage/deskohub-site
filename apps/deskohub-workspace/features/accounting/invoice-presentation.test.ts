import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { discountIdSchema } from "@/features/discounts/contracts";
import type { InvoiceDocument } from "./invoice";
import {
  makeCoworkInvoiceDocument,
  makeMeetingRoomInvoiceDocument,
  makeOfficeInvoiceDocument,
} from "./invoice.test-utils";
import { getInvoicePresentation } from "./invoice-presentation";

const normalize = (value: string) => value.replaceAll(/\s/g, " ");

describe("invoice presentation", () => {
  test.each([
    ["cs-CZ", "Faktura", "Basic Day Pass", "1. 1. 2099"],
    ["en-US", "Invoice", "Basic Day Pass", "Jan 1, 2099"],
  ] as const)("projects a %s cowork invoice", (locale, title, itemDescription, serviceDate) => {
    const presentation = getInvoicePresentation(
      makeCoworkInvoiceDocument(locale)
    );

    expect(presentation.title).toBe(title);
    expect(presentation.status).toBe(locale === "cs-CZ" ? "Uhrazeno" : "Paid");
    expect(presentation.facts).toContainEqual({
      label: locale === "cs-CZ" ? "Datum plnění" : "Service date",
      value: serviceDate,
      wide: true,
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
    ["cs-CZ", "Zasedací místnost · 4 hodiny", "3. 2. 2099"],
    ["en-US", "Meeting room · 4 hours", "Feb 3, 2099"],
  ] as const)("projects a %s meeting-room invoice", (locale, description, expectedServiceDate) => {
    const presentation = getInvoicePresentation(
      makeMeetingRoomInvoiceDocument(locale)
    );
    const serviceDate = presentation.facts.find(
      ({ label }) =>
        label === (locale === "cs-CZ" ? "Datum plnění" : "Service date")
    )?.value;

    expect(presentation.lines[0]?.description).toBe(description);
    expect(serviceDate).toBe(expectedServiceDate);
    expect(serviceDate).not.toContain(":");
    expect(presentation.lines).toHaveLength(1);
  });

  test.each([
    ["cs-CZ", "Soukromá kancelář · 2 dny · 3 místa", "20.06.2099 – 21.06.2099"],
    ["en-US", "Private office · 2 days · 3 seats", "Jun 20 – 21, 2099"],
  ] as const)("projects a %s office invoice", (locale, description, expectedServiceDate) => {
    const presentation = getInvoicePresentation(
      makeOfficeInvoiceDocument(locale)
    );
    const serviceDate = presentation.facts.find(
      ({ label }) =>
        label === (locale === "cs-CZ" ? "Datum plnění" : "Service date")
    )?.value;

    expect(presentation.lines[0]?.description).toBe(description);
    expect(serviceDate).toBe(expectedServiceDate);
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

  test("does not fabricate facts absent from a legacy issued invoice", () => {
    const current = makeCoworkInvoiceDocument("en-US");
    const { paidAt: _paidAt, supplier, ...identity } = current;
    const { commercialRegister: _commercialRegister, ...legacySupplier } =
      supplier;
    const presentation = getInvoicePresentation({
      ...identity,
      supplier: legacySupplier,
    });

    expect(presentation.facts.map(({ label }) => label)).not.toContain(
      "Payment date"
    );
    expect(presentation.supplier.details).not.toContainEqual(
      expect.stringContaining("Commercial register")
    );
  });
});
