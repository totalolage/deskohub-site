import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
} from "@playwright/test";
import { m } from "@/features/i18n";
import { workspaceE2ETimeouts } from "../timeouts";
import { selectAccountSection } from "./account-sections";
import type { WorkspaceE2ECustomerInvoiceFixture } from "./invoice-fixture";
import { captureAccountReview } from "./review-screenshots";

const invoiceHistoryCopy = m.accountBillingInvoiceHistoryTitle(
  {},
  { locale: "en-US" }
);
const invoiceEmptyCopy = m.accountBillingInvoiceEmpty({}, { locale: "en-US" });

const privateNoStore = "private, no-store";

/** A fresh browser context that passes Vercel protection but holds no Better Auth session. */
const makeAnonymousBypassedContext = async (
  browser: Browser,
  baseUrl: string,
  bypassSecret: string | undefined
): Promise<BrowserContext> => {
  const context = await browser.newContext();
  if (bypassSecret) {
    const primed = await context.request.get(
      new URL("/favicon.svg", baseUrl).toString(),
      {
        headers: {
          "x-vercel-protection-bypass": bypassSecret,
          "x-vercel-set-bypass-cookie": "true",
        },
        maxRedirects: 3,
      }
    );
    await primed.dispose();
  }
  return context;
};

export type CustomerInvoiceAccessInput = {
  readonly baseUrl: string;
  readonly browser: Browser;
  /** Vercel automation bypass for the protected preview; never a runtime bypass. */
  readonly bypassSecret: string | undefined;
  readonly fixture: WorkspaceE2ECustomerInvoiceFixture;
  readonly page: Page;
};

/**
 * Verifies the customer invoice surface of the linked account against a
 * seeded issued invoice: the billing section renders the real invoice-history
 * rows, the owner can download the PDF and CSV of their own invoice, every
 * unowned or malformed invoice id is an indistinguishable private not-found,
 * the anonymous bypassed context is denied the CSV export with the exact
 * application 404. Finishes with the allowlist populated-billing review
 * captures; revocation denial is asserted separately against the revoked
 * fixture.
 */
export const verifyCustomerInvoiceAccess = async (
  input: CustomerInvoiceAccessInput
): Promise<void> => {
  const { baseUrl, browser, bypassSecret, fixture, page } = input;
  const accountUrl = new URL("/en-US/account", baseUrl);
  await page.goto(accountUrl.toString(), {
    timeout: workspaceE2ETimeouts.browserNavigation,
  });

  await selectAccountSection(page, "billing");

  const historyHeading = page.getByRole("heading", {
    exact: true,
    name: invoiceHistoryCopy,
  });
  await expect(historyHeading).toBeVisible({
    timeout: workspaceE2ETimeouts.uiTransition,
  });

  // The seeded issued invoice renders as an owned ledger row; the empty
  // state must be gone.
  await expect(page.getByText(fixture.invoiceNumber).first()).toBeVisible({
    timeout: workspaceE2ETimeouts.uiTransition,
  });
  await expect(page.getByText(invoiceEmptyCopy)).toHaveCount(0);

  // The owner downloads their own invoice as a PDF attachment.
  const ownedPdf = await page.request.get(
    new URL(fixture.pdfPath, baseUrl).toString()
  );
  expect(ownedPdf.status()).toBe(200);
  expect(ownedPdf.headers()["content-type"]).toContain("application/pdf");
  expect(ownedPdf.headers()["content-disposition"]).toContain("attachment");
  expect(ownedPdf.headers()["cache-control"]).toBe(privateNoStore);
  await ownedPdf.dispose();

  // The CSV export contains the real seeded invoice facts.
  const ownedCsv = await page.request.get(
    new URL("/en-US/account/invoices/export", baseUrl).toString()
  );
  expect(ownedCsv.status()).toBe(200);
  expect(ownedCsv.headers()["content-type"]).toContain("text/csv");
  expect(ownedCsv.headers()["content-disposition"]).toContain("attachment");
  expect(ownedCsv.headers()["cache-control"]).toBe(privateNoStore);
  const csvBody = await ownedCsv.text();
  expect(csvBody).toContain(fixture.invoiceNumber);
  expect(csvBody).toContain("450");

  // A guessed valid invoice id is an indistinguishable not-found; the
  // response is never a document.
  const guessedInvoiceId = "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb00";
  const guessedPdf = await page.request.get(
    new URL(
      `/en-US/account/invoices/${guessedInvoiceId}/pdf`,
      baseUrl
    ).toString()
  );
  expect(guessedPdf.status()).toBe(404);
  expect(guessedPdf.headers()["content-type"]).not.toContain("application/pdf");
  expect(guessedPdf.headers()["cache-control"]).toBe(privateNoStore);
  const guessedBody = await guessedPdf.text();
  await guessedPdf.dispose();

  // A malformed invoice id must land on the identical 404 path.
  const malformedPdf = await page.request.get(
    new URL("/en-US/account/invoices/not-a-uuid/pdf", baseUrl).toString()
  );
  expect(malformedPdf.status()).toBe(404);
  expect(malformedPdf.headers()["cache-control"]).toBe(privateNoStore);
  expect(await malformedPdf.text()).toBe(guessedBody);
  await malformedPdf.dispose();

  // An anonymous context that passes deployment protection but holds no
  // Better Auth session gets the application's own 404, never the export;
  // a protection rejection or server error fails the check.
  const anonymousContext = await makeAnonymousBypassedContext(
    browser,
    baseUrl,
    bypassSecret
  );
  try {
    const anonymousCsv = await anonymousContext.request.get(
      new URL("/en-US/account/invoices/export", baseUrl).toString()
    );
    expect(anonymousCsv.status()).toBe(404);
    expect(anonymousCsv.headers()["content-type"]).not.toContain("text/csv");
    await anonymousCsv.dispose();
  } finally {
    await anonymousContext.close();
  }

  await captureAccountReview(
    page,
    baseUrl,
    "linked-invoices-populated-desktop"
  );
  await captureAccountReview(page, baseUrl, "linked-invoices-populated-mobile");
};

/**
 * Asserts the download denial after the invoice fixture was revoked: the
 * previously owned id answers with the same private not-found and never a
 * document, while the CSV export stays an authorized 200 for the still
 * linked account — the revoked invoice number is simply gone from the body.
 */
export const verifyCustomerInvoiceRevoked = async (
  baseUrl: string,
  fixture: WorkspaceE2ECustomerInvoiceFixture,
  page: Page
): Promise<void> => {
  const revokedPdf = await page.request.get(
    new URL(fixture.pdfPath, baseUrl).toString()
  );
  expect(revokedPdf.status()).toBe(404);
  expect(revokedPdf.headers()["content-type"]).not.toContain("application/pdf");
  expect(revokedPdf.headers()["cache-control"]).toBe(privateNoStore);
  await revokedPdf.dispose();

  const exportedCsv = await page.request.get(
    new URL("/en-US/account/invoices/export", baseUrl).toString()
  );
  expect(exportedCsv.status()).toBe(200);
  expect(exportedCsv.headers()["content-type"]).toContain("text/csv");
  expect(exportedCsv.headers()["cache-control"]).toBe(privateNoStore);
  const csvBody = await exportedCsv.text();
  expect(csvBody).not.toContain(fixture.invoiceNumber);
  await exportedCsv.dispose();
};

/**
 * Asserts the download denial for a deletion-pending account with the issued
 * invoice still present: the activity guard stops the authorized download,
 * so both the PDF download and the CSV export answer with the same
 * indistinguishable private 404 — proving authorization denial, not a
 * missing invoice row.
 */
export const verifyCustomerInvoiceAccessDenied = async (
  baseUrl: string,
  fixture: WorkspaceE2ECustomerInvoiceFixture,
  page: Page
): Promise<void> => {
  const deniedPdf = await page.request.get(
    new URL(fixture.pdfPath, baseUrl).toString()
  );
  expect(deniedPdf.status()).toBe(404);
  expect(deniedPdf.headers()["content-type"]).not.toContain("application/pdf");
  expect(deniedPdf.headers()["cache-control"]).toBe(privateNoStore);
  await deniedPdf.dispose();

  const deniedCsv = await page.request.get(
    new URL("/en-US/account/invoices/export", baseUrl).toString()
  );
  expect(deniedCsv.status()).toBe(404);
  expect(deniedCsv.headers()["content-type"]).not.toContain("text/csv");
  expect(deniedCsv.headers()["cache-control"]).toBe(privateNoStore);
  await deniedCsv.dispose();
};
