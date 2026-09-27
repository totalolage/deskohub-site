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
const { CustomerInvoiceService, CustomerInvoicesUnavailableError } =
  await import("@/features/account/backend/customer-invoice.service");

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

const unavailableServiceLayer = Layer.succeed(
  CustomerInvoiceService,
  CustomerInvoiceService.of({
    list: Effect.fail(
      new CustomerInvoicesUnavailableError({
        message: "Customer invoices are unavailable for this account.",
      })
    ),
    findPdf: () =>
      Effect.fail(
        new CustomerInvoicesUnavailableError({
          message: "Customer invoices are unavailable for this account.",
        })
      ),
    buildCsv: () =>
      Effect.fail(
        new CustomerInvoicesUnavailableError({
          message: "Customer invoices are unavailable for this account.",
        })
      ),
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

  test("maps unavailable PDF authorization to the missing and non-owned 404", async () => {
    const unauthorizedGet = makeCustomerInvoicePdfGet(unavailableServiceLayer);
    const missingGet = makeCustomerInvoicePdfGet(serviceLayer);
    const [unavailable, malformed, missing, nonOwned] = await Promise.all([
      unauthorizedGet(new Request("https://workspace.test/x"), {
        params: Promise.resolve({ invoiceId: ownedInvoiceId }),
      }),
      missingGet(new Request("https://workspace.test/x"), {
        params: Promise.resolve({ invoiceId: "not-a-uuid" }),
      }),
      missingGet(new Request("https://workspace.test/x"), {
        params: Promise.resolve({ invoiceId: ownedInvoiceId }),
      }),
      missingGet(new Request("https://workspace.test/x"), {
        params: Promise.resolve({ invoiceId: otherOwnerId }),
      }),
    ]);
    const responses = [unavailable, malformed, missing, nonOwned];
    for (const response of responses) {
      if (!(response instanceof Response)) throw new Error("no response");
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("content-disposition")).toBeNull();
      expect(response.headers.get("content-type")).not.toBe("application/pdf");
    }
    const bodies = await Promise.all(
      responses.map((response) => response.text())
    );
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).not.toContain("%PDF");
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

  test("maps unavailable CSV authorization to the invalid-locale 404 for safe locales", async () => {
    const unauthorizedGet = makeCustomerInvoiceCsvGet(unavailableServiceLayer);
    const invalidLocaleGet = makeCustomerInvoiceCsvGet(serviceLayer);
    const safeLocales = ["en-US", "cs-CZ"] as const;
    const deniedResponses = await Promise.all(
      safeLocales.map((locale) =>
        unauthorizedGet(new Request("https://workspace.test/x"), {
          params: Promise.resolve({ locale }),
        })
      )
    );
    const invalidLocale = await invalidLocaleGet(
      new Request("https://workspace.test/x"),
      { params: Promise.resolve({ locale: "not-a-locale" }) }
    );
    if (!(invalidLocale instanceof Response)) {
      throw new Error("no invalid-locale response");
    }

    for (const response of [...deniedResponses, invalidLocale]) {
      if (!(response instanceof Response)) throw new Error("no response");
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("content-disposition")).toBeNull();
      expect(response.headers.get("content-type") ?? "").not.toContain(
        "text/csv"
      );
    }
    const bodies = await Promise.all(
      [...deniedResponses, invalidLocale].map((response) => response.text())
    );
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).not.toContain("WS-FV-2026-000042");
  });

  test("unexpected pdf failures answer with a private no-store json error", async () => {
    const failingLayer = Layer.succeed(
      CustomerInvoiceService,
      CustomerInvoiceService.of({
        list: Effect.succeed([]),
        findPdf: () =>
          Effect.fail(
            new (class extends Data.TaggedError("CustomerInvoicesLoadError") {
              readonly message = "synthetic storage outage secret-detail";
            })()
          ),
        buildCsv: () => Effect.succeed({ fileName: "x", content: "" }),
      } as never)
    );
    const GET = makeCustomerInvoicePdfGet(failingLayer);

    const response = await GET(new Request("https://workspace.test/x"), {
      params: Promise.resolve({ invoiceId: ownedInvoiceId }),
    });
    if (!(response instanceof Response)) throw new Error("no response");

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toBeNull();
    const body = await response.text();
    expect(body).not.toContain("%PDF");
    expect(body).not.toContain("synthetic storage outage secret-detail");
  });

  test("unexpected csv failures answer with a private no-store json error", async () => {
    const failingLayer = Layer.succeed(
      CustomerInvoiceService,
      CustomerInvoiceService.of({
        list: Effect.fail(
          new (class extends Data.TaggedError("CustomerInvoicesLoadError") {
            readonly message = "synthetic storage outage secret-detail";
          })()
        ),
        findPdf: () =>
          Effect.fail(
            new TestCustomerInvoiceNotFoundError({ invoiceId: ownedInvoiceId })
          ),
        buildCsv: () =>
          Effect.fail(
            new (class extends Data.TaggedError("CustomerInvoicesLoadError") {
              readonly message = "synthetic storage outage secret-detail";
            })()
          ),
      } as never)
    );
    const GET = makeCustomerInvoiceCsvGet(failingLayer);

    const response = await GET(new Request("https://workspace.test/x"), {
      params: Promise.resolve({ locale: "en-US" }),
    });
    if (!(response instanceof Response)) throw new Error("no response");

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toBeNull();
    const body = await response.text();
    expect(body).not.toContain("synthetic storage outage secret-detail");
  });
});
