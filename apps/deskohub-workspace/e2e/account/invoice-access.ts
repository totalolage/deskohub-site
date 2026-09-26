import { expect, type Page } from "@playwright/test";
import { m } from "@/features/i18n";
import { workspaceE2ETimeouts } from "../timeouts";
import { selectAccountSection } from "./account-sections";
import { captureAccountReview } from "./review-screenshots";

const invoiceHistoryCopy = m.accountBillingInvoiceHistoryTitle(
  {},
  { locale: "en-US" }
);
const invoiceEmptyCopy = m.accountBillingInvoiceEmpty({}, { locale: "en-US" });

/**
 * Verifies the customer invoice surface of the linked account: the billing
 * section renders the real invoice-history state, a guessed invoice id is an
 * indistinguishable not-found even for a signed-in account, and the CSV
 * export never answers an unauthenticated request. Finishes with the
 * allowlisted invoice-history review captures.
 */
export const verifyCustomerInvoiceAccess = async (
  page: Page,
  baseUrl: string
): Promise<void> => {
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
  // The synthetic lane customer has no issued invoices, so the closed state
  // contract shows the localized empty copy and keeps the export disabled.
  await expect(page.getByText(invoiceEmptyCopy)).toBeVisible({
    timeout: workspaceE2ETimeouts.uiTransition,
  });

  // A signed-in owner guessing an invoice id gets the same not-found as an
  // anonymous request; the response is never a document.
  const guessedInvoiceId = "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb00";
  const guessedPdf = await page.request.get(
    new URL(
      `/en-US/account/invoices/${guessedInvoiceId}/pdf`,
      baseUrl
    ).toString()
  );
  expect(guessedPdf.status()).toBe(404);
  expect(guessedPdf.headers()["content-type"]).not.toContain("application/pdf");

  const anonymousContext = await page.context().browser()?.newContext();
  expect(anonymousContext).toBeDefined();
  try {
    const anonymousCsv = await anonymousContext?.request.get(
      new URL("/en-US/account/invoices/export", baseUrl).toString()
    );
    expect(anonymousCsv?.status()).not.toBe(200);
    expect(anonymousCsv?.headers()["content-type"]).not.toContain("text/csv");
  } finally {
    await anonymousContext?.close();
  }

  await captureAccountReview(page, baseUrl, "linked-invoices-desktop");
  await captureAccountReview(page, baseUrl, "linked-invoices-mobile");
};
