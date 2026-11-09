import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "@playwright/test";
import { createElement } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import type { CustomerInvoiceHistory } from "@/features/account/contracts";
import { invoiceNumberSchema } from "@/features/accounting/invoice";
import { invoiceIdSchema } from "@/features/accounting/manual-invoice";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import { AccountShell } from "../shell/account-shell";
import { BillingScreen } from "./billing-screen";
import { InvoiceHistoryPanel } from "./invoice-history";

const locale = "en-US" as const;

const populated: CustomerInvoiceHistory = {
  kind: "populated",
  exportPath: "/en-US/account/invoices/export",
  invoices: ["000012", "000011"].map((serial, index) => ({
    invoice: {
      id: invoiceIdSchema.make(`018f47d2-8f7c-7c5e-9f9a-6ef21f${serial}`),
      invoiceNumber: invoiceNumberSchema.make(`WS-FV-2026-${serial}`),
      issuedOn: plainDateStringSchema.make("2026-10-01"),
      total: { amount: "1210.00", currency: "CZK" },
      paymentStatus: index === 0 ? "issued" : "paid",
      dueDate: index === 0 ? plainDateStringSchema.make("2026-10-15") : null,
    },
    display: {
      issuedOn: "October 1, 2026",
      total: "CZK 1,210.00",
      status: index === 0 ? "Issued" : "Paid",
      dueDate: index === 0 ? "October 15, 2026" : null,
    },
    pdfPath: `/en-US/account/invoices/WS-FV-2026-${serial}/pdf`,
  })),
};

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let appStyles = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  appStyles = await compileWorkspaceAppStyles();
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

/** The Billing section as the account page lays it out. */
const billingSection = (history: Promise<CustomerInvoiceHistory>) =>
  createElement(
    AccountShell,
    {
      activeSection: "billing",
      locale,
      onSectionChange: () => undefined,
      signOut: null,
    },
    createElement(
      BillingScreen,
      { locale },
      createElement("p", null, "Synthetic billing fields")
    ),
    createElement(
      "div",
      { className: "mt-6" },
      createElement(InvoiceHistoryPanel, { history, locale })
    )
  );

/** Server HTML once every boundary has resolved. */
const renderResolved = async (history: CustomerInvoiceHistory) => {
  const stream = await renderToReadableStream(
    billingSection(Promise.resolve(history))
  );
  await stream.allReady;
  return new Response(stream).text();
};

/** Server HTML while the history is still loading. */
const renderLoading = () =>
  renderToStaticMarkup(billingSection(new Promise(() => undefined)));

const openPage = async (html: string, viewportWidth: number) => {
  if (!browser)
    throw new Error("The invoice history browser has not launched.");
  const page = await browser.newPage({
    reducedMotion: "reduce",
    viewport: { height: 1000, width: viewportWidth },
  });
  await page.setContent(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>${html}</body></html>`
  );
  await page.addStyleTag({ content: appStyles });
  return page;
};

const box = async (page: Page, selector: string) => {
  const rect = await page.locator(selector).first().boundingBox();
  if (!rect) throw new Error(`${selector} is not rendered.`);
  return { ...rect, bottom: rect.y + rect.height, right: rect.x + rect.width };
};

const cellBoxes = (page: Page, rowSelector: string) =>
  page
    .locator(rowSelector)
    .first()
    .evaluate((row) =>
      [...row.children].map((cell) => {
        const rect = cell.getBoundingClientRect();
        return { x: rect.x, y: rect.y, bottom: rect.bottom, right: rect.right };
      })
    );

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.skipIf(!chromiumAvailable)(
  "places the invoice history in its own panel below the billing form",
  async () => {
    const page = await openPage(await renderResolved(populated), 1440);
    try {
      const billingForm = await box(
        page,
        '[data-slot="account-section-panel"]'
      );
      const invoices = await box(page, '[data-slot="invoice-history"]');

      expect(invoices.y - billingForm.bottom).toBeGreaterThanOrEqual(16);
      expect(Math.abs(invoices.x - billingForm.x)).toBeLessThan(1);
    } finally {
      await page.close();
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "lays each invoice out in one row of columns in a wide content area",
  async () => {
    const page = await openPage(await renderResolved(populated), 1440);
    try {
      const cells = await cellBoxes(page, '[data-slot="invoice-row"]');

      expect(cells).toHaveLength(5);
      for (const [index, cell] of cells.entries()) {
        const previous = cells[index - 1];
        if (previous) expect(cell.x).toBeGreaterThanOrEqual(previous.right);
        expect(cell.y).toBeLessThan(cells[0]?.bottom ?? 0);
      }
      const labels = await cellBoxes(
        page,
        '[data-slot="invoice-history"] [aria-hidden="true"].grid'
      );
      for (const [index, label] of labels.entries()) {
        expect(
          Math.abs(label.x - (cells[index]?.x ?? Number.NaN))
        ).toBeLessThan(1);
      }
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    } finally {
      await page.close();
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "stacks each invoice below its number on a phone without overflowing",
  async () => {
    const page = await openPage(await renderResolved(populated), 390);
    try {
      const cells = await cellBoxes(page, '[data-slot="invoice-row"]');
      const [number, issuedOn, total, status, download] = cells;
      const panel = await box(page, '[data-slot="invoice-history"]');

      expect(issuedOn?.y).toBeGreaterThanOrEqual(number?.bottom ?? 0);
      expect(total?.x).toBeGreaterThanOrEqual(issuedOn?.right ?? 0);
      expect(total?.y).toBe(issuedOn?.y ?? Number.NaN);
      expect(status?.y).toBeGreaterThanOrEqual(
        Math.max(issuedOn?.bottom ?? 0, total?.bottom ?? 0)
      );
      expect(download?.y).toBeGreaterThanOrEqual(status?.bottom ?? 0);
      expect(panel.right).toBeLessThanOrEqual(390);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    } finally {
      await page.close();
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "holds the body with two row-shaped skeletons in the same grid while loading",
  async () => {
    const page = await openPage(renderLoading(), 1440);
    try {
      const skeletonCells = await cellBoxes(
        page,
        '[data-slot="invoice-history-skeleton"] li'
      );
      const rows = await page
        .locator('[data-slot="invoice-history-skeleton"] li')
        .count();
      const status = await page
        .locator('[data-slot="invoice-history"] [role="status"]')
        .textContent();

      expect(rows).toBe(2);
      expect(skeletonCells).toHaveLength(5);
      for (const [index, cell] of skeletonCells.entries()) {
        const previous = skeletonCells[index - 1];
        if (previous) expect(cell.x).toBeGreaterThanOrEqual(previous.right);
        expect(cell.bottom - cell.y).toBeGreaterThan(0);
      }
      expect(status?.trim()).not.toBe("");
    } finally {
      await page.close();
    }
  }
);
