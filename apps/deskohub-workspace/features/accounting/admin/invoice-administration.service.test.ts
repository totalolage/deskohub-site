import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationDotyposCustomerId,
  AdministrationInvoiceCreateInput,
  AdministrationInvoiceId,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import {
  makeCoworkInvoiceDocument,
  makeTestManualInvoiceDocument,
} from "@/features/accounting/invoice.test-utils";
import { invoiceIdSchema } from "@/features/accounting/manual-invoice";
import { type Invoice, InvoiceRepository } from "../backend/invoice.repository";
import {
  type InvoiceDeliverySummary,
  InvoiceEmailDeliveryRepository,
} from "../backend/invoice-email-delivery.repository";
import { InvoiceEmailDeliveryService } from "../backend/invoice-email-delivery.service";
import {
  type InvoiceAdministrationListItem,
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
      email: testEmailAddress("synthetic"),
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
  payment: { status: "due", date: "2026-09-01" },
  currency: "CZK",
  lines: [{ description: "Space rental", price: "1000" }],
});

const issuer = {
  source: "admin-ui",
  administrator: {
    accountId: customerAccountIdSchema.make(crypto.randomUUID()),
    email: testEmailAddress("invoice-administrator"),
  },
} as const;

const deliveredEverywhere: InvoiceDeliverySummary = {
  customer: "accepted",
  internal: "accepted",
  needsAttention: false,
};

const deliveryLedger = (
  summaryOf: (invoiceId: string) => InvoiceDeliverySummary = () =>
    deliveredEverywhere
) =>
  Layer.mock(InvoiceEmailDeliveryRepository, {
    status: (invoiceIds) =>
      Effect.succeed(
        new Map(invoiceIds.map((id) => [id, summaryOf(id)] as const))
      ),
  });

describe("InvoiceAdministrationService", () => {
  test("projects reservation and customer references", async () => {
    const document = {
      ...makeCoworkInvoiceDocument("en-US"),
      // Late evening UTC is already the next calendar day in Prague.
      fulfilledAt: "2026-08-10T22:30:00Z" as never,
    };
    const invoice = {
      id: invoiceIdSchema.make("01980000-0000-7000-8000-000000000009"),
      workspaceReservationId: "workspace-reservation",
      paymentAttemptId: "payment-attempt",
      dotyposCustomerId: "dotypos-customer",
      invoiceNumber: document.invoiceNumber,
      issuedAt: Temporal.Instant.from(document.issuedAt),
      document,
    } satisfies Invoice;
    const failedInternally: InvoiceDeliverySummary = {
      customer: "accepted",
      internal: "failed",
      needsAttention: true,
    };
    const manualDocument = makeTestManualInvoiceDocument("en-US");
    const manualInvoice = {
      id: manualDocument.invoiceId,
      workspaceReservationId: null,
      paymentAttemptId: null,
      dotyposCustomerId: manualDocument.dotyposCustomerId,
      invoiceNumber: manualDocument.invoiceNumber,
      issuedAt: Temporal.Instant.from(manualDocument.issuedAt),
      document: manualDocument,
    } satisfies Invoice;
    const layer = InvoiceAdministrationService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(DotyposService, {}),
          Layer.mock(InvoiceRepository, {
            findById: () => Effect.succeed(invoice),
            list: () => Effect.succeed([manualInvoice, invoice]),
          }),
          deliveryLedger((id) =>
            id === invoice.id ? failedInternally : deliveredEverywhere
          ),
          Layer.mock(InvoiceEmailDeliveryService, {}),
          Layer.mock(ManualInvoiceCreationRequests, {}),
          Layer.mock(WorkspaceDatabase, {})
        )
      )
    );

    const result = await Effect.gen(function* () {
      const service = yield* InvoiceAdministrationService;
      return yield* Effect.all([service.list(), service.get(invoice.id)]);
    }).pipe(Effect.provide(layer), Effect.runPromise);

    for (const projected of [result[0].items[0], result[1]]) {
      expect(projected).toMatchObject({
        customerId: "dotypos-customer",
        reservationId: "workspace-reservation",
        delivery: { customer: "accepted", internal: "failed" },
        needsAttention: true,
      });
    }
    expect(result[0].items[1]).toMatchObject({
      reservationId: null,
      delivery: { customer: "accepted", internal: "accepted" },
      needsAttention: false,
    });
    expect(result[1].serviceDate).toBe("2026-08-11");
  });

  test("signals a searched customer without a name or email", async () => {
    const email = testEmailAddress("unnamed-search");
    const layer = InvoiceAdministrationService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(DotyposService, {
            searchCustomers: () =>
              Effect.succeed([
                { id: "dotypos-customer-unnamed" },
                { id: "dotypos-customer-email", email: ` ${email} ` },
              ] as never),
          }),
          Layer.mock(InvoiceRepository, {}),
          Layer.mock(InvoiceEmailDeliveryRepository, {}),
          Layer.mock(InvoiceEmailDeliveryService, {}),
          Layer.mock(ManualInvoiceCreationRequests, {}),
          Layer.mock(WorkspaceDatabase, {})
        )
      )
    );

    const customers = await Effect.gen(function* () {
      const service = yield* InvoiceAdministrationService;
      return yield* service.searchCustomers("synthetic");
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(customers).toMatchObject([
      { displayName: "Unnamed customer", hasName: false },
      { displayName: email, hasName: true },
    ]);
  });

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
          Layer.mock(InvoiceEmailDeliveryRepository, {}),
          Layer.mock(InvoiceEmailDeliveryService, {
            deliverByInvoiceId: deliveryMutation,
          }),
          Layer.mock(ManualInvoiceCreationRequests, { claim: claimMutation }),
          Layer.mock(WorkspaceDatabase, {})
        )
      )
    );

    const pdf = await Effect.gen(function* () {
      const service = yield* InvoiceAdministrationService;
      return yield* service.preview(input, issuer);
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
    expect(providerMutation).not.toHaveBeenCalled();
    expect(repositoryMutation).not.toHaveBeenCalled();
    expect(deliveryMutation).not.toHaveBeenCalled();
    expect(claimMutation).not.toHaveBeenCalled();
  });
});

const item = (
  id: string,
  overrides: Partial<InvoiceAdministrationListItem> = {}
): InvoiceAdministrationListItem => ({
  id: AdministrationInvoiceId.make(id),
  invoiceNumber: id,
  issuedAt: "2026-08-18T10:00:00.000Z",
  customerId: AdministrationDotyposCustomerId.make(id),
  customerName: id,
  reservationId: null,
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
