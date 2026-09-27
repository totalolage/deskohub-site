import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { type ComponentPropsWithoutRef, act as reactAct } from "react";
import type { CustomerInvoiceListState } from "@/features/account/contracts";
import type { CustomerInvoiceSummary } from "@/features/accounting/customer-invoice";
import { type Locale, m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
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
  switch (kind) {
    case "populated":
      return null;
    case "empty":
      return m.accountBillingInvoiceEmpty({}, { locale });
    case "loading":
      return m.accountBillingInvoiceLoading({}, { locale });
    case "unavailable":
      return m.accountBillingInvoiceUnavailable({}, { locale });
    case "failed":
      return m.accountBillingInvoiceFailed({}, { locale });
  }
};

function renderBilling(
  locale: Locale,
  invoices: CustomerInvoiceListState | Promise<CustomerInvoiceListState>
): ReturnType<typeof render> {
  return render(
    <BillingScreen invoices={invoices} locale={locale}>
      <div>Caller-owned billing fields</div>
    </BillingScreen>
  );
}

describe("account billing invoice history", () => {
  for (const locale of ["en-US", "cs-CZ"] as const) {
    test(`shows a localized pending state before rendering invoices in ${locale}`, async () => {
      let resolveInvoices!: (state: CustomerInvoiceListState) => void;
      const pendingInvoices = new Promise<CustomerInvoiceListState>(
        (resolve) => {
          resolveInvoices = resolve;
        }
      );
      const loadingCopy = m.accountBillingInvoiceLoading({}, { locale });
      const actEnvironment = Object.getOwnPropertyDescriptor(
        globalThis,
        "IS_REACT_ACT_ENVIRONMENT"
      );
      Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
        configurable: true,
        value: true,
        writable: true,
      });
      let view: ReturnType<typeof render> | undefined;

      try {
        await reactAct(async () => {
          view = renderBilling(locale, pendingInvoices);
        });
        const rendered = view;
        if (!rendered) throw new Error("Billing screen was not rendered");
        expect(rendered.getByText(loadingCopy)).toBeTruthy();
        expect(
          rendered.getByRole("heading", {
            name: m.accountSectionBilling({}, { locale }),
          })
        ).toBeTruthy();
        const invoiceHistory = rendered.getByRole("region", {
          name: m.accountBillingInvoiceHistoryTitle({}, { locale }),
        });
        const status = invoiceHistory.querySelector("[role='status']");
        if (!status) throw new Error("Invoice loading status was not rendered");
        expect(status.getAttribute("aria-busy")).toBe("true");
        expect(status.textContent).toContain(loadingCopy);
        expect(
          invoiceHistory.querySelectorAll("[data-slot='skeleton']").length
        ).toBeGreaterThan(0);
        const exportButton = rendered.getByRole("button", {
          name: m.accountBillingExportInvoices({}, { locale }),
        });
        expect((exportButton as HTMLButtonElement).disabled).toBe(true);
        expect(exportButton.getAttribute("aria-describedby")).toBeNull();

        await reactAct(async () => {
          resolveInvoices(states.populated);
          await pendingInvoices;
        });

        expect(
          await rendered.findByRole("link", {
            name: m.accountBillingInvoiceDownloadAriaLabel(
              { invoiceNumber: dueInvoice.invoiceNumber },
              { locale }
            ),
          })
        ).toBeTruthy();
        expect(rendered.queryByText(loadingCopy)).toBeNull();
        expect(
          rendered.container.querySelectorAll("[data-slot='skeleton']")
        ).toHaveLength(0);
        expect(rendered.container.querySelector("[role='status']")).toBeNull();
      } finally {
        resolveInvoices(states.populated);
        cleanup();
        if (actEnvironment) {
          Object.defineProperty(
            globalThis,
            "IS_REACT_ACT_ENVIRONMENT",
            actEnvironment
          );
        } else {
          Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
        }
      }
    });
  }

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
                m.accountBillingExportInvoices({}, { locale })
              )
            );
          expect(exportButton).toBeTruthy();
          expect((exportButton as HTMLButtonElement).disabled).toBe(true);
          if (kind === "loading") {
            // The loading skeleton carries the status semantics itself; the
            // disabled export control stays free of a description reference.
            expect(exportButton?.getAttribute("aria-describedby")).toBeNull();
            expect(
              view.container.querySelectorAll("[data-slot='skeleton']").length
            ).toBeGreaterThan(0);
            const status = view.container.querySelector("[role='status']");
            expect(status).toBeTruthy();
            expect(status?.getAttribute("aria-busy")).toBe("true");
          } else {
            expect(exportButton?.getAttribute("aria-describedby")).toBeTruthy();
            expect(
              view.container.querySelectorAll("[data-slot='skeleton']")
            ).toHaveLength(0);
          }
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
        name: m.accountBillingExportInvoices({}, { locale }),
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
        name: m.accountBillingExportInvoices({}, { locale }),
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
      for (const label of [
        m.accountBillingAddPaymentCard({}, { locale }),
        m.accountBillingSyncAres({}, { locale }),
      ]) {
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
