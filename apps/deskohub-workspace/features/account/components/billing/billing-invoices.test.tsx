import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import type { CustomerInvoiceListState } from "@/features/account/contracts";
import type { CustomerInvoiceSummary } from "@/features/accounting/customer-invoice";
import { type Locale, m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { getAccountScreenCopy } from "../account-screen-copy";
import { BillingScreen } from "./billing-screen";

type MockNextLinkProps = ComponentPropsWithoutRef<"a"> & {
  readonly href: string;
};

function MockNextLink({ children, href, ...props }: MockNextLinkProps) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}

mock.module("next/link", () => ({ default: MockNextLink }));

registerWorkspaceComponentTestEnv();
afterAll(unregisterWorkspaceComponentTestEnv);

const dueInvoice: CustomerInvoiceSummary = {
  id: "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb23",
  invoiceNumber: "WS-FV-2026-000042",
  issuedAt: "2026-08-12T12:34:56.789Z",
  total: "450",
  currency: "CZK",
  paymentStatus: "due",
  dueDate: "2026-09-01",
};

const paidInvoice: CustomerInvoiceSummary = {
  id: "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb99",
  invoiceNumber: "WS-FV-2026-000007",
  issuedAt: "2026-07-01T09:00:00.000Z",
  total: "1200.50",
  currency: "CZK",
  paymentStatus: "paid",
  dueDate: null,
};

const states = {
  populated: {
    kind: "populated",
    invoices: [dueInvoice, paidInvoice],
  },
  empty: { kind: "empty" },
  loading: { kind: "loading" },
  unavailable: { kind: "unavailable" },
  failed: { kind: "failed" },
} satisfies Record<CustomerInvoiceListState["kind"], CustomerInvoiceListState>;

const stateCopy = (locale: Locale, kind: CustomerInvoiceListState["kind"]) => {
  const copy = getAccountScreenCopy(locale).billing;
  switch (kind) {
    case "populated":
      return null;
    case "empty":
      return copy.invoiceEmpty;
    case "loading":
      return copy.invoiceLoading;
    case "unavailable":
      return copy.invoiceUnavailable;
    case "failed":
      return copy.invoiceFailed;
  }
};

function renderBilling(
  locale: Locale,
  invoices: CustomerInvoiceListState
): ReturnType<typeof render> {
  return render(
    <BillingScreen
      copy={getAccountScreenCopy(locale).billing}
      invoices={invoices}
      locale={locale}
    >
      <div>Caller-owned billing fields</div>
    </BillingScreen>
  );
}

describe("account billing invoice history", () => {
  for (const locale of ["en-US", "cs-CZ"] as const) {
    for (const kind of [
      "populated",
      "empty",
      "loading",
      "unavailable",
      "failed",
    ] as const) {
      test(`renders the ${kind} invoice state in ${locale}`, () => {
        const view = renderBilling(locale, states[kind]);
        const expectedCopy = stateCopy(locale, kind);
        if (expectedCopy === null) {
          expect(
            view.getByRole("link", {
              name: m.accountBillingInvoiceDownloadAriaLabel(
                { invoiceNumber: dueInvoice.invoiceNumber },
                { locale }
              ),
            })
          ).toBeTruthy();
        } else {
          expect(view.getByText(expectedCopy)).toBeTruthy();
          // Non-populated states keep the export control disabled and
          // pointing at the reason instead of offering a dead download.
          const exportButton = view
            .getAllByRole("button")
            .find((button) =>
              button.textContent?.includes(
                getAccountScreenCopy(locale).billing.exportInvoices
              )
            );
          expect(exportButton).toBeTruthy();
          expect((exportButton as HTMLButtonElement).disabled).toBe(true);
          expect(exportButton?.getAttribute("aria-describedby")).toBeTruthy();
        }
        cleanup();
      });
    }

    test(`localizes fractional invoice amounts in ${locale}`, () => {
      const view = renderBilling(locale, states.populated);
      // 1200.50 CZK keeps its exact minor-unit precision in both locales;
      // these are the actual Intl.NumberFormat outputs for each locale.
      const expected =
        locale === "cs-CZ" ? "1\u00a0200,50\u00a0Kč" : "CZK\u00a01,200.50";
      const row = view
        .getByText(paidInvoice.invoiceNumber)
        .closest("li")?.textContent;
      expect(row).toContain(expected);
      // The raw stored decimal and bare currency code never render as-is.
      expect(row).not.toContain("1200.50");
      expect(row).not.toContain("1200.50 CZK");
      cleanup();
    });

    test(`keeps working invoice controls outside future-feature wrappers in ${locale}`, () => {
      const view = renderBilling(locale, states.populated);
      const download = view.getByRole("link", {
        name: m.accountBillingInvoiceDownloadAriaLabel(
          { invoiceNumber: dueInvoice.invoiceNumber },
          { locale }
        ),
      });
      expect(download.closest("[tabindex='0']")).toBeNull();
      const exportLink = view.getByRole("link", {
        name: getAccountScreenCopy(locale).billing.exportInvoices,
      });
      expect(exportLink.closest("[tabindex='0']")).toBeNull();
      cleanup();
    });

    test(`exposes real invoice navigation targets in ${locale}`, () => {
      const view = renderBilling(locale, states.populated);
      const download = view.getByRole("link", {
        name: m.accountBillingInvoiceDownloadAriaLabel(
          { invoiceNumber: dueInvoice.invoiceNumber },
          { locale }
        ),
      }) as HTMLAnchorElement;
      expect(download.getAttribute("href")).toBe(
        `/${locale}/account/invoices/${dueInvoice.id}/pdf`
      );
      expect(download.tagName).toBe("A");
      const exportLink = view.getByRole("link", {
        name: getAccountScreenCopy(locale).billing.exportInvoices,
      }) as HTMLAnchorElement;
      expect(exportLink.getAttribute("href")).toBe(
        `/${locale}/account/invoices/export`
      );
      cleanup();
    });

    test(`keeps invoice row links keyboard operable in ${locale}`, () => {
      const view = renderBilling(locale, states.populated);
      const download = view.getByRole("link", {
        name: m.accountBillingInvoiceDownloadAriaLabel(
          { invoiceNumber: dueInvoice.invoiceNumber },
          { locale }
        ),
      });
      act(() => {
        download.focus();
      });
      expect(document.activeElement).toBe(download);
      cleanup();
    });

    test(`keeps invoice downloads out of form submission in ${locale}`, () => {
      const view = renderBilling(locale, states.populated);
      const download = view.getByRole("link", {
        name: m.accountBillingInvoiceDownloadAriaLabel(
          { invoiceNumber: dueInvoice.invoiceNumber },
          { locale }
        ),
      }) as HTMLAnchorElement;
      expect(download.tagName).toBe("A");
      // Even if an ancestor form exists, an anchor never submits it.
      expect(download.getAttribute("type")).not.toBe("submit");
      const form = document.createElement("form");
      download.parentElement?.append(form);
      expect(() =>
        fireEvent.submit(form, { preventDefault: () => undefined })
      ).not.toThrow();
      expect(document.contains(download)).toBe(true);
      cleanup();
    });

    test(`keeps payment and ARES controls as disabled future features in ${locale}`, () => {
      const view = renderBilling(locale, states.populated);
      const copy = getAccountScreenCopy(locale).billing;
      for (const label of [copy.addPaymentCard, copy.syncAres]) {
        const control = view
          .getAllByRole("button")
          .find((button) => button.textContent?.includes(label));
        expect(control).toBeTruthy();
        expect((control as HTMLButtonElement).disabled).toBe(true);
        const wrapper = control?.closest<HTMLElement>("[tabindex='0']");
        expect(wrapper).toBeTruthy();
        expect(wrapper?.getAttribute("role")).toBe("group");
      }
      cleanup();
    });
  }

  test("does not count invoice controls in the future-feature inventory", () => {
    // The populated list renders zero future-feature groups; only the
    // payment-card and ARES controls keep their tooltip wrappers.
    const view = renderBilling("en-US", states.populated);
    expect(
      view.container.querySelectorAll("[role='group'][tabindex='0']")
    ).toHaveLength(2);
    cleanup();
  });
});
