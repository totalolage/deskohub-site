import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { CustomerInvoiceSummary } from "@/features/accounting/customer-invoice";
import type { InvoiceDocument } from "@/features/accounting/invoice";

mock.module("server-only", () => ({}) as never);

type RenderInvoicePdf = (
  document: InvoiceDocument
) => Effect.Effect<Buffer, { readonly _tag: "InvoicePdfRenderingError" }>;

let renderInvoicePdfImpl: RenderInvoicePdf = () =>
  Effect.succeed(Buffer.from("%PDF-1.4 synthetic"));

mock.module("@/features/accounting/backend/invoice-pdf", () => ({
  renderInvoicePdf: (document: InvoiceDocument) =>
    renderInvoicePdfImpl(document),
}));

const { CustomerInvoiceService } = await import(
  "@/features/account/backend/customer-invoice.service"
);
const { AccountFeatureFlagService } = await import(
  "@/features/account/backend/account-feature-flag.service"
);
const { CustomerAccountLinkRepository } = await import(
  "@/features/account/backend/customer-account-link.repository"
);
const { CustomerAccountResolver } = await import(
  "@/features/account/backend/customer-account-resolver.service"
);
const { CustomerAccountAccessError } = await import(
  "@/features/account/customer-account"
);
const { InvoiceRepository } = await import(
  "@/features/accounting/backend/invoice.repository"
);

const account = {
  accountId: "auth-account-1",
  dotyposCustomerId: "dotypos-customer-1",
};

const summary: CustomerInvoiceSummary = {
  id: "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb23",
  invoiceNumber: "WS-FV-2026-000042",
  issuedAt: "2026-08-12T12:34:56.789Z",
  total: "450",
  currency: "CZK",
  paymentStatus: "due",
  dueDate: "2026-09-01",
};

type HarnessOverrides = {
  readonly flagEnabled?: boolean;
  readonly resolution?: Effect.Effect<
    { readonly accountId: string; readonly dotyposCustomerId: string },
    CustomerAccountAccessError
  >;
  readonly deletionRequestedAt?: string | null;
  readonly foundInvoice?: unknown;
  readonly probes?: unknown[][];
  readonly listOutcome?: Effect.Effect<
    readonly CustomerInvoiceSummary[],
    unknown
  >;
};

const makeHarness = (overrides: HarnessOverrides = {}) => {
  let authorizations = 0;
  let activityChecks = 0;
  const flagEnabled = overrides.flagEnabled ?? true;
  const resolution =
    overrides.resolution ??
    Effect.succeed(account).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          authorizations += 1;
        })
      )
    );
  const deletionRequestedAt =
    overrides.deletionRequestedAt === undefined
      ? null
      : overrides.deletionRequestedAt;
  const foundInvoice =
    "foundInvoice" in overrides
      ? overrides.foundInvoice
      : {
          id: summary.id,
          dotyposCustomerId: account.dotyposCustomerId,
          invoiceNumber: summary.invoiceNumber,
        };

  const serviceLayer = CustomerInvoiceService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          AccountFeatureFlagService,
          AccountFeatureFlagService.of({
            isEnabled: Effect.succeed(flagEnabled),
          })
        ),
        Layer.succeed(
          CustomerAccountResolver,
          CustomerAccountResolver.of({
            resolve: resolution,
          } as never)
        ),
        Layer.succeed(
          CustomerAccountLinkRepository,
          CustomerAccountLinkRepository.of({
            findActivityState: () =>
              Effect.succeed({ deletionRequestedAt }).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    activityChecks += 1;
                  })
                )
              ),
          } as never)
        ),
        Layer.succeed(
          InvoiceRepository,
          InvoiceRepository.of({
            listForCustomer: (dotyposCustomerId: string) =>
              overrides.listOutcome ??
              Effect.succeed(
                dotyposCustomerId === account.dotyposCustomerId ? [summary] : []
              ),
            findForCustomer: (dotyposCustomerId: string, invoiceId: string) => {
              overrides.probes?.push([dotyposCustomerId, invoiceId]);
              return Effect.succeed(
                dotyposCustomerId === account.dotyposCustomerId
                  ? (foundInvoice as never)
                  : null
              );
            },
          } as never)
        )
      )
    )
  );

  const run = <A, E>(effect: Effect.Effect<A, E, never>) =>
    Effect.runPromise(
      Effect.flatMap(CustomerInvoiceService, () => effect).pipe(
        Effect.provide(serviceLayer)
      ) as Effect.Effect<A, E, never>
    );

  return {
    run,
    authorizationCount: () => authorizations,
    activityCheckCount: () => activityChecks,
  };
};

describe("customer invoice service authorization", () => {
  test("lists only the linked customer's invoices", async () => {
    const { run } = makeHarness();
    const summaries = await run(
      Effect.flatMap(CustomerInvoiceService, (service) => service.list)
    );
    expect(summaries).toEqual([summary]);
  });

  test("re-authorizes the account on every request without caching", async () => {
    const { run, authorizationCount, activityCheckCount } = makeHarness();
    for (let index = 0; index < 3; index += 1) {
      await run(
        Effect.flatMap(CustomerInvoiceService, (service) => service.list)
      );
    }
    expect(authorizationCount()).toBe(3);
    expect(activityCheckCount()).toBe(3);
  });

  test("fails closed when the account feature flag is disabled", async () => {
    const harness = makeHarness({ flagEnabled: false });
    const outcome = await harness.run(
      Effect.flatMap(CustomerInvoiceService, (service) => service.list).pipe(
        Effect.result
      )
    );
    expect((outcome as { failure?: { _tag?: string } }).failure?._tag).toBe(
      "CustomerInvoicesUnavailableError"
    );
  });

  test("fails closed for an unauthenticated or unverified session", async () => {
    const harness = makeHarness({
      resolution: Effect.fail(
        new CustomerAccountAccessError({ reason: "unauthenticated" })
      ),
    });
    const outcome = await harness.run(
      Effect.flatMap(CustomerInvoiceService, (service) => service.list).pipe(
        Effect.result
      )
    );
    expect((outcome as { failure?: { _tag?: string } }).failure?._tag).toBe(
      "CustomerInvoicesUnavailableError"
    );
  });

  test("denies deletion-pending accounts the invoice list", async () => {
    const harness = makeHarness({ deletionRequestedAt: "2026-09-01T00:00Z" });
    const outcome = await harness.run(
      Effect.flatMap(CustomerInvoiceService, (service) => service.list).pipe(
        Effect.result
      )
    );
    expect((outcome as { failure?: { _tag?: string } }).failure?._tag).toBe(
      "CustomerInvoicesUnavailableError"
    );
  });

  test("maps database failures to the load error without document data", async () => {
    const harness = makeHarness({
      listOutcome: Effect.fail(new Error("synthetic database failure")),
    });
    const outcome = await harness.run(
      Effect.flatMap(CustomerInvoiceService, (service) => service.list).pipe(
        Effect.result
      )
    );
    expect((outcome as { failure?: { _tag?: string } }).failure?._tag).toBe(
      "CustomerInvoicesLoadError"
    );
    expect(JSON.stringify(outcome)).not.toContain("synthetic database failure");
  });
});

describe("customer invoice pdf authorization", () => {
  test("renders an owned invoice with a filename from the invoice number", async () => {
    const harness = makeHarness();
    const pdf = await harness.run(
      Effect.flatMap(CustomerInvoiceService, (service) =>
        service.findPdf(summary.id)
      )
    );
    expect(pdf.fileName).toBe("WS-FV-2026-000042.pdf");
    expect(pdf.bytes.toString()).toContain("%PDF");
  });

  test("returns the same not-found failure for a missing or non-owned invoice", async () => {
    const missing = makeHarness({ foundInvoice: null });
    const missingOutcome = await missing.run(
      Effect.flatMap(CustomerInvoiceService, (service) =>
        service.findPdf(summary.id)
      ).pipe(Effect.result)
    );
    expect(
      (missingOutcome as { failure?: { _tag?: string } }).failure?._tag
    ).toBe("CustomerInvoiceNotFoundError");

    // The lookup always receives the authorized Dotypos customer id, so a
    // non-owned invoice can never match and falls into the same not-found.
    const probes: readonly unknown[][] = [];
    const probing = makeHarness({ foundInvoice: null, probes });
    await probing.run(
      Effect.flatMap(CustomerInvoiceService, (service) =>
        service.findPdf(summary.id)
      ).pipe(Effect.result)
    );
    expect(probes[0]?.[0]).toBe(account.dotyposCustomerId);
    expect(probes[0]?.[1]).toBe(summary.id);
  });

  test("fails closed when the PDF renderer fails", async () => {
    const previous = renderInvoicePdfImpl;
    renderInvoicePdfImpl = () =>
      Effect.fail({ _tag: "InvoicePdfRenderingError" });
    try {
      const harness = makeHarness();
      const outcome = await harness.run(
        Effect.flatMap(CustomerInvoiceService, (service) =>
          service.findPdf(summary.id)
        ).pipe(Effect.result)
      );
      expect((outcome as { failure?: { _tag?: string } }).failure?._tag).toBe(
        "CustomerInvoicesLoadError"
      );
      expect(JSON.stringify(outcome)).not.toContain("%PDF");
    } finally {
      renderInvoicePdfImpl = previous;
    }
  });
});

describe("customer invoice csv export", () => {
  test("builds a labeled CSV download from the listed facts", async () => {
    const harness = makeHarness();
    const csv = await harness.run(
      Effect.flatMap(CustomerInvoiceService, (service) =>
        service.buildCsv("en-US")
      )
    );
    expect(csv.fileName).toBe("deskohub-invoices.csv");
    expect(csv.content).toContain("WS-FV-2026-000042");
    expect(csv.content.split("\r\n")).toHaveLength(2);
  });
});
