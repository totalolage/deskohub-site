import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposService,
  FindCustomerResult,
} from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationInvoiceCreateInput,
  type AdministrationInvoiceCreateInputType,
} from "@deskohub/workspace-admin-api";
import { Deferred, Effect, Fiber, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceLocks } from "@/db/workspace-locks";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { makeTestManualInvoiceDocument } from "@/features/accounting/invoice.test-utils";
import { invoiceIdSchema } from "@/features/accounting/manual-invoice";
import { waitForAdvisoryLockWaiter } from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type Invoice,
  InvoiceRepository,
  type ManualInvoiceIssuance,
} from "../backend/invoice.repository";
import {
  type InvoiceDeliverySummary,
  InvoiceEmailDeliveryRepository,
} from "../backend/invoice-email-delivery.repository";
import {
  type InvoiceEmailDeliveryResult,
  InvoiceEmailDeliveryService,
} from "../backend/invoice-email-delivery.service";
import { InvoiceAdministrationService } from "./invoice-administration.service";
import { ManualInvoiceCreationRequests } from "./manual-invoice-creation-requests.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

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

describe.skipIf(!testDatabase)(
  "InvoiceAdministrationService creation locks on disposable Postgres",
  () => {
    test("serializes a stale identical claim before creating a Dotypos customer", async () => {
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
          invoiceInput: Parameters<
            InvoiceRepository["Service"]["issueManual"]
          >[0]
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
            }),
            deliveryLedger(),
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
            } as never),
            testDatabase!.layer
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
      expect(issueManual).toHaveBeenCalledWith(
        expect.objectContaining({
          provenance: {
            source: "admin-ui",
            actor: issuer.administrator.email,
          },
          issuedBy: issuer.administrator,
        })
      );
    });

    test("serializes new customer resolution by email across invoice ids", async () => {
      const document = makeTestManualInvoiceDocument("cs-CZ", "1000");
      const stored = new Map<string, Invoice>();
      let customer: { readonly id: DotyposCustomerIdSchema.Type } | null = null;
      const createCustomer = mock(() =>
        Effect.sleep("10 millis").pipe(
          Effect.andThen(
            Effect.sync(() => {
              customer = {
                id: DotyposCustomerIdSchema.make("dotypos-customer-manual"),
              };
              return customer as never;
            })
          )
        )
      );
      const secondInput = Schema.decodeUnknownSync(
        AdministrationInvoiceCreateInput
      )({
        ...input,
        invoiceId: "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb24",
        customer: {
          ...input.customer,
          details: {
            ...input.customer.details,
            email: ` ${input.customer.details.email} `,
          },
        },
      });
      const layer = InvoiceAdministrationService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(DotyposService, {
              findCustomer: () =>
                Effect.succeed(
                  customer
                    ? FindCustomerResult.Matched({
                        customer: customer as never,
                        matches: [customer as never],
                      })
                    : FindCustomerResult.NotFound({ matches: [] })
                ),
              createCustomer,
              updateCustomerDetails: () => Effect.succeed(customer as never),
            }),
            Layer.mock(InvoiceRepository, {
              findById: (invoiceId) =>
                Effect.succeed(stored.get(invoiceId) ?? null),
              issueManual: (invoiceInput) =>
                Effect.sync(() => {
                  const invoice = {
                    id: invoiceInput.invoiceId,
                    workspaceReservationId: null,
                    paymentAttemptId: null,
                    dotyposCustomerId: invoiceInput.dotyposCustomerId,
                    invoiceNumber: document.invoiceNumber,
                    issuedAt: Temporal.Instant.from(document.issuedAt),
                    document,
                  } satisfies Invoice;
                  stored.set(invoice.id, invoice);
                  return {
                    invoice: {
                      ...invoice,
                      workspaceReservationId: null,
                      paymentAttemptId: null,
                      document,
                    },
                    changed: true,
                  } satisfies ManualInvoiceIssuance;
                }),
            }),
            deliveryLedger(),
            Layer.mock(InvoiceEmailDeliveryService, {
              deliverByInvoiceId: () =>
                Effect.succeed({
                  status: "delivered",
                  changed: true,
                } satisfies InvoiceEmailDeliveryResult),
            }),
            Layer.mock(ManualInvoiceCreationRequests, {
              claim: () => Effect.succeed({ kind: "claimed" } as const),
              complete: () => Effect.void,
            } as never),
            testDatabase!.layer
          )
        )
      );

      const results = await Effect.gen(function* () {
        const service = yield* InvoiceAdministrationService;
        return yield* Effect.all(
          [create(service, input), create(service, secondInput)],
          { concurrency: "unbounded" }
        );
      }).pipe(Effect.provide(layer), Effect.runPromise);

      expect(results).toHaveLength(2);
      expect(createCustomer).toHaveBeenCalledTimes(1);
    });

    test("the creation lock serializes creation per invoice ID", async () => {
      const invoiceId = invoiceIdSchema.make(crypto.randomUUID());
      const withCreationLock = <A, E, R>(
        id: string,
        effect: Effect.Effect<A, E, R>
      ) =>
        Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
          transaction(
            WorkspaceLocks.manualInvoiceCreation(id).pipe(
              Effect.andThen(effect)
            )
          )
        );
      const events: string[] = [];

      await Effect.runPromise(
        Effect.gen(function* () {
          const acquired = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const holder = yield* Effect.forkChild(
            withCreationLock(
              invoiceId,
              Deferred.succeed(acquired, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.andThen(Effect.sync(() => events.push("holder")))
              )
            )
          );
          yield* Deferred.await(acquired);
          const contender = yield* Effect.forkChild(
            withCreationLock(
              invoiceId,
              Effect.sync(() => events.push("contender"))
            )
          );
          yield* Effect.promise(() =>
            waitForAdvisoryLockWaiter(testDatabase!.pool, [
              "manual-invoice-creation",
              invoiceId,
            ])
          );

          yield* withCreationLock(
            invoiceIdSchema.make(crypto.randomUUID()),
            Effect.sync(() => events.push("other invoice"))
          );
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(holder);
          yield* Fiber.join(contender);
        }).pipe(Effect.provide(testDatabase!.layer))
      );

      expect(events).toEqual(["other invoice", "holder", "contender"]);
    });

    test("creation, new-customer and issue locks nest in rank order", async () => {
      const invoiceId = invoiceIdSchema.make(crypto.randomUUID());
      // Creation holds its lock while it resolves a new customer under the
      // new-customer lock and then issues under the issue lock; the ledger
      // dies under bun test if that nesting breaks rank order.
      const nested = Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
        transaction(
          WorkspaceLocks.manualInvoiceCreation(invoiceId).pipe(
            Effect.andThen(
              transaction(WorkspaceLocks.manualInvoiceNewCustomer())
            ),
            Effect.andThen(
              transaction(WorkspaceLocks.manualInvoiceIssue(invoiceId))
            )
          )
        )
      );

      const exit = await Effect.runPromiseExit(
        nested.pipe(Effect.provide(testDatabase!.layer))
      );

      expect(exit._tag).toBe("Success");
    });
  }
);

const create = (
  service: InvoiceAdministrationService["Service"],
  invoice: AdministrationInvoiceCreateInputType
) => service.create(invoice, issuer);
