import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { testEmailAddress } from "@deskohub/test-email";
import { asc, eq, sql } from "drizzle-orm";
import { Data, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  accountingDocumentSnapshots,
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
  type PaymentAttemptId,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import {
  buildCoworkReservationQuote,
  type CoworkReservationQuoteOrder,
} from "@/features/checkout/checkout-quote.test-utils";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import {
  createWorkspacePostgresSuiteDatabase,
  type WorkspacePostgresSuiteDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
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

// Listing reads every invoice in the table, so the suite owns its database:
// invoices other suites commit, under other keys, never reach it.
const testDatabase =
  await createWorkspacePostgresSuiteDatabase("invoice_repository");
afterAll(() => testDatabase?.close());

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

// Encrypts another customer's invoice, so a read that must not decrypt it can
// run without this key.
const otherCustomerKey: AccountingSnapshotKey = {
  id: accountingSnapshotKeyIdSchema.make("K209912"),
  secret: "other synthetic accounting snapshot secret!",
};

const makeKeyService = (
  activeKey: AccountingSnapshotKey = testKey,
  readableKeys: readonly AccountingSnapshotKey[] = [activeKey, otherCustomerKey]
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

  const reservationId = await Effect.runPromise(
    Effect.flatMap(WorkspaceDatabase, ({ db, transaction }) =>
      transaction(
        Effect.gen(function* () {
          const reservation = yield* workspaceFixtures(db).reservation({
            stage: {
              reservation: paid ? "confirmed" : "held",
              payment: paid ? "paid" : "pending",
              fulfillment: getFixtureFulfillmentState({ fulfilled, paid }),
            },
            customer: dotyposCustomerId,
            at: now,
            overrides: {
              dotyposReservationId,
              activePaymentAttemptId: paymentAttemptId,
            },
          });
          const source = makeAccountingDocumentSnapshot({
            workspaceReservationId: reservation.id,
            dotyposReservationId,
            dotyposCustomerId,
            locale: "en-US",
            prepared,
          });
          yield* db.insert(paymentAttempts).values({
            id: paymentAttemptId,
            workspaceReservationId: reservation.id,
            provider: "nexi",
            providerOrderId: NexiOrderIdSchema.make(
              `synthetic-order-${randomUUID()}`
            ),
            state: paid ? "paid" : "pending",
            amountValue: source.quote.payment.expectedPrice.value,
            amountExponent: source.quote.payment.expectedPrice.exponent,
            currency: source.quote.payment.expectedPrice.currency,
          });
          yield* db.insert(accountingDocumentSnapshots).values({
            paymentAttemptId,
            workspaceReservationId: reservation.id,
            keyId: testKey.id,
            encryptedSnapshot: encryptAccountingSnapshot(
              JSON.stringify(source),
              testKey.secret
            ),
          });
          return reservation.id;
        })
      )
    ).pipe(Effect.provide(testDatabase!.layer))
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
    Effect.flatMap(WorkspaceDatabase, ({ db, transaction }) =>
      transaction(
        Effect.gen(function* () {
          yield* db.insert(paymentAttempts).values({
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
          yield* db.insert(accountingDocumentSnapshots).values({
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
    ).pipe(Effect.provide(testDatabase!.layer))
  );

  return paymentAttemptId;
};

class RolledBackFixture extends Data.TaggedError("RolledBackFixture")<{
  readonly value: unknown;
}> {}

// Runs the operation in a transaction that always rolls back, so the invoices
// and counter changes it makes never reach the shared database.
const runRepositoryRolledBack = <A, E>(
  operation: (
    repository: IInvoiceRepository,
    database: Pick<WorkspaceDatabase["Service"], "db">
  ) => Effect.Effect<A, E>,
  keys?: IAccountingSnapshotKeyService
) =>
  runRepository(
    (repository) =>
      Effect.flatMap(WorkspaceDatabase, ({ db, transaction }) =>
        transaction(
          operation(repository, { db }).pipe(
            Effect.flatMap((value) => new RolledBackFixture({ value }))
          )
        )
      ).pipe(
        Effect.provide(testDatabase!.layer),
        Effect.catchTag("RolledBackFixture", ({ value }) =>
          Effect.succeed(value as A)
        )
      ),
    keys
  );

const makeManualInvoiceInput = (actor: string) =>
  Schema.decodeUnknownSync(manualInvoiceInputSchema)({
    invoiceId: randomUUID(),
    dotyposCustomerId: `${fixtureCustomerPrefix}${randomUUID()}`,
    buyer: personalInvoiceBuyer,
    deliveryEmail: testEmailAddress("manual-invoice-integration"),
    locale: "en-US",
    serviceDate: "2099-01-01",
    payment: { status: "paid", date: "2099-01-01" },
    currency: "CZK",
    lines: [{ description: "Synthetic line", price: "100.00" }],
    provenance: { source: "admin-ui", actor },
  });

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

// The suite owns its database, so the counters only move through the
// issuances each test performs.
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

describe.skipIf(!testDatabase)(
  "InvoiceRepository on disposable Postgres",
  () => {
    const postgres = testDatabase as WorkspacePostgresSuiteDatabase;

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

    test("finds a reservation's issued invoice by the reservation", async () => {
      const fixture = await createPaidFixture();
      const issued = await issue(fixture.paymentAttemptId);
      // The invoice stays the reservation's after another attempt becomes its
      // active one.
      const laterAttemptId = await createAdditionalFailedAttempt(fixture);
      await Effect.runPromise(
        Effect.flatMap(WorkspaceDatabase, ({ db }) =>
          db
            .update(workspaceReservations)
            .set({ activePaymentAttemptId: laterAttemptId })
            .where(eq(workspaceReservations.id, fixture.reservationId))
        ).pipe(Effect.provide(testDatabase!.layer))
      );

      const found = await runRepository((repository) =>
        repository.findByReservationId(fixture.reservationId)
      );

      expect(found).toMatchObject({
        id: issued.invoice.id,
        invoiceNumber: issued.invoice.invoiceNumber,
        workspaceReservationId: fixture.reservationId,
        paymentAttemptId: fixture.paymentAttemptId,
      });
    });

    test.each([
      ["fulfilled but not invoiced", { fulfilled: true }],
      ["paid but not fulfilled", { fulfilled: false }],
      ["unpaid", { paid: false }],
    ] as const)(
      "finds no invoice for a reservation %s",
      async (_label, options) => {
        const fixture = await createPaidFixture(options);

        const found = await runRepository((repository) =>
          repository.findByReservationId(fixture.reservationId)
        );

        expect(found).toBeNull();
      }
    );

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
      const issuer = await Effect.runPromise(
        workspaceFixtures(postgres.db).account("invoice-repository-issuer")
      );
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

    test("suggests the variable symbol of the next number in the issue year", async () => {
      const numberingYear = getInvoiceNumberingYear(Temporal.Now.instant());

      const suggestions = await runRepositoryRolledBack((repository, { db }) =>
        Effect.gen(function* () {
          yield* db
            .delete(invoiceNumberCounters)
            .where(eq(invoiceNumberCounters.numberingYear, numberingYear));
          const first = yield* repository.getSuggestedVariableSymbol();
          yield* db
            .insert(invoiceNumberCounters)
            .values({ numberingYear, lastSequence: 41 });
          const next = yield* repository.getSuggestedVariableSymbol();
          return { first, next };
        })
      );

      expect(suggestions).toEqual({
        first: `${numberingYear}000001`,
        next: `${numberingYear}000042`,
      });
    });

    test("lists who issued each manual invoice, and through what", async () => {
      const issuer = await Effect.runPromise(
        workspaceFixtures(postgres.db).account("invoice-provenance-issuer")
      );
      const input = makeManualInvoiceInput(issuer.email);
      const reservationFixture = await createPaidFixture();
      const reservationInvoice = await issue(
        reservationFixture.paymentAttemptId
      );

      await runRepository((repository) =>
        repository.issueManual({ ...input, issuedBy: issuer })
      );
      const provenance = await runRepository((repository) =>
        repository.listManualInvoiceProvenance()
      );
      const listed = await runRepository((repository) => repository.list());

      expect(provenance).toContainEqual({
        invoiceId: input.invoiceId,
        provenance: { source: "admin-ui", actor: issuer.email },
      });
      expect(
        provenance.some(
          ({ invoiceId }) => invoiceId === reservationInvoice.invoice.id
        )
      ).toBe(false);
      expect(listed.map(({ id }) => id)).toEqual(
        expect.arrayContaining([input.invoiceId, reservationInvoice.invoice.id])
      );
    });

    test("refuses to read an invoice whose metadata does not match its document", async () => {
      const issuer = await Effect.runPromise(
        workspaceFixtures(postgres.db).account("invoice-mismatch-issuer")
      );
      const input = makeManualInvoiceInput(issuer.email);
      const copiedInvoiceId = randomUUID();

      const error = await runRepositoryRolledBack((repository, { db }) =>
        Effect.gen(function* () {
          yield* repository.issueManual({ ...input, issuedBy: issuer });
          yield* db.execute(sql`
            insert into ${invoices} (
              id, workspace_reservation_id, payment_attempt_id,
              dotypos_customer_id, invoice_number, numbering_year,
              numbering_sequence, key_id, encrypted_document, issued_at
            )
            select ${copiedInvoiceId}, null, null, dotypos_customer_id,
              'WS-FV-' || numbering_year || '-999999', numbering_year, 999999,
              key_id, encrypted_document, issued_at
            from ${invoices}
            where id = ${input.invoiceId}
          `);
          return yield* Effect.flip(repository.findById(copiedInvoiceId));
        })
      );

      expect(error).toMatchObject({
        _tag: "InvoiceStorageError",
        operation: "validate",
        paymentAttemptId: copiedInvoiceId,
      });
    });

    test("refuses to number an invoice without an active encryption key", async () => {
      const fixture = await createPaidFixture();
      const before = await readCounters();

      const error = await issueFailure(fixture.paymentAttemptId, {
        ...makeKeyService(),
        getActive: Effect.fail(
          new AccountingSnapshotKeyError({
            keyId: testKey.id,
            message: "Synthetic active key is unavailable.",
          })
        ),
      });

      expect(error).toMatchObject({
        _tag: "InvoiceStorageError",
        operation: "encrypt",
        paymentAttemptId: fixture.paymentAttemptId,
      });
      expect(await readCounters()).toEqual(before);
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

    describe("customer reads", () => {
      const issueManualFor = async (
        dotyposCustomerId: string,
        keys?: IAccountingSnapshotKeyService
      ) => {
        const issuer = await Effect.runPromise(
          workspaceFixtures(postgres.db).account("invoice-repository-issuer")
        );
        const { invoice } = await runRepository(
          (repository) =>
            repository.issueManual({
              ...makeManualInvoiceInput(issuer.email),
              dotyposCustomerId,
              issuedBy: issuer,
            }),
          keys
        );
        return invoice;
      };
      const ownerOnlyKeys = makeKeyService(testKey, [testKey]);

      test("lists only the customer's invoices, newest issue first", async () => {
        const fixture = await createPaidFixture();
        const owner = fixture.dotyposCustomerId;
        const other = DotyposCustomerIdSchema.make(
          `${fixtureCustomerPrefix}${randomUUID()}`
        );
        const { invoice: reservationInvoice } = await issue(
          fixture.paymentAttemptId
        );
        const manualInvoice = await issueManualFor(owner);
        const otherInvoice = await issueManualFor(other);

        const owned = await runRepository((repository) =>
          repository.listForCustomer(owner)
        );
        expect(owned.map(({ id }) => id)).toEqual([
          manualInvoice.id,
          reservationInvoice.id,
        ]);
        expect(owned).toEqual([manualInvoice, reservationInvoice]);
        expect(
          (
            await runRepository((repository) =>
              repository.listForCustomer(other)
            )
          ).map(({ id }) => id)
        ).toEqual([otherInvoice.id]);
        expect(
          await runRepository((repository) =>
            repository.listForCustomer(
              DotyposCustomerIdSchema.make(
                `${fixtureCustomerPrefix}${randomUUID()}`
              )
            )
          )
        ).toEqual([]);
      });

      test("finds an invoice only for the customer it was issued to", async () => {
        const owner = DotyposCustomerIdSchema.make(
          `${fixtureCustomerPrefix}${randomUUID()}`
        );
        const other = DotyposCustomerIdSchema.make(
          `${fixtureCustomerPrefix}${randomUUID()}`
        );
        const invoice = await issueManualFor(owner);
        const find = (customer: typeof owner, invoiceId: string) =>
          runRepository((repository) =>
            repository.findForCustomer(customer, invoiceId)
          );

        expect(await find(owner, invoice.id)).toEqual(invoice);
        expect(await find(other, invoice.id)).toBeNull();
        expect(await find(owner, randomUUID())).toBeNull();
        expect(await find(owner, "not-an-invoice-id")).toBeNull();
      });

      test("never decrypts another customer's invoice", async () => {
        const owner = DotyposCustomerIdSchema.make(
          `${fixtureCustomerPrefix}${randomUUID()}`
        );
        const other = DotyposCustomerIdSchema.make(
          `${fixtureCustomerPrefix}${randomUUID()}`
        );
        const ownInvoice = await issueManualFor(owner);
        const otherInvoice = await issueManualFor(
          other,
          makeKeyService(otherCustomerKey)
        );

        // Without the other customer's key, decrypting their invoice fails.
        expect(
          await runRepository(
            (repository) => Effect.flip(repository.findById(otherInvoice.id)),
            ownerOnlyKeys
          )
        ).toMatchObject({ _tag: "InvoiceStorageError", operation: "decrypt" });
        expect(
          await runRepository(
            (repository) => repository.listForCustomer(owner),
            ownerOnlyKeys
          )
        ).toEqual([ownInvoice]);
        expect(
          await runRepository(
            (repository) => repository.findForCustomer(owner, otherInvoice.id),
            ownerOnlyKeys
          )
        ).toBeNull();
      });
    });
  }
);
