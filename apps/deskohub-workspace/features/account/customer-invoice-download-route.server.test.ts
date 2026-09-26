import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Data, Effect, Layer } from "effect";

mock.module("server-only", () => ({}) as never);

const ownedInvoiceId = "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb23";
const otherOwnerId = "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb99";

class TestCustomerInvoiceNotFoundError extends Data.TaggedError(
  "CustomerInvoiceNotFoundError"
)<{
  readonly invoiceId: string;
}> {}

const { makeCustomerInvoiceCsvGet, makeCustomerInvoicePdfGet } = await import(
  "@/features/account/customer-invoice-download-route.server"
);
const { CustomerInvoiceService } = await import(
  "@/features/account/backend/customer-invoice.service"
);

const serviceLayer = Layer.succeed(
  CustomerInvoiceService,
  CustomerInvoiceService.of({
    list: Effect.succeed([]),
    // The real service maps a missing or non-owned lookup to the same
    // CustomerInvoiceNotFoundError; the boundary must treat it identically
    // to a malformed id.
    findPdf: (invoiceId: string) =>
      Effect.fail(new TestCustomerInvoiceNotFoundError({ invoiceId })),
    buildCsv: () =>
      Effect.succeed({
        fileName: "deskohub-invoices.csv",
        content: "Invoice number,Total\r\nWS-FV-2026-000042,450\r\n",
      }),
  } as never)
);

describe("customer invoice download routes", () => {
  test("malformed, missing, and non-owned pdf ids share one indistinguishable 404", async () => {
    const GET = makeCustomerInvoicePdfGet(serviceLayer);
    const responses = await Promise.all(
      ["not-a-uuid", ownedInvoiceId, otherOwnerId].map(async (invoiceId) => {
        const response = await GET(new Request("https://workspace.test/x"), {
          params: Promise.resolve({ invoiceId }),
        });
        if (response instanceof Response && response.status !== 404) {
          throw new Error(`expected 404 for ${invoiceId}`);
        }
        return response;
      })
    );

    const [malformed, missing, nonOwned] = responses;
    for (const response of responses) {
      if (!(response instanceof Response)) throw new Error("no response");
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("content-type")).not.toBe("application/pdf");
    }
    expect(await malformed?.text()).toBe(await missing?.text());
    expect(await missing?.text()).toBe(await nonOwned?.text());
  });

  test("serves an owned invoice as a private pdf attachment", async () => {
    const GET = makeCustomerInvoicePdfGet(
      Layer.succeed(
        CustomerInvoiceService,
        CustomerInvoiceService.of({
          list: Effect.succeed([]),
          findPdf: () =>
            Effect.succeed({
              bytes: Buffer.from("%PDF-1.4 synthetic"),
              fileName: "WS-FV-2026-000042.pdf",
            }),
          buildCsv: () => Effect.succeed({ fileName: "x", content: "" }),
        } as never)
      )
    );

    const response = await GET(new Request("https://workspace.test/x"), {
      params: Promise.resolve({ invoiceId: ownedInvoiceId }),
    });
    if (!(response instanceof Response)) throw new Error("no response");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="WS-FV-2026-000042.pdf"`
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  test("maps an invalid export locale to the same private 404", async () => {
    const GET = makeCustomerInvoiceCsvGet(serviceLayer);
    const [invalid, valid] = await Promise.all([
      GET(new Request("https://workspace.test/x"), {
        params: Promise.resolve({ locale: "not-a-locale" }),
      }),
      GET(new Request("https://workspace.test/x"), {
        params: Promise.resolve({ locale: "en-US" }),
      }),
    ]);
    if (!(invalid instanceof Response) || !(valid instanceof Response)) {
      throw new Error("no response");
    }
    expect(invalid.status).toBe(404);
    expect(invalid.headers.get("cache-control")).toBe("private, no-store");
    expect(valid.status).toBe(200);
    expect(valid.headers.get("content-type")).toContain("text/csv");
    expect(valid.headers.get("content-disposition")).toBe(
      `attachment; filename="deskohub-invoices.csv"`
    );
    expect(valid.headers.get("cache-control")).toBe("private, no-store");
  });
});
