import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type {
  CustomerInvoiceHistory,
  CustomerInvoiceHistoryItem,
} from "@/features/account/contracts";
import { invoiceNumberSchema } from "@/features/accounting/invoice";
import type { InvoicePaymentStatus } from "@/features/accounting/invoice-settlement";
import { invoiceIdSchema } from "@/features/accounting/manual-invoice";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { plainDateStringSchema } from "@/shared/utils/temporal";

registerWorkspaceComponentTestEnv();

const { act, cleanup, render } = await import("@testing-library/react");
const { InvoiceHistoryPanel } = await import("./invoice-history");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const historyItem = (
  invoiceNumber: string,
  paymentStatus: InvoicePaymentStatus,
  dueDate: string | null
): CustomerInvoiceHistoryItem => ({
  invoice: {
    id: invoiceIdSchema.make(
      `018f47d2-8f7c-7c5e-9f9a-${invoiceNumber.replaceAll(/\D/g, "").slice(-12).padStart(12, "0")}`
    ),
    invoiceNumber: invoiceNumberSchema.make(invoiceNumber),
    issuedOn: plainDateStringSchema.make("2026-10-01"),
    total: { amount: "1210.00", currency: "CZK" },
    paymentStatus,
    dueDate: dueDate === null ? null : plainDateStringSchema.make(dueDate),
  },
  display: {
    issuedOn: "synthetic-issued-on",
    total: "synthetic-total",
    status: "synthetic-status",
    dueDate: dueDate === null ? null : "synthetic-due-date",
  },
  pdfPath: `/en-US/account/invoices/${invoiceNumber}/pdf`,
});

const populated: CustomerInvoiceHistory = {
  kind: "populated",
  invoices: [
    historyItem("WS-FV-2026-000002", "issued", "2026-10-15"),
    historyItem("WS-FV-2026-000001", "paid", null),
  ],
  exportPath: "/en-US/account/invoices/export",
};

/** Renders the panel and lets a settled history stream in. */
const renderPanel = async (history: Promise<CustomerInvoiceHistory>) => {
  let view: ReturnType<typeof render> | undefined;
  await act(async () => {
    view = render(<InvoiceHistoryPanel history={history} locale="en-US" />);
  });
  if (!view) throw new Error("The invoice history panel did not render.");
  return view;
};

const status = (container: HTMLElement) =>
  container.querySelector('[role="status"]');

describe("InvoiceHistoryPanel", () => {
  test("holds two row-shaped skeletons and announces loading in a mounted status region", async () => {
    let resolve: (history: CustomerInvoiceHistory) => void = () => undefined;
    const history = new Promise<CustomerInvoiceHistory>((settle) => {
      resolve = settle;
    });
    const view = await renderPanel(history);
    const region = status(view.container);
    const skeleton = view.container.querySelector(
      '[data-slot="invoice-history-skeleton"]'
    );

    expect(region?.textContent).not.toBe("");
    expect(skeleton?.getAttribute("aria-hidden")).toBe("true");
    expect(skeleton?.querySelectorAll("li")).toHaveLength(2);
    expect(
      view.container.querySelector('[data-slot="invoice-row"]')
    ).toBeNull();

    await act(async () => {
      resolve(populated);
      await history;
    });

    expect(status(view.container)).toBe(region);
    expect(region?.textContent).toBe("");
    expect(
      view.container.querySelector('[data-slot="invoice-history-skeleton"]')
    ).toBeNull();
  });

  test("lists each invoice with its own PDF download and offers the CSV export", async () => {
    const view = await renderPanel(Promise.resolve(populated));
    const rows = view.container.querySelectorAll('[data-slot="invoice-row"]');
    const pdfLinks = [
      ...view.container.querySelectorAll('[data-slot="invoice-pdf"]'),
    ];
    const exportLink = view.container.querySelector(
      '[data-slot="invoice-export"]'
    );

    expect(rows).toHaveLength(2);
    expect(pdfLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/en-US/account/invoices/WS-FV-2026-000002/pdf",
      "/en-US/account/invoices/WS-FV-2026-000001/pdf",
    ]);
    expect(pdfLinks.every((link) => link.hasAttribute("download"))).toBe(true);
    expect(pdfLinks[0]?.textContent).toContain("WS-FV-2026-000002");
    expect(exportLink?.getAttribute("href")).toBe(
      "/en-US/account/invoices/export"
    );
    expect(exportLink?.hasAttribute("download")).toBe(true);
    expect(rows[0]?.textContent).toContain("synthetic-due-date");
    expect(rows[1]?.textContent).not.toContain("synthetic-due-date");
  });

  test.each(["empty", "unavailable", "failed"] as const)(
    "shows the %s history as one message without rows or downloads",
    async (kind) => {
      const view = await renderPanel(Promise.resolve({ kind }));
      const message = view.container.querySelector(
        `[data-slot="invoice-history-${kind}"]`
      );

      expect(message?.textContent).not.toBe("");
      expect(
        view.container.querySelector('[data-slot="invoice-row"]')
      ).toBeNull();
      expect(
        view.container.querySelector('[data-slot="invoice-export"]')
      ).toBeNull();
      expect(
        view.container.querySelector('[data-slot="invoice-history-skeleton"]')
      ).toBeNull();
    }
  );
});
