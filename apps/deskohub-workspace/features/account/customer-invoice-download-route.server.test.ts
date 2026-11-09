import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
  type CustomerInvoiceSummary,
  getCustomerInvoiceCsvColumns,
} from "@/features/accounting/customer-invoice";
import { invoiceNumberSchema } from "@/features/accounting/invoice";
import { invoiceIdSchema } from "@/features/accounting/manual-invoice";
import { captureWorkspaceLogs } from "@/shared/testing/workspace-telemetry.test-utils";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import {
  CustomerInvoiceNotFoundError,
  CustomerInvoiceService,
  CustomerInvoicesLoadError,
  CustomerInvoicesUnavailableError,
} from "./backend/customer-invoice.service";
import {
  makeCustomerInvoiceExportGet,
  makeCustomerInvoicePdfGet,
} from "./customer-invoice-download-route.server";

const workspaceLogs = captureWorkspaceLogs();

const ownInvoiceId = "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb23";
const otherCustomersInvoiceId = "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb99";
const pdfBytes = new TextEncoder().encode("%PDF-1.7 synthetic");

const summary: CustomerInvoiceSummary = {
  id: invoiceIdSchema.make(ownInvoiceId),
  invoiceNumber: invoiceNumberSchema.make("WS-FV-2026-000042"),
  issuedOn: plainDateStringSchema.make("2026-08-20"),
  total: { amount: "450.50", currency: "CZK" },
  paymentStatus: "due",
  dueDate: plainDateStringSchema.make("2026-09-01"),
};

type Outcome = "own" | "not-found" | "unavailable" | "load-failed";

let outcome: Outcome;
let requestedInvoiceIds: string[];

beforeEach(() => {
  outcome = "own";
  requestedInvoiceIds = [];
  workspaceLogs.reset();
});

const refuse = () =>
  outcome === "unavailable"
    ? Effect.fail(new CustomerInvoicesUnavailableError())
    : Effect.fail(new CustomerInvoicesLoadError({ code: "invoice.read" }));

const service = Layer.mock(CustomerInvoiceService, {
  pdf: (invoiceId) =>
    Effect.suspend(() => {
      requestedInvoiceIds.push(invoiceId);
      if (outcome === "own" && invoiceId === ownInvoiceId) {
        return Effect.succeed({
          bytes: pdfBytes,
          fileName: `${summary.invoiceNumber}.pdf`,
        });
      }
      if (outcome === "own" || outcome === "not-found") {
        return Effect.fail(new CustomerInvoiceNotFoundError());
      }
      return refuse();
    }),
  csv: (locale) =>
    Effect.suspend(() =>
      outcome === "own"
        ? Effect.succeed({
            filename: "invoices-2026-09-02.csv",
            columns: getCustomerInvoiceCsvColumns(locale),
            rows: [summary],
          })
        : refuse()
    ),
});

const unbuildableService = Layer.effect(
  CustomerInvoiceService,
  Effect.fail(new Error("synthetic configuration failure"))
);

const requestPdf = (
  invoiceId: string,
  { locale = "en-US", layer = service } = {}
) =>
  makeCustomerInvoicePdfGet(layer)(
    new Request(
      `https://workspace.test/${locale}/account/invoices/${invoiceId}/pdf`
    ),
    { params: Promise.resolve({ locale, invoiceId }) }
  );

const requestExport = ({ locale = "en-US", layer = service } = {}) =>
  makeCustomerInvoiceExportGet(layer)(
    new Request(`https://workspace.test/${locale}/account/invoices/export`),
    { params: Promise.resolve({ locale }) }
  );

const describeResponse = async (response: Response) => ({
  status: response.status,
  headers: [...response.headers.entries()].sort(),
  body: await response.text(),
});

const expectPrivate = (response: Response) => {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
};

describe("customer invoice PDF route", () => {
  test("downloads the customer's own invoice as a private attachment", async () => {
    const response = await requestPdf(ownInvoiceId);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="WS-FV-2026-000042.pdf"'
    );
    expectPrivate(response);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdfBytes);
    expect(requestedInvoiceIds).toEqual([ownInvoiceId]);
  });

  test("answers every refusal with the same private 404", async () => {
    const otherCustomers = await requestPdf(otherCustomersInvoiceId);
    const malformed = await requestPdf("not-an-invoice-id");
    outcome = "not-found";
    const unknown = await requestPdf(ownInvoiceId);
    outcome = "unavailable";
    const refused = await requestPdf(ownInvoiceId);
    outcome = "own";
    const invalidLocale = await requestPdf(ownInvoiceId, { locale: "xx-XX" });

    const reference = await describeResponse(otherCustomers);
    expect(reference.status).toBe(404);
    expect(reference.body).toBe("");
    expectPrivate(otherCustomers);
    for (const response of [malformed, unknown, refused, invalidLocale]) {
      expect(await describeResponse(response)).toEqual(reference);
    }
    // An invalid locale never reaches the service.
    expect(requestedInvoiceIds).toEqual([
      otherCustomersInvoiceId,
      "not-an-invoice-id",
      ownInvoiceId,
      ownInvoiceId,
    ]);
  });

  test("answers a load failure with a private 500 without the document", async () => {
    outcome = "load-failed";

    const response = await requestPdf(ownInvoiceId);

    expect(response.status).toBe(500);
    expectPrivate(response);
    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(response.headers.get("Content-Type")).not.toBe("application/pdf");
  });

  test("answers a service that can't be built with a private 500 and logs only a fixed code", async () => {
    const response = await requestPdf(ownInvoiceId, {
      layer: unbuildableService,
    });

    expect(response.status).toBe(500);
    expectPrivate(response);
    const logged = JSON.stringify(
      workspaceLogs.records().map(({ body, attributes }) => ({
        body,
        attributes,
      }))
    );
    expect(logged).toContain("account.invoice-download");
    expect(logged).not.toContain("synthetic configuration failure");
    expect(logged).not.toContain(ownInvoiceId);
  });
});

test("refuses an invalid locale even when the service can't be built", async () => {
  const response = await requestExport({
    locale: "xx-XX",
    layer: unbuildableService,
  });

  expect(response.status).toBe(404);
  expectPrivate(response);
});

describe("customer invoice export route", () => {
  test("downloads the customer's invoices as a private CSV attachment", async () => {
    const response = await requestExport({ locale: "cs-CZ" });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/csv; charset=utf-8"
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="invoices-2026-09-02.csv"'
    );
    expectPrivate(response);
    const records = (await response.text()).trim().split("\r\n");
    expect(records).toHaveLength(2);
    expect(records[1]).toContain(summary.invoiceNumber);
    expect(records[1]).toContain(summary.total.amount);
  });

  test("answers a refusal and an invalid locale with the same private 404", async () => {
    const invalidLocale = await requestExport({ locale: "xx-XX" });
    outcome = "unavailable";
    const refused = await requestExport();

    const reference = await describeResponse(invalidLocale);
    expect(reference.status).toBe(404);
    expectPrivate(invalidLocale);
    expect(await describeResponse(refused)).toEqual(reference);
    expect(reference).toEqual(
      await describeResponse(await requestPdf("not-an-invoice-id"))
    );
  });

  test("answers a load failure with a private 500 without rows", async () => {
    outcome = "load-failed";

    const response = await requestExport();

    expect(response.status).toBe(500);
    expectPrivate(response);
    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(await response.text()).not.toContain(summary.invoiceNumber);
  });
});
