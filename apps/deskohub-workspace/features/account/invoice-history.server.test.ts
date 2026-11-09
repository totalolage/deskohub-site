import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
  type CustomerInvoiceSummary,
  getCustomerInvoiceStatusLabel,
} from "@/features/accounting/customer-invoice";
import { invoiceNumberSchema } from "@/features/accounting/invoice";
import { formatInvoiceTotal } from "@/features/accounting/invoice-settlement";
import { invoiceIdSchema } from "@/features/accounting/manual-invoice";
import { formatPlainDate } from "@/shared/utils/date-time-format";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import {
  CustomerInvoiceService,
  CustomerInvoicesLoadError,
  CustomerInvoicesUnavailableError,
} from "./backend/customer-invoice.service";
import {
  loadCustomerInvoiceHistory,
  loadInvoiceHistory,
} from "./invoice-history.server";
import {
  getAccountInvoiceExportPath,
  getAccountInvoicePdfPath,
} from "./routes";

const dueInvoice: CustomerInvoiceSummary = {
  id: invoiceIdSchema.make("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb23"),
  invoiceNumber: invoiceNumberSchema.make("WS-FV-2026-000042"),
  issuedOn: plainDateStringSchema.make("2026-08-20"),
  total: { amount: "450.50", currency: "CZK" },
  paymentStatus: "due",
  dueDate: plainDateStringSchema.make("2026-09-01"),
};
const paidInvoice: CustomerInvoiceSummary = {
  id: invoiceIdSchema.make("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb24"),
  invoiceNumber: invoiceNumberSchema.make("WS-FV-2026-000041"),
  issuedOn: plainDateStringSchema.make("2026-08-10"),
  total: { amount: "1200", currency: "CZK" },
  paymentStatus: "paid",
  dueDate: null,
};

const loadWith = (
  list: CustomerInvoiceService["Service"]["list"],
  locale: "cs-CZ" | "en-US" = "cs-CZ"
) =>
  Effect.runPromise(
    loadInvoiceHistory(locale).pipe(
      Effect.provide(Layer.mock(CustomerInvoiceService, { list }))
    )
  );

describe("loadInvoiceHistory", () => {
  test("lists the account's invoices formatted in the locale", async () => {
    const history = await loadWith(Effect.succeed([dueInvoice, paidInvoice]));

    const date = (value: string) =>
      formatPlainDate({
        date: Temporal.PlainDate.from(value),
        locale: "cs-CZ",
      });
    expect(history).toEqual({
      kind: "populated",
      invoices: [
        {
          invoice: dueInvoice,
          display: {
            issuedOn: date("2026-08-20"),
            total: formatInvoiceTotal(dueInvoice.total, "cs-CZ"),
            status: getCustomerInvoiceStatusLabel("due", "cs-CZ"),
            dueDate: date("2026-09-01"),
          },
          pdfPath: getAccountInvoicePdfPath("cs-CZ", dueInvoice.id),
        },
        {
          invoice: paidInvoice,
          display: {
            issuedOn: date("2026-08-10"),
            total: formatInvoiceTotal(paidInvoice.total, "cs-CZ"),
            status: getCustomerInvoiceStatusLabel("paid", "cs-CZ"),
            dueDate: null,
          },
          pdfPath: getAccountInvoicePdfPath("cs-CZ", paidInvoice.id),
        },
      ],
      exportPath: getAccountInvoiceExportPath("cs-CZ"),
    });
  });

  test("links the downloads under the page's locale", async () => {
    const history = await loadWith(Effect.succeed([dueInvoice]), "en-US");

    expect(history.kind === "populated" && history.exportPath).toBe(
      "/en-US/account/invoices/export"
    );
    expect(history.kind === "populated" && history.invoices[0]?.pdfPath).toBe(
      `/en-US/account/invoices/${dueInvoice.id}/pdf`
    );
  });

  test("is empty when the account has no invoices", async () => {
    expect(await loadWith(Effect.succeed([]))).toEqual({ kind: "empty" });
  });

  test("is unavailable when the session may see no invoices", async () => {
    expect(
      await loadWith(Effect.fail(new CustomerInvoicesUnavailableError()))
    ).toEqual({ kind: "unavailable" });
  });

  test("fails when the invoices can't be read", async () => {
    expect(
      await loadWith(
        Effect.fail(new CustomerInvoicesLoadError({ code: "invoice.read" }))
      )
    ).toEqual({ kind: "failed" });
  });

  test("fails on a defect instead of failing the page", async () => {
    expect(await loadWith(Effect.die(new Error("synthetic defect")))).toEqual({
      kind: "failed",
    });
  });
});

describe("loadCustomerInvoiceHistory", () => {
  test("loads the history through the page runner", async () => {
    expect(
      await loadCustomerInvoiceHistory(
        "en-US",
        Layer.mock(CustomerInvoiceService, { list: Effect.succeed([]) })
      )
    ).toEqual({ kind: "empty" });
  });

  test("fails when the service can't be built", async () => {
    expect(
      await loadCustomerInvoiceHistory(
        "en-US",
        Layer.effect(
          CustomerInvoiceService,
          Effect.fail(new Error("synthetic configuration failure"))
        )
      )
    ).toEqual({ kind: "failed" });
  });
});
