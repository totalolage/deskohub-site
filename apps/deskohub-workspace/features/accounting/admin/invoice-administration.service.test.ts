import { describe, expect, mock, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposService,
  FindCustomerResult,
} from "@deskohub/dotypos";
import {
  AdministrationInvoiceCreateInput,
  type AdministrationInvoiceCreateInputType,
  AdministrationInvoiceId,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer, Schema, Semaphore } from "effect";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  makeCoworkInvoiceDocument,
  makeTestManualInvoiceDocument,
} from "@/features/accounting/invoice.test-utils";
import {
  type Invoice,
  InvoiceRepository,
  type ManualInvoiceIssuance,
} from "../backend/invoice.repository";
import {
  type InvoiceEmailDeliveryResult,
  InvoiceEmailDeliveryService,
} from "../backend/invoice-email-delivery.service";
import {
  decodeInvoiceAdministrationId,
  getInvoiceAdministrationPaymentStatus,
  type InvoiceAdministrationListItem,
  InvoiceAdministrationNotFoundError,
  InvoiceAdministrationService,
  sortInvoiceAdministrationItems,
} from "./invoice-administration.service";
import { ManualInvoiceCreationRequests } from "./manual-invoice-creation-requests.service";

const input = Schema.decodeUnknownSync(AdministrationInvoiceCreateInput)({
  invoiceId: "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb23",
  customer: {
    kind: "new",
    details: {
      kind: "person",
      email: "synthetic@example.test",
      firstName: "Synthetic",
      lastName: "Customer",
      address: {
        line1: "Test street 1",
        city: "Prague",
        postalCode: "100 00",
        country: "CZ",
      },
    },
  },
  locale: "cs-CZ",
  serviceDate: "2026-08-18",
  dueDate: "2026-09-01",
  currency: "CZK",
  lines: [{ description: "Space rental", price: "1000" }],
});

describe("InvoiceAdministrationService", () => {
  test("renders a PDF preview without touching providers or persistence", async () => {
    const providerMutation = mock(() => Effect.die("provider mutation"));
    const repositoryMutation = mock(() => Effect.die("repository mutation"));
    const deliveryMutation = mock(() => Effect.die("delivery mutation"));
    const claimMutation = mock(() => Effect.die("claim mutation"));
    const layer = InvoiceAdministrationService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(DotyposService, { createCustomer: providerMutation }),
          Layer.mock(InvoiceRepository, { issueManual: repositoryMutation }),
          Layer.mock(InvoiceEmailDeliveryService, {
            deliverByInvoiceId: deliveryMutation,
          }),
          Layer.mock(ManualInvoiceCreationRequests, { claim: claimMutation })
        )
      )
    );

    const pdf = await Effect.gen(function* () {
      const service = yield* InvoiceAdministrationService;
      return yield* service.preview(input, {
        source: "admin-ui",
        actor: "admin",
      });
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
    const parsed = await getDocument({
      data: new Uint8Array(pdf),
      isEvalSupported: false,
      useSystemFonts: false,
    }).promise;
    const page = await parsed.getPage(1);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    await parsed.destroy();
    expect(text).toContain("PREVIEW-0000000000");
    expect(text).toContain("Space rental");
    expect(text).toContain("Synthetic Customer");
    expect(providerMutation).not.toHaveBeenCalled();
    expect(repositoryMutation).not.toHaveBeenCalled();
    expect(deliveryMutation).not.toHaveBeenCalled();
    expect(claimMutation).not.toHaveBeenCalled();
  });

  test("serializes a stale identical claim before creating a Dotypos customer", async () => {
    const permit = Semaphore.makeUnsafe(1);
    const document = makeTestManualInvoiceDocument("cs-CZ", "1000");
    let completed = false;
    let stored: Invoice | null = null;
    const createCustomer = mock(() =>
      Effect.sleep("10 millis").pipe(
        Effect.as({
          id: DotyposCustomerIdSchema.make("dotypos-customer-manual"),
        } as never)
      )
    );
    const issueManual = mock(
      (
        invoiceInput: Parameters<InvoiceRepository["Service"]["issueManual"]>[0]
      ) =>
        Effect.sync(() => {
          const changed = stored === null;
          stored ??= {
            id: invoiceInput.invoiceId,
            workspaceReservationId: null,
            paymentAttemptId: null,
            dotyposCustomerId: invoiceInput.dotyposCustomerId,
            invoiceNumber: document.invoiceNumber,
            issuedAt: Temporal.Instant.from(document.issuedAt),
            document,
          };
          return { invoice: stored, changed } as ManualInvoiceIssuance;
        })
    );
    const layer = InvoiceAdministrationService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(DotyposService, {
            findCustomer: () =>
              Effect.succeed(FindCustomerResult.NotFound({ matches: [] })),
            createCustomer,
          }),
          Layer.mock(InvoiceRepository, {
            findById: () => Effect.succeed(stored),
            issueManual,
            list: () =>
              Effect.succeed(
                stored
                  ? [
                      {
                        invoice: stored,
                        delivery: {
                          customer: "accepted" as const,
                          internal: "accepted" as const,
                        },
                        needsAttention: false,
                      },
                    ]
                  : []
              ),
          }),
          Layer.mock(InvoiceEmailDeliveryService, {
            deliverByInvoiceId: () =>
              Effect.succeed({
                status: "delivered",
                changed: true,
              } satisfies InvoiceEmailDeliveryResult),
          }),
          Layer.mock(ManualInvoiceCreationRequests, {
            claim: () =>
              Effect.succeed(
                completed
                  ? ({ kind: "completed" } as const)
                  : ({ kind: "claimed" } as const)
              ),
            complete: () =>
              Effect.sync(() => {
                completed = true;
              }),
            withLock: <A, E, R>(
              _invoiceId: string,
              effect: Effect.Effect<A, E, R>
            ) => permit.withPermit(effect),
          } as never)
        )
      )
    );

    const results = await Effect.gen(function* () {
      const service = yield* InvoiceAdministrationService;
      return yield* Effect.all(
        [create(service, input), create(service, input)],
        { concurrency: "unbounded" }
      );
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(results).toHaveLength(2);
    expect(createCustomer).toHaveBeenCalledTimes(1);
    expect(issueManual).toHaveBeenCalledTimes(2);
  });
});

const create = (
  service: InvoiceAdministrationService["Service"],
  invoice: AdministrationInvoiceCreateInputType
) => service.create(invoice, { source: "admin-ui", actor: "admin" });

const item = (
  id: string,
  overrides: Partial<InvoiceAdministrationListItem> = {}
): InvoiceAdministrationListItem => ({
  id: AdministrationInvoiceId.make(id),
  invoiceNumber: id,
  issuedAt: "2026-08-18T10:00:00.000Z",
  customerName: id,
  total: "0",
  currency: "CZK",
  paymentStatus: "paid",
  source: "legacy",
  actor: null,
  delivery: { customer: "accepted", internal: "accepted" },
  needsAttention: false,
  ...overrides,
});

describe("invoice administration sorting", () => {
  test("groups attention only by default and compares decimal totals exactly", () => {
    const olderAttention = item("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb21", {
      issuedAt: "2026-01-01T00:00:00.000Z",
      needsAttention: true,
      total: "900719925474099312345678.01",
    });
    const newer = item("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb22", {
      issuedAt: "2026-08-18T00:00:00.000Z",
      total: "900719925474099312345678.02",
    });

    expect(sortInvoiceAdministrationItems([newer, olderAttention], {})).toEqual(
      [olderAttention, newer]
    );
    expect(
      sortInvoiceAdministrationItems([olderAttention, newer], {
        sort: "total",
        direction: "asc",
      })
    ).toEqual([olderAttention, newer]);
    expect(
      sortInvoiceAdministrationItems([olderAttention, newer], {
        sort: "issuedAt",
        direction: "desc",
      })
    ).toEqual([newer, olderAttention]);
  });

  test("sorts payment status only when explicitly requested", () => {
    const paid = item("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb21");
    const overdue = item("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb22", {
      paymentStatus: "overdue",
      needsAttention: true,
    });

    expect(
      sortInvoiceAdministrationItems([overdue, paid], {
        sort: "paymentStatus",
        direction: "asc",
      })
    ).toEqual([overdue, paid]);
  });
});

describe("invoice administration payment status", () => {
  const manual = makeTestManualInvoiceDocument("en-US");

  test("keeps reservation invoices paid", () => {
    expect(
      getInvoiceAdministrationPaymentStatus(
        makeCoworkInvoiceDocument("en-US"),
        "2099-01-01"
      )
    ).toBe("paid");
  });

  test("derives manual status from the Prague calendar date", () => {
    expect(getInvoiceAdministrationPaymentStatus(manual, "2026-08-31")).toBe(
      "issued"
    );
    expect(getInvoiceAdministrationPaymentStatus(manual, "2026-09-01")).toBe(
      "due"
    );
    expect(getInvoiceAdministrationPaymentStatus(manual, "2026-09-02")).toBe(
      "overdue"
    );
  });

  test("keeps zero and negative manual totals issued after their due date", () => {
    expect(
      getInvoiceAdministrationPaymentStatus(
        makeTestManualInvoiceDocument("en-US", "0"),
        "2026-09-02"
      )
    ).toBe("issued");
    expect(
      getInvoiceAdministrationPaymentStatus(
        makeTestManualInvoiceDocument("en-US", "-1"),
        "2026-09-02"
      )
    ).toBe("issued");
  });

  test("maps malformed route ids to not found", () => {
    const error = Effect.runSync(
      decodeInvoiceAdministrationId("not-an-invoice-id").pipe(Effect.flip)
    );
    expect(error).toBeInstanceOf(InvoiceAdministrationNotFoundError);
  });
});
