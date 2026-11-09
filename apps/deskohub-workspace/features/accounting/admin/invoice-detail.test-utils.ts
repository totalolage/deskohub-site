import {
  AdministrationDotyposCustomerId,
  AdministrationInvoiceId,
} from "@deskohub/workspace-admin-api";
import { InvoiceSettlement } from "@/features/accounting/invoice-settlement";
import { administrationHref } from "@/features/administration/administration-href";
import type { InvoiceAdministrationDetail } from "./invoice-administration.service";

const invoiceId = AdministrationInvoiceId.make(
  "01980000-0000-7000-8000-000000000042"
);

/** A synthetic invoice detail as the Admin UI receives it. */
export const invoiceAdministrationDetail = (
  overrides: Partial<InvoiceAdministrationDetail> = {}
): InvoiceAdministrationDetail => ({
  id: invoiceId,
  invoiceNumber: "DH-2026-0042",
  issuedAt: "2026-08-18T10:00:00.000Z",
  customerId: AdministrationDotyposCustomerId.make("dotypos-customer"),
  customerName: "Synthetic Customer",
  reservationId: null,
  total: "1000",
  currency: "CZK",
  paymentStatus: "due",
  source: "admin-ui",
  actor: null,
  delivery: { customer: "accepted", internal: "failed" },
  needsAttention: false,
  locale: "en-US",
  serviceDate: "2026-08-18",
  dueDate: "2026-09-01",
  paidOn: null,
  variableSymbol: null,
  lines: [{ description: "Space rental", price: "1000" }],
  buyer: {
    kind: "person",
    legalName: "Synthetic Customer",
    address: {
      line1: "Test street 1",
      city: "Prague",
      postalCode: "100 00",
      country: "CZ",
    },
  } as InvoiceAdministrationDetail["buyer"],
  pdfUrl: administrationHref("/[locale]/admin/invoices/[invoiceId]/pdf", {
    invoiceId,
  }),
  settlement: InvoiceSettlement.NothingDue({ statedDueDate: null }),
  ...overrides,
});
