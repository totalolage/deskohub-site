import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { m } from "@/features/i18n";
import {
  makeCoworkInvoiceDocument,
  makeTestManualInvoiceDocument,
} from "../invoice.test-utils";
import { getInvoicePresentation } from "../invoice-presentation";
import { findInvoicePaymentAccount } from "../manual-invoice";
import { renderInvoicePdf } from "./invoice-pdf";

describe("invoice PDF", () => {
  test("renders a Czech business invoice with glyphs from the local font", async () => {
    const document = makeCoworkInvoiceDocument("cs-CZ", {
      businessBuyer: true,
    });
    const buffer = await Effect.runPromise(renderInvoicePdf(document));
    const parsed = await extractPdfText(buffer);

    expectSinglePagePdf(buffer, parsed.pageCount);
    expect(parsed.text).toContain(document.invoiceNumber);
    expect(parsed.text).toContain("Žluťoučký kůň s.r.o.");
    expect(parsed.text).toContain("Příčná 12");
    for (const line of getInvoicePresentation(document).lines) {
      expect(parsed.text).toContain(line.description);
    }
  });

  test("renders the payment account block of an unpaid manual invoice", async () => {
    const document = makeTestManualInvoiceDocument("cs-CZ");
    const buffer = await Effect.runPromise(renderInvoicePdf(document));
    const parsed = await extractPdfText(buffer);

    expectSinglePagePdf(buffer, parsed.pageCount);
    expect(parsed.text).toContain(document.invoiceNumber);
    expect(parsed.text).toContain("One-off space rental");
    expect(parsed.text).toContain(
      `${m.invoicePaymentRequestAccount({}, { locale: "cs-CZ" })}: ${
        findInvoicePaymentAccount(document.currency)?.accountNumber
      }`
    );
  });

  // Issued invoices are re-rendered on demand instead of stored, so the same
  // issued document must always yield the same content, also when renders
  // share the registered font concurrently.
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

const expectSinglePagePdf = (buffer: Buffer, pageCount: number) => {
  expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  expect(buffer.subarray(-32).toString()).toContain("%%EOF");
  expect(pageCount).toBe(1);
};

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
    await loadingTask.destroy();
  }
};
