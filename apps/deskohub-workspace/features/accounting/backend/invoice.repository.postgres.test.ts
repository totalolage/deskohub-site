import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { NexiCorrelationIdSchema, NexiOrderIdSchema } from "@deskohub/nexi";
import { testEmailAddress } from "@deskohub/test-email";
import { asc, eq, inArray, like, sql } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import {
  accountingDocumentSnapshots,
  invoiceEmailDeliveries,
  invoiceNumberCounters,
  invoices,
  manualInvoiceActors,
  paymentAttempts,
  workspaceReservations,
} from "@/db/schema";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import {
  accountingSnapshotKeyIdSchema,
  companyRegistrationIdSchema,
  makeAccountingDocumentSnapshot,
  vatRegistrationIdSchema,
} from "@/features/accounting/accounting-document-snapshot";
import {
  getInvoiceNumberingYear,
  type InvoiceBuyer,
  type InvoiceNumber,
} from "@/features/accounting/invoice";
import { manualInvoiceInputSchema } from "@/features/accounting/manual-invoice";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import {
  checkoutAttemptKeySchema,
  checkoutSessionKeySchema,
  type PaymentAttemptId,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import {
  buildCoworkReservationQuote,
  type CoworkReservationQuoteOrder,
} from "@/features/checkout/checkout-quote.test-utils";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  deleteTestAccounts,
  insertTestAccount,
} from "@/shared/testing/workspace-test-accounts.test-utils";
import { temporalInstantToIsoString } from "@/shared/utils/temporal";
import { AccountingDocumentSnapshotRepository } from "./accounting-document-snapshot.repository";
import {
  type AccountingSnapshotKey,
  AccountingSnapshotKeyError,
  AccountingSnapshotKeyService,
  type IAccountingSnapshotKeyService,
} from "./accounting-snapshot-key.service";
import { encryptAccountingSnapshot } from "./accounting-snapshot-sql";
import {
  type IInvoiceRepository,
  InvoiceRepository,
} from "./invoice.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

// Every fixture invoice carries this prefix so cleanup never touches invoices
// other suites leave in the shared disposable database.
const fixtureCustomerPrefix = "invoice-repository-customer-";

const testKey: AccountingSnapshotKey = {
  id: accountingSnapshotKeyIdSchema.make("K202608"),
  secret: "synthetic accounting snapshot secret!",
};
const coworkOrder = {
  entryTier: "open-space",
  coffee: true,
} satisfies CoworkReservationQuoteOrder;
const prepared = {
  kind: "cowork",
  reservation: {
    kind: "cowork",
    ...coworkOrder,
    date: "2099-01-01",
    name: "Synthetic Invoice Customer",
    email: testEmailAddress("invoice-integration"),
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

const runRepository = <A, E>(
  operation: (repository: IInvoiceRepository) => Effect.Effect<A, E>,
  keys: IAccountingSnapshotKeyService = makeKeyService()
): Promise<A> => {
  const baseLayer = Layer.merge(
    testDatabase!.layer,
    Layer.succeed(
      AccountingSnapshotKeyService,
      AccountingSnapshotKeyService.of(keys)
    )
  );
  const repositoryLayer = InvoiceRepository.Default.pipe(
    Layer.provide(
      Layer.merge(
        baseLayer,
        AccountingDocumentSnapshotRepository.Default.pipe(
          Layer.provide(baseLayer)
        )
      )
    )
  );

  return Effect.runPromise(
    InvoiceRepository.pipe(
      Effect.flatMap(operation),
      Effect.provide(repositoryLayer)
    )
  );
};

const issue = (
  paymentAttemptId: PaymentAttemptId,
  buyer: InvoiceBuyer = personalInvoiceBuyer,
  keys?: IAccountingSnapshotKeyService
) =>
  runRepository(
    (repository) => repository.issue({ paymentAttemptId, buyer }),
    keys
  );

const issueFailure = (
  paymentAttemptId: PaymentAttemptId,
  keys?: IAccountingSnapshotKeyService
) =>
  runRepository(
    (repository) =>
      Effect.flip(
        repository.issue({ paymentAttemptId, buyer: personalInvoiceBuyer })
      ),
    keys
  );

const createPaidFixture = async (
  options: { readonly fulfilled?: boolean; readonly paid?: boolean } = {}
) => {
  const paid = options.paid ?? true;
  const fulfilled = options.fulfilled ?? paid;
  const reservationId = workspaceReservationIdSchema.make(randomUUID());
  const paymentAttemptId = paymentAttemptIdSchema.make(randomUUID());
  const dotyposCustomerId = DotyposCustomerIdSchema.make(
    `${fixtureCustomerPrefix}${randomUUID()}`
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

  await Effect.runPromise(
    testDatabase!.db.transaction((tx) =>
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
    )
  );

  return {
    paymentAttemptId,
    reservationId,
    dotyposCustomerId,
    dotyposReservationId,
    fulfilledAt: fulfilled ? now : null,
  };
};

type PaidFixture = Awaited<ReturnType<typeof createPaidFixture>>;

const createAdditionalFailedAttempt = async (fixture: PaidFixture) => {
  const paymentAttemptId = paymentAttemptIdSchema.make(randomUUID());
  const source = makeAccountingDocumentSnapshot({
    workspaceReservationId: fixture.reservationId,
    dotyposReservationId: fixture.dotyposReservationId,
    dotyposCustomerId: fixture.dotyposCustomerId,
    locale: "en-US",
    prepared,
  });

  await Effect.runPromise(
    testDatabase!.db.transaction((tx) =>
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
    )
  );

  return paymentAttemptId;
};

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

// The suite runs alone against its database (`--parallel=1`), so the
// counters only move through the issuances each test performs.
const readCounters = () =>
  Effect.runPromise(
    testDatabase!.db
      .select()
      .from(invoiceNumberCounters)
      .orderBy(asc(invoiceNumberCounters.numberingYear))
  ).then(
    (rows) => new Map(rows.map((row) => [row.numberingYear, row.lastSequence]))
  );

const sequenceOf = (invoiceNumber: InvoiceNumber) =>
  Number(invoiceNumber.slice(invoiceNumber.lastIndexOf("-") + 1));

// Issued invoices are immutable, so removing fixtures takes the same
// exclusive lock and trigger toggle an operator would need.
const deleteFixtureInvoices = () =>
  Effect.runPromise(
    testDatabase!.db.transaction((tx) =>
      Effect.gen(function* () {
        yield* tx.execute(sql`lock table ${invoices} in access exclusive mode`);
        yield* tx.execute(
          sql`alter table ${invoices} disable trigger invoices_immutable`
        );
        const fixtureInvoices = tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(like(invoices.dotyposCustomerId, `${fixtureCustomerPrefix}%`));
        yield* tx
          .delete(invoiceEmailDeliveries)
          .where(inArray(invoiceEmailDeliveries.invoiceId, fixtureInvoices));
        yield* tx
          .delete(manualInvoiceActors)
          .where(inArray(manualInvoiceActors.invoiceId, fixtureInvoices));
        yield* tx
          .delete(invoices)
          .where(like(invoices.dotyposCustomerId, `${fixtureCustomerPrefix}%`));
        yield* tx.execute(
          sql`alter table ${invoices} enable trigger invoices_immutable`
        );
      })
    )
  );

describe.skipIf(!testDatabase)(
  "InvoiceRepository on disposable Postgres",
  () => {
    const postgres = testDatabase as WorkspacePostgresTestDatabase;
    const testAccounts: Awaited<ReturnType<typeof insertTestAccount>>[] = [];

    afterAll(async () => {
      await deleteFixtureInvoices();
      await deleteTestAccounts(postgres, testAccounts);
      const remaining = await postgres.pool.query(
        "select 1 from invoices where dotypos_customer_id like $1 limit 1",
        [`${fixtureCustomerPrefix}%`]
      );
      const trigger = await postgres.pool.query<{ tgenabled: string }>(
        "select tgenabled from pg_trigger where tgname = 'invoices_immutable'"
      );
      expect(remaining.rowCount).toBe(0);
      expect(trigger.rows).toEqual([{ tgenabled: "O" }]);
    });

    test("issues one encrypted, immutable invoice for concurrent requests", async () => {
      const fixture = await createPaidFixture();
      const countersBefore = await readCounters();
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

      const results = await Promise.all(
        Array.from({ length: 10 }, () => issue(fixture.paymentAttemptId, buyer))
      );

      expect(new Set(results.map(({ invoice }) => invoice.id)).size).toBe(1);
      expect(
        new Set(results.map(({ invoice }) => invoice.invoiceNumber)).size
      ).toBe(1);
      expect(results.filter(({ changed }) => changed)).toHaveLength(1);
      const issued = results[0]!.invoice;
      expect(issued.document.buyer).toEqual(buyer);
      expect("schemaVersion" in issued.document).toBe(false);
      expect(issued.document.fulfilledAt).toBeTruthy();
      expect(
        Temporal.Instant.compare(
          Temporal.Instant.from(issued.document.fulfilledAt!),
          fixture.fulfilledAt!
        )
      ).toBe(0);
      const numberingYear = getInvoiceNumberingYear(issued.issuedAt);
      const countersAfter = await readCounters();
      expect(countersAfter.get(numberingYear)).toBe(
        (countersBefore.get(numberingYear) ?? 0) + 1
      );

      const [stored] = await Effect.runPromise(
        postgres.db
          .select({ encryptedDocument: invoices.encryptedDocument })
          .from(invoices)
          .where(eq(invoices.id, issued.id))
      );
      expect(
        stored!.encryptedDocument.includes(Buffer.from(buyer.legalName))
      ).toBe(false);

      const retry = await issue(fixture.paymentAttemptId, {
        ...personalInvoiceBuyer,
        legalName: "Different Synthetic Buyer",
      });
      expect(retry.changed).toBe(false);
      expect(retry.invoice.id).toBe(issued.id);
      expect(retry.invoice.document.buyer).toEqual(buyer);
      expect(await readCounters()).toEqual(countersAfter);

      const immutable = {
        code: "55000",
        message: "issued invoices are immutable",
      };
      await expect(
        postgres.pool.query(
          "update invoices set invoice_number = 'WS-FV-2099-999999' where id = $1",
          [issued.id]
        )
      ).rejects.toMatchObject(immutable);
      await expect(
        postgres.pool.query("delete from invoices where id = $1", [issued.id])
      ).rejects.toMatchObject(immutable);
    });

    test("numbers concurrent invoices without gaps or duplicates", async () => {
      const fixtures = await Promise.all(
        Array.from({ length: 5 }, () => createPaidFixture())
      );
      const countersBefore = await readCounters();

      const results = await Promise.all(
        fixtures.map(({ paymentAttemptId }) => issue(paymentAttemptId))
      );

      const numberingYear = getInvoiceNumberingYear(
        results[0]!.invoice.issuedAt
      );
      const before = countersBefore.get(numberingYear) ?? 0;
      expect(
        new Set(results.map(({ invoice }) => invoice.invoiceNumber)).size
      ).toBe(fixtures.length);
      expect(
        results
          .map(({ invoice }) => sequenceOf(invoice.invoiceNumber))
          .sort((left, right) => left - right)
      ).toEqual(
        Array.from(
          { length: fixtures.length },
          (_, index) => before + index + 1
        )
      );
      expect((await readCounters()).get(numberingYear)).toBe(
        before + fixtures.length
      );
    });

    test.each([
      ["an unpaid payment attempt", { paid: false }],
      ["an unfulfilled reservation", { fulfilled: false }],
    ] as const)("refuses to number %s", async (_, options) => {
      const fixture = await createPaidFixture(options);
      const before = await readCounters();

      const error = await issueFailure(fixture.paymentAttemptId);

      expect(error).toMatchObject({ _tag: "InvoiceEligibilityError" });
      expect(await readCounters()).toEqual(before);
    });

    test("refuses to number a failed attempt of a paid reservation", async () => {
      const fixture = await createPaidFixture();
      const failedPaymentAttemptId =
        await createAdditionalFailedAttempt(fixture);
      const before = await readCounters();

      const error = await issueFailure(failedPaymentAttemptId);

      expect(error).toMatchObject({
        _tag: "InvoiceEligibilityError",
        paymentAttemptId: failedPaymentAttemptId,
      });
      expect(await readCounters()).toEqual(before);
    });

    test("rejects a second payment attempt for an invoiced reservation", async () => {
      const fixture = await createPaidFixture();
      await issue(fixture.paymentAttemptId);
      const otherPaymentAttemptId =
        await createAdditionalFailedAttempt(fixture);

      const error = await issueFailure(otherPaymentAttemptId);

      expect(error).toMatchObject({
        _tag: "InvoiceEligibilityError",
        paymentAttemptId: otherPaymentAttemptId,
      });
    });

    test("issues one manual invoice for concurrent requests with the same id", async () => {
      const issuer = await insertTestAccount(
        postgres,
        "invoice-repository-issuer"
      );
      testAccounts.push(issuer);
      const input = Schema.decodeUnknownSync(manualInvoiceInputSchema)({
        invoiceId: randomUUID(),
        dotyposCustomerId: `${fixtureCustomerPrefix}${randomUUID()}`,
        buyer: personalInvoiceBuyer,
        deliveryEmail: testEmailAddress("manual-invoice-integration"),
        locale: "en-US",
        serviceDate: "2099-01-01",
        payment: { status: "paid", date: "2099-01-01" },
        currency: "CZK",
        lines: [{ description: "Synthetic line", price: "100.00" }],
        provenance: { source: "admin-ui", actor: issuer.email },
      });
      const before = await readCounters();

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          runRepository((repository) =>
            repository.issueManual({ ...input, issuedBy: issuer })
          )
        )
      );

      expect(new Set(results.map(({ invoice }) => invoice.id))).toEqual(
        new Set([input.invoiceId])
      );
      expect(
        new Set(results.map(({ invoice }) => invoice.invoiceNumber)).size
      ).toBe(1);
      expect(results.filter(({ changed }) => changed)).toHaveLength(1);
      expect(results[0]!.invoice.document).toMatchObject({
        provenance: { source: "admin-ui", actor: issuer.email },
      });
      const expectedActor = [
        {
          invoiceId: input.invoiceId,
          actorAccountId: issuer.accountId,
          actorAccountEmail: issuer.email,
        },
      ];
      const readActors = () =>
        Effect.runPromise(
          postgres.db
            .select()
            .from(manualInvoiceActors)
            .where(eq(manualInvoiceActors.invoiceId, input.invoiceId))
        );
      expect(await readActors()).toEqual(expectedActor);

      const retry = await runRepository((repository) =>
        repository.issueManual({ ...input, issuedBy: issuer })
      );
      expect(retry.changed).toBe(false);
      expect(await readActors()).toEqual(expectedActor);

      const numberingYear = getInvoiceNumberingYear(
        results[0]!.invoice.issuedAt
      );
      expect((await readCounters()).get(numberingYear)).toBe(
        (before.get(numberingYear) ?? 0) + 1
      );
    });

    test("rolls back a manual invoice when its issuer account is missing", async () => {
      const invoiceId = randomUUID();
      const issuedBy = {
        accountId: customerAccountIdSchema.make(randomUUID()),
        email: testEmailAddress("missing-invoice-issuer-account"),
      };
      const input = Schema.decodeUnknownSync(manualInvoiceInputSchema)({
        invoiceId,
        dotyposCustomerId: `${fixtureCustomerPrefix}${randomUUID()}`,
        buyer: personalInvoiceBuyer,
        deliveryEmail: testEmailAddress("missing-invoice-issuer"),
        locale: "en-US",
        serviceDate: "2099-01-01",
        payment: { status: "paid", date: "2099-01-01" },
        currency: "CZK",
        lines: [{ description: "Synthetic line", price: "100.00" }],
        provenance: { source: "admin-ui", actor: issuedBy.email },
      });

      const error = await runRepository((repository) =>
        Effect.flip(repository.issueManual({ ...input, issuedBy }))
      );

      expect(error).toBeDefined();
      const invoiceRows = await postgres.pool.query(
        "select id from invoices where id = $1",
        [invoiceId]
      );
      const actorRows = await postgres.pool.query(
        "select invoice_id from manual_invoice_actors where invoice_id = $1",
        [invoiceId]
      );
      expect(invoiceRows.rows).toEqual([]);
      expect(actorRows.rows).toEqual([]);
    });

    test("rolls the number back when the invoice insert fails", async () => {
      const fixture = await createPaidFixture();
      const invalidActiveKey: AccountingSnapshotKey = {
        ...testKey,
        // Deliberately bypass the application brand to prove the database failure
        // rolls the number allocation back in the same transaction.
        id: "INVALID-ID" as AccountingSnapshotKey["id"],
      };
      const before = await readCounters();

      const insertError = await issueFailure(
        fixture.paymentAttemptId,
        makeKeyService(invalidActiveKey, [testKey, invalidActiveKey])
      );

      expect(insertError).toMatchObject({
        _tag: "InvoiceStorageError",
        operation: "encrypt",
        cause: { _tag: "EffectDrizzleQueryError" },
      });
      expect(await readCounters()).toEqual(before);

      const successful = await issue(fixture.paymentAttemptId);
      const numberingYear = getInvoiceNumberingYear(
        successful.invoice.issuedAt
      );
      expect(sequenceOf(successful.invoice.invoiceNumber)).toBe(
        (before.get(numberingYear) ?? 0) + 1
      );

      const decryptError = await runRepository(
        (repository) =>
          Effect.flip(
            repository.findByPaymentAttemptId(fixture.paymentAttemptId)
          ),
        makeKeyService({
          ...testKey,
          secret: "different synthetic accounting snapshot secret!",
        })
      );
      expect(decryptError).toMatchObject({
        _tag: "InvoiceStorageError",
        operation: "decrypt",
        cause: { _tag: "EffectDrizzleQueryError" },
      });
    });
  }
);
