import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  makeCoworkInvoiceDocument,
  makeGoodsInvoiceDocument,
  makeMeetingRoomInvoiceDocument,
  makeOfficeInvoiceDocument,
  makeTestManualInvoiceDocument,
} from "../invoice.test-utils";
import { renderInvoicePdf } from "./invoice-pdf";

const cases = [
  [
    "cowork cs-CZ",
    makeCoworkInvoiceDocument("cs-CZ", { businessBuyer: true }),
    "Faktura",
  ],
  ["cowork en-US", makeCoworkInvoiceDocument("en-US"), "Invoice"],
  [
    "meeting-room cs-CZ",
    makeMeetingRoomInvoiceDocument("cs-CZ"),
    "Zasedací místnost",
  ],
  [
    "meeting-room en-US",
    makeMeetingRoomInvoiceDocument("en-US"),
    "Meeting room",
  ],
  ["office cs-CZ", makeOfficeInvoiceDocument("cs-CZ"), "Soukromá kancelář"],
  ["office en-US", makeOfficeInvoiceDocument("en-US"), "Private office"],
  [
    "manual unpaid cs-CZ",
    makeTestManualInvoiceDocument("cs-CZ"),
    "Účet: 2303459272/2010",
  ],
  ["goods en-US", makeGoodsInvoiceDocument(), "Sparkling water"],
] as const;

describe("invoice PDF", () => {
  test("reserves the facts-row gap between equal flexible columns", async () => {
    const source = await Bun.file(
      new URL("./invoice-pdf.tsx", import.meta.url)
    ).text();
    const factColumnStyle = source.slice(
      source.indexOf("factColumn: {"),
      source.indexOf("fact: {")
    );

    expect(factColumnStyle).toContain("flexBasis: 0");
    expect(factColumnStyle).toContain("flexGrow: 1");
    expect(factColumnStyle).not.toContain('width: "50%"');
  });

  test.each(
    cases
  )("renders %s from the issued document", async (_, document, expectedText) => {
    const buffer = await Effect.runPromise(renderInvoicePdf(document));
    const parsed = await extractPdfText(buffer);

    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.subarray(-32).toString()).toContain("%%EOF");
    expect(buffer.byteLength).toBeGreaterThan(8_000);
    expect(parsed.pageCount).toBe(1);
    expect(parsed.text).toContain(expectedText);
    expect(parsed.text).toContain(document.invoiceNumber);
    expect(parsed.text).toContain("Desktechub s.r.o.");
  });

  test("preserves the same extracted presentation across repeat renders", async () => {
    const document = makeCoworkInvoiceDocument("cs-CZ", {
      businessBuyer: true,
    });
    const [first, second] = await Promise.all([
      Effect.runPromise(renderInvoicePdf(document)),
      Effect.runPromise(renderInvoicePdf(document)),
    ]);

    await expect(extractPdfText(first)).resolves.toEqual(
      await extractPdfText(second)
    );
  });

  test("embeds Czech glyphs from the local invoice font", async () => {
    const buffer = await Effect.runPromise(
      renderInvoicePdf(
        makeCoworkInvoiceDocument("cs-CZ", { businessBuyer: true })
      )
    );
    const { text } = await extractPdfText(buffer);

    expect(text).toContain("Žluťoučký kůň s.r.o.");
    expect(text).toContain("Příčná 12");
    expect(text).toContain("Nejsme plátci DPH.");
  });

  test("renders a paid manual invoice without payment instructions", async () => {
    const document = makeTestManualInvoiceDocument("cs-CZ", "450", {
      status: "paid",
      date: "2026-08-20",
    });
    const { text } = await extractPdfText(
      await Effect.runPromise(renderInvoicePdf(document))
    );

    expect(text).toContain("UHRAZENO");
    expect(text).toContain("DATUM ÚHRADY");
    expect(text).not.toContain("Platební údaje");
  });
});

const extractPdfText = async (buffer: Buffer) => {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
  });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replaceAll(/\s+/g, " ")
          .trim()
      );
    }

    return { pageCount: pdf.numPages, text: pages.join(" ") };
  } finally {
    await pdf.destroy();
  }
};
