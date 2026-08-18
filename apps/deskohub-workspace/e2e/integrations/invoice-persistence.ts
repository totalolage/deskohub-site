import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import { NexiCorrelationIdSchema, NexiOrderIdSchema } from "@deskohub/nexi";
import { asc, eq, like, sql } from "drizzle-orm";
import { Data, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { DatabaseClient } from "@/db/database-client";
import {
  accountingDocumentSnapshots,
  invoiceEmailDeliveries,
  invoiceNumberCounters,
  invoices,
  paymentAttempts,
  workspaceReservations,
} from "@/db/schema";
import {
  accountingSnapshotKeyIdSchema,
  companyRegistrationIdSchema,
  makeAccountingDocumentSnapshot,
  vatRegistrationIdSchema,
} from "@/features/accounting/accounting-document-snapshot";
import { AccountingDocumentSnapshotRepository } from "@/features/accounting/backend/accounting-document-snapshot.repository";
import {
  type AccountingSnapshotKey,
  AccountingSnapshotKeyError,
  AccountingSnapshotKeyService,
  type IAccountingSnapshotKeyService,
} from "@/features/accounting/backend/accounting-snapshot-key.service";
import { encryptAccountingSnapshot } from "@/features/accounting/backend/accounting-snapshot-sql";
import {
  type IInvoiceRepository,
  InvoiceRepository,
} from "@/features/accounting/backend/invoice.repository";
import {
  type IInvoiceEmailDeliveryRepository,
  InvoiceEmailDeliveryRepository,
} from "@/features/accounting/backend/invoice-email-delivery.repository";
import {
  getInvoiceNumberingYear,
  type InvoiceBuyer,
  invoiceNumberSchema,
} from "@/features/accounting/invoice";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import {
  checkoutAttemptKeySchema,
  checkoutSessionKeySchema,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import {
  buildCoworkReservationQuote,
  type CoworkReservationQuoteOrder,
} from "@/features/checkout/checkout-quote.test-utils";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { temporalInstantToIsoString } from "@/shared/utils/temporal";
import { toWorkspaceE2EError } from "../errors";
import { E2EDatabase } from "./database.service";

const testKey: AccountingSnapshotKey = {
  id: accountingSnapshotKeyIdSchema.make("K202608"),
  secret: "synthetic accounting snapshot secret!",
};
const coworkOrder = {
  entryTier: "basic",
  coffee: true,
} satisfies CoworkReservationQuoteOrder;
const prepared = {
  kind: "cowork",
  reservation: {
    kind: "cowork",
    ...coworkOrder,
    date: "2099-01-01",
    name: "Synthetic Invoice Customer",
    email: "invoice-integration@example.test",
    phone: "+420 700 000 000",
  },
  quote: buildCoworkReservationQuote(coworkOrder),
} as PreparedCustomerQuote;
const personalInvoiceBuyer = {
  kind: "person",
  legalName: "Synthetic Invoice Customer",
  address: {
    line1: "Synthetic 1",
    city: "Praha",
    postalCode: "100 00",
    country: "CZ",
  },
} satisfies InvoiceBuyer;

class InvoicePersistenceRollback extends Data.TaggedError(
  "InvoicePersistenceRollback"
) {}

export const assertInvoicePersistence = Effect.gen(function* () {
  const { db } = yield* E2EDatabase;
  yield* cleanupLegacyInvoicePersistenceFixtures(db);
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        const repository = yield* makeInvoiceRepository({
          db: tx,
          keys: makeKeyService(),
        });
        const deliveryRepository =
          yield* makeInvoiceEmailDeliveryRepository(tx);

        yield* assertIdempotentIssuance(tx, repository);
        yield* assertEmailDeliveryPersistence(
          tx,
          repository,
          deliveryRepository
        );
        yield* assertUniqueNumbering(tx, repository);
        yield* assertIneligiblePayment(tx, repository);
        yield* assertUnfulfilledReservation(tx, repository);
        yield* assertDifferentAttemptRejected(tx, repository);
        yield* assertFailedInsertionRollsBackNumber(tx, repository);
        return yield* new InvoicePersistenceRollback();
      })
    )
    .pipe(Effect.catchTag("InvoicePersistenceRollback", () => Effect.void));
}).pipe(
  Effect.mapError((cause) =>
    toWorkspaceE2EError("assert invoice persistence", cause)
  )
);

const cleanupLegacyInvoicePersistenceFixtures = (db: DatabaseClient) =>
  db.transaction((tx) =>
    Effect.gen(function* () {
      yield* tx.execute(sql`lock table ${invoices} in access exclusive mode`);
      yield* tx.execute(
        sql`alter table ${invoices} disable trigger invoices_immutable`
      );
      yield* tx
        .delete(invoices)
        .where(
          like(invoices.workspaceReservationId, "synthetic-reservation-%")
        );
      yield* tx.execute(
        sql`alter table ${invoices} enable trigger invoices_immutable`
      );
    })
  );

const assertEmailDeliveryPersistence = (
  db: DatabaseClient,
  invoiceRepository: IInvoiceRepository,
  deliveryRepository: IInvoiceEmailDeliveryRepository
) =>
  Effect.gen(function* () {
    const fixture = yield* createPaidFixture(db);
    const { invoice } = yield* invoiceRepository.issue({
      paymentAttemptId: fixture.paymentAttemptId,
      buyer: personalInvoiceBuyer,
    });
    const staleProcessingBefore = Temporal.Now.instant().subtract({
      minutes: 5,
    });
    const claims = yield* Effect.all(
      Array.from({ length: 10 }, () =>
        deliveryRepository.claim({
          invoiceId: invoice.id,
          audience: "customer",
          staleProcessingBefore,
        })
      ),
      { concurrency: "unbounded" }
    );
    const customerClaim = claims.find((claim) => claim !== null);

    equal(claims.filter((claim) => claim !== null).length, 1);
    ok(customerClaim);
    equal(customerClaim.attemptNumber, 1);
    yield* deliveryRepository.markAccepted({
      invoiceId: invoice.id,
      audience: "customer",
      attemptNumber: customerClaim.attemptNumber,
      providerDeliveryId: EmailDeliveryIdSchema.make(
        "synthetic-customer-email"
      ),
      acceptedAt: Temporal.Now.instant(),
    });
    equal(
      yield* deliveryRepository.claim({
        invoiceId: invoice.id,
        audience: "customer",
        staleProcessingBefore,
      }),
      null
    );

    const internalClaim = yield* deliveryRepository.claim({
      invoiceId: invoice.id,
      audience: "internal",
      staleProcessingBefore,
    });
    ok(internalClaim);
    yield* deliveryRepository.markFailed({
      invoiceId: invoice.id,
      audience: "internal",
      attemptNumber: internalClaim.attemptNumber,
      failureCode: "email_send_failed",
    });
    const internalRetry = yield* deliveryRepository.claim({
      invoiceId: invoice.id,
      audience: "internal",
      staleProcessingBefore,
    });
    ok(internalRetry);
    equal(internalRetry.attemptNumber, 2);
    yield* deliveryRepository.markAccepted({
      invoiceId: invoice.id,
      audience: "internal",
      attemptNumber: internalRetry.attemptNumber,
      providerDeliveryId: EmailDeliveryIdSchema.make(
        "synthetic-internal-email"
      ),
      acceptedAt: Temporal.Now.instant(),
    });

    const rows = yield* db
      .select()
      .from(invoiceEmailDeliveries)
      .where(eq(invoiceEmailDeliveries.invoiceId, invoice.id));
    equal(rows.length, 2);
    ok(rows.every((row) => row.state === "accepted"));
    deepStrictEqual(
      rows.map((row) => [row.audience, row.attemptCount]).sort(),
      [
        ["customer", 1],
        ["internal", 2],
      ]
    );
  });

const assertIdempotentIssuance = (
  db: DatabaseClient,
  repository: IInvoiceRepository
) =>
  Effect.gen(function* () {
    const fixture = yield* createPaidFixture(db);
    const countersBefore = yield* readCounters(db);
    const buyer = {
      kind: "business" as const,
      legalName: `Synthetic Ciphertext Sentinel ${fixture.reservationId}`,
      companyId: companyRegistrationIdSchema.make("12345678"),
      vatId: vatRegistrationIdSchema.make("CZ12345678"),
      address: {
        line1: "Synthetic 1",
        city: "Praha",
        postalCode: "100 00",
        country: "CZ",
      },
    };

    const results = yield* Effect.all(
      Array.from({ length: 10 }, () =>
        repository.issue({
          paymentAttemptId: fixture.paymentAttemptId,
          buyer,
        })
      ),
      { concurrency: "unbounded" }
    );

    equal(new Set(results.map(({ invoice }) => invoice.id)).size, 1);
    equal(new Set(results.map(({ invoice }) => invoice.invoiceNumber)).size, 1);
    equal(results.filter(({ changed }) => changed).length, 1);
    deepStrictEqual(results[0]?.invoice.document.buyer, buyer);
    equal("schemaVersion" in (results[0]?.invoice.document ?? {}), false);

    const issued = results[0]?.invoice;
    ok(issued);
    ok(issued.document.fulfilledAt);
    ok(fixture.fulfilledAt);
    equal(
      Temporal.Instant.compare(
        Temporal.Instant.from(issued.document.fulfilledAt),
        fixture.fulfilledAt
      ),
      0
    );
    const numberingYear = getInvoiceNumberingYear(issued.issuedAt);
    const countersAfter = yield* readCounters(db);
    equal(
      countersAfter.get(numberingYear),
      (countersBefore.get(numberingYear) ?? 0) + 1
    );

    const [stored] = yield* db
      .select({ encryptedDocument: invoices.encryptedDocument })
      .from(invoices)
      .where(eq(invoices.id, issued.id));
    equal(
      stored?.encryptedDocument.includes(Buffer.from(buyer.legalName)),
      false
    );

    const retry = yield* repository.issue({
      paymentAttemptId: fixture.paymentAttemptId,
      buyer: {
        ...personalInvoiceBuyer,
        legalName: "Different Synthetic Buyer",
      },
    });
    equal(retry.changed, false);
    equal(retry.invoice.id, issued.id);
    deepStrictEqual(retry.invoice.document.buyer, buyer);
    deepStrictEqual(yield* readCounters(db), countersAfter);

    yield* Effect.flip(
      db
        .update(invoices)
        .set({
          invoiceNumber: invoiceNumberSchema.make("WS-FV-2099-999999"),
        })
        .where(eq(invoices.id, issued.id))
    );
    yield* Effect.flip(db.delete(invoices).where(eq(invoices.id, issued.id)));
  });

const assertUniqueNumbering = (
  db: DatabaseClient,
  repository: IInvoiceRepository
) =>
  Effect.gen(function* () {
    const fixtures = yield* Effect.all(
      Array.from({ length: 5 }, () => createPaidFixture(db)),
      { concurrency: "unbounded" }
    );
    const countersBefore = yield* readCounters(db);
    const results = yield* Effect.all(
      fixtures.map(({ paymentAttemptId }) =>
        repository.issue({ paymentAttemptId, buyer: personalInvoiceBuyer })
      ),
      { concurrency: "unbounded" }
    );
    const numberingYear = getInvoiceNumberingYear(results[0]!.invoice.issuedAt);
    const before = countersBefore.get(numberingYear) ?? 0;
    const sequences = results
      .map(({ invoice }) =>
        Number(
          invoice.invoiceNumber.slice(
            invoice.invoiceNumber.lastIndexOf("-") + 1
          )
        )
      )
      .sort((left, right) => left - right);

    equal(
      new Set(results.map(({ invoice }) => invoice.invoiceNumber)).size,
      fixtures.length
    );
    deepStrictEqual(
      sequences,
      Array.from({ length: fixtures.length }, (_, index) => before + index + 1)
    );
    equal(
      (yield* readCounters(db)).get(numberingYear),
      before + fixtures.length
    );
  });

const assertIneligiblePayment = (
  db: DatabaseClient,
  repository: IInvoiceRepository
) =>
  Effect.gen(function* () {
    const fixture = yield* createPaidFixture(db, { paid: false });
    const before = yield* readCounters(db);
    const error = yield* Effect.flip(
      repository.issue({
        paymentAttemptId: fixture.paymentAttemptId,
        buyer: personalInvoiceBuyer,
      })
    );

    ok(isTaggedError("InvoiceEligibilityError")(error));
    deepStrictEqual(yield* readCounters(db), before);
  });

const assertUnfulfilledReservation = (
  db: DatabaseClient,
  repository: IInvoiceRepository
) =>
  Effect.gen(function* () {
    const fixture = yield* createPaidFixture(db, { fulfilled: false });
    const before = yield* readCounters(db);
    const error = yield* Effect.flip(
      repository.issue({
        paymentAttemptId: fixture.paymentAttemptId,
        buyer: personalInvoiceBuyer,
      })
    );

    ok(isTaggedError("InvoiceEligibilityError")(error));
    deepStrictEqual(yield* readCounters(db), before);
  });

const assertDifferentAttemptRejected = (
  db: DatabaseClient,
  repository: IInvoiceRepository
) =>
  Effect.gen(function* () {
    const fixture = yield* createPaidFixture(db);
    yield* repository.issue({
      paymentAttemptId: fixture.paymentAttemptId,
      buyer: personalInvoiceBuyer,
    });
    const otherPaymentAttemptId = yield* createAdditionalFailedAttempt(
      db,
      fixture
    );
    const error = yield* Effect.flip(
      repository.issue({
        paymentAttemptId: otherPaymentAttemptId,
        buyer: personalInvoiceBuyer,
      })
    );

    ok(
      isTaggedError("InvoiceEligibilityError")(error) &&
        hasProperty(error, "paymentAttemptId", otherPaymentAttemptId)
    );
  });

const assertFailedInsertionRollsBackNumber = (
  db: DatabaseClient,
  repository: IInvoiceRepository
) =>
  Effect.gen(function* () {
    const fixture = yield* createPaidFixture(db);
    const invalidActiveKey: AccountingSnapshotKey = {
      ...testKey,
      // Deliberately bypass the application brand to prove the database failure
      // rolls the number allocation back in the same transaction.
      id: "INVALID-ID" as AccountingSnapshotKey["id"],
    };
    const badRepository = yield* makeInvoiceRepository({
      db,
      keys: makeKeyService(invalidActiveKey, [testKey, invalidActiveKey]),
    });
    const before = yield* readCounters(db);
    const insertError = yield* Effect.flip(
      badRepository.issue({
        paymentAttemptId: fixture.paymentAttemptId,
        buyer: personalInvoiceBuyer,
      })
    );

    ok(
      isInvoiceStorageError("encrypt", "EffectDrizzleQueryError")(insertError)
    );
    deepStrictEqual(yield* readCounters(db), before);

    const successful = yield* repository.issue({
      paymentAttemptId: fixture.paymentAttemptId,
      buyer: personalInvoiceBuyer,
    });
    const numberingYear = getInvoiceNumberingYear(successful.invoice.issuedAt);
    equal(
      Number(
        successful.invoice.invoiceNumber.slice(
          successful.invoice.invoiceNumber.lastIndexOf("-") + 1
        )
      ),
      (before.get(numberingYear) ?? 0) + 1
    );

    const wrongKeyRepository = yield* makeInvoiceRepository({
      db,
      keys: makeKeyService({
        ...testKey,
        secret: "different synthetic accounting snapshot secret!",
      }),
    });
    const decryptError = yield* Effect.flip(
      wrongKeyRepository.findByPaymentAttemptId(fixture.paymentAttemptId)
    );
    ok(
      isInvoiceStorageError("decrypt", "EffectDrizzleQueryError")(decryptError)
    );
  });

const makeKeyService = (
  activeKey: AccountingSnapshotKey = testKey,
  readableKeys: readonly AccountingSnapshotKey[] = [activeKey]
): IAccountingSnapshotKeyService => ({
  getActive: Effect.succeed(activeKey),
  getById: (keyId) => {
    const key = readableKeys.find((candidate) => candidate.id === keyId);
    return key
      ? Effect.succeed(key)
      : Effect.fail(
          new AccountingSnapshotKeyError({
            keyId,
            message: "Synthetic integration key is unavailable.",
          })
        );
  },
});

const makeInvoiceRepository = (input: {
  readonly db: DatabaseClient;
  readonly keys: IAccountingSnapshotKeyService;
}) => {
  const databaseLayer = Layer.succeed(
    WorkspaceDatabase,
    WorkspaceDatabase.of({ db: input.db })
  );
  const keyLayer = Layer.succeed(
    AccountingSnapshotKeyService,
    AccountingSnapshotKeyService.of(input.keys)
  );
  const baseLayer = Layer.merge(databaseLayer, keyLayer);
  const snapshotLayer = AccountingDocumentSnapshotRepository.Default.pipe(
    Layer.provide(baseLayer)
  );
  const repositoryLayer = InvoiceRepository.Default.pipe(
    Layer.provide(Layer.merge(baseLayer, snapshotLayer))
  );

  return InvoiceRepository.pipe(Effect.provide(repositoryLayer));
};

const makeInvoiceEmailDeliveryRepository = (db: DatabaseClient) =>
  InvoiceEmailDeliveryRepository.pipe(
    Effect.provide(
      InvoiceEmailDeliveryRepository.Default.pipe(
        Layer.provide(
          Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.of({ db }))
        )
      )
    )
  );

const createPaidFixture = (
  db: DatabaseClient,
  options: { readonly fulfilled?: boolean; readonly paid?: boolean } = {}
) =>
  Effect.gen(function* () {
    const paid = options.paid ?? true;
    const fulfilled = options.fulfilled ?? paid;
    const reservationId = workspaceReservationIdSchema.make(randomUUID());
    const paymentAttemptId = paymentAttemptIdSchema.make(randomUUID());
    const dotyposCustomerId = DotyposCustomerIdSchema.make(
      `synthetic-customer-${randomUUID()}`
    );
    const dotyposReservationId = DotyposReservationIdSchema.make(
      `synthetic-reservation-${randomUUID()}`
    );
    const now = Temporal.Instant.from(
      temporalInstantToIsoString(Temporal.Now.instant())
    );
    const source = makeAccountingDocumentSnapshot({
      workspaceReservationId: reservationId,
      dotyposReservationId,
      dotyposCustomerId,
      locale: "en-US",
      prepared,
    });

    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        yield* tx.insert(workspaceReservations).values({
          id: reservationId,
          checkoutSessionKey: checkoutSessionKeySchema.make(randomUUID()),
          checkoutAttemptKey: checkoutAttemptKeySchema.make(randomUUID()),
          correlationId: NexiCorrelationIdSchema.make(randomUUID()),
          dotyposCustomerId,
          dotyposReservationId,
          reservationState: paid ? "confirmed" : "held",
          paymentState: paid ? "paid" : "pending",
          fulfillmentState: getFixtureFulfillmentState({ fulfilled, paid }),
          activePaymentAttemptId: paymentAttemptId,
          reservationDetails: {
            kind: "cowork",
            entryTier: "basic",
            coffee: true,
          },
          locale: "en-US",
          reservationCreatedAt: now,
          reservationConfirmedAt: paid ? now : null,
          paidAt: paid ? now : null,
          fulfilledAt: fulfilled ? now : null,
        });
        yield* tx.insert(paymentAttempts).values({
          id: paymentAttemptId,
          workspaceReservationId: reservationId,
          provider: "nexi",
          providerOrderId: NexiOrderIdSchema.make(
            `synthetic-order-${randomUUID()}`
          ),
          state: paid ? "paid" : "pending",
          amountValue: source.quote.payment.expectedPrice.value,
          amountExponent: source.quote.payment.expectedPrice.exponent,
          currency: source.quote.payment.expectedPrice.currency,
        });
        yield* tx.insert(accountingDocumentSnapshots).values({
          paymentAttemptId,
          workspaceReservationId: reservationId,
          keyId: testKey.id,
          encryptedSnapshot: encryptAccountingSnapshot(
            JSON.stringify(source),
            testKey.secret
          ),
        });
      })
    );

    return {
      paymentAttemptId,
      reservationId,
      dotyposCustomerId,
      dotyposReservationId,
      fulfilledAt: fulfilled ? now : null,
    };
  });

const createAdditionalFailedAttempt = (
  db: DatabaseClient,
  fixture: {
    readonly reservationId: typeof workspaceReservationIdSchema.Type;
    readonly dotyposCustomerId: typeof DotyposCustomerIdSchema.Type;
    readonly dotyposReservationId: typeof DotyposReservationIdSchema.Type;
  }
) =>
  Effect.gen(function* () {
    const paymentAttemptId = paymentAttemptIdSchema.make(randomUUID());
    const source = makeAccountingDocumentSnapshot({
      workspaceReservationId: fixture.reservationId,
      dotyposReservationId: fixture.dotyposReservationId,
      dotyposCustomerId: fixture.dotyposCustomerId,
      locale: "en-US",
      prepared,
    });

    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        yield* tx.insert(paymentAttempts).values({
          id: paymentAttemptId,
          workspaceReservationId: fixture.reservationId,
          provider: "nexi",
          providerOrderId: NexiOrderIdSchema.make(
            `synthetic-order-${randomUUID()}`
          ),
          state: "failed",
          failureCode: "synthetic_invoice_attempt",
          amountValue: source.quote.payment.expectedPrice.value,
          amountExponent: source.quote.payment.expectedPrice.exponent,
          currency: source.quote.payment.expectedPrice.currency,
        });
        yield* tx.insert(accountingDocumentSnapshots).values({
          paymentAttemptId,
          workspaceReservationId: fixture.reservationId,
          keyId: testKey.id,
          encryptedSnapshot: encryptAccountingSnapshot(
            JSON.stringify(source),
            testKey.secret
          ),
        });
      })
    );

    return paymentAttemptId;
  });

const readCounters = (db: DatabaseClient) =>
  db
    .select()
    .from(invoiceNumberCounters)
    .orderBy(asc(invoiceNumberCounters.numberingYear))
    .pipe(
      Effect.map(
        (rows) =>
          new Map(rows.map((row) => [row.numberingYear, row.lastSequence]))
      )
    );

const getFixtureFulfillmentState = ({
  fulfilled,
  paid,
}: {
  readonly fulfilled: boolean;
  readonly paid: boolean;
}) => {
  if (fulfilled) return "fulfilled" as const;
  if (paid) return "processing" as const;
  return "not_started" as const;
};

const isTaggedError = (tag: string) => (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  error._tag === tag;

const hasProperty = (error: unknown, key: string, value: unknown) =>
  typeof error === "object" &&
  error !== null &&
  key in error &&
  error[key as keyof typeof error] === value;

const isInvoiceStorageError =
  (operation: string, causeTag: string) => (error: unknown) =>
    isTaggedError("InvoiceStorageError")(error) &&
    hasProperty(error, "operation", operation) &&
    typeof error === "object" &&
    error !== null &&
    "cause" in error &&
    isTaggedError(causeTag)(error.cause);
