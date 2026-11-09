import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import {
  AdministrationDotyposCustomerId,
  AdministrationInvoiceId,
} from "@deskohub/workspace-admin-api";
import { cleanup, render } from "@testing-library/react";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { InvoiceAdministrationTableRow } from "./invoice-table";

mock.module("./actions", () => ({
  retryAdministrationInvoice: async () => ({}),
}));

let InvoiceAdministrationTable: typeof import("./invoice-table").InvoiceAdministrationTable;

beforeAll(async () => {
  registerWorkspaceComponentTestEnv();
  ({ InvoiceAdministrationTable } = await import("./invoice-table"));
});
afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const invoice: InvoiceAdministrationTableRow = {
  id: AdministrationInvoiceId.make("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb21"),
  invoiceNumber: "2026000001",
  issuedAt: "2026-08-18T10:30:00Z",
  issuedAtLabel: "18. 8. 2026 12:30",
  customerId: AdministrationDotyposCustomerId.make("1"),
  customerName: "Synthetic Customer",
  reservationId: null,
  total: "1000.00",
  totalLabel: "1 000 Kč",
  currency: "CZK",
  paymentStatus: "overdue",
  source: "admin-ui",
  actor: null,
  delivery: { customer: "failed", internal: "accepted" },
  needsAttention: true,
};

test("renders the invoice table in Czech on a Czech route", () => {
  workspaceUseAction.mockImplementation(
    () => ({ execute: mock(), isExecuting: false }) as never
  );
  const view = render(
    <RouteLocaleProvider locale="cs-CZ">
      <InvoiceAdministrationTable items={[invoice]} query={{}} />
    </RouteLocaleProvider>
  );

  expect(view.getByRole("table", { name: "Faktury" })).toBeTruthy();
  for (const header of ["Odběratel", "Vystaveno", "Celkem", "Původ"]) {
    expect(view.getByRole("columnheader", { name: header })).toBeTruthy();
  }
  expect(view.getAllByText("Po splatnosti").length).toBeGreaterThan(0);
  expect(view.getAllByText("Nutné znovu odeslat").length).toBeGreaterThan(0);
  expect(view.getAllByText("Administrace").length).toBeGreaterThan(0);
  expect(view.getByText("Vystaveno 18. 8. 2026 12:30")).toBeTruthy();
  expect(
    view.getAllByRole("button", { name: "Znovu odeslat 2026000001" }).length
  ).toBeGreaterThan(0);
});
