import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import type { Pool } from "pg";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type DatabaseClient,
  makeDatabaseClient,
  makeDatabasePool,
} from "@/db/database-client";
import {
  accountingDocumentSnapshots,
  invoiceNumberCounters,
  invoices,
  paymentAttempts,
  workspaceReservations,
} from "@/db/schema";
import { assertSafeDatabaseUrl } from "@/e2e/runtime";
import { makeAccountingDocumentSnapshot } from "@/features/accounting/accounting-document-snapshot";
import { getInvoiceNumberingYear } from "@/features/accounting/invoice";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import {
  buildCoworkReservationQuote,
  type CoworkReservationQuoteOrder,
} from "@/features/checkout/checkout-quote.test-utils";
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

const integrationEnabled =
  process.env.WORKSPACE_ACCOUNTING_PERSISTENCE_INTEGRATION === "true";
const describeIntegration = integrationEnabled ? describe : describe.skip;
const testKey: AccountingSnapshotKey = {
  id: "K202608",
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

describeIntegration("invoice repository PostgreSQL integration", () => {
  let pool: Pool;
  let db: DatabaseClient;
  let repository: IInvoiceRepository;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    const databaseAllowlist = process.env.WORKSPACE_E2E_DATABASE_ALLOWLIST;
    if (!databaseUrl || !databaseAllowlist) {
      throw new Error(
        "The accounting persistence integration requires an allowlisted preview database."
      );
    }
    assertSafeDatabaseUrl(databaseUrl, "DATABASE_URL", databaseAllowlist);

    pool = makeDatabasePool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 10_000,
      max: 20,
      query_timeout: 10_000,
      statement_timeout: 10_000,
    });
    db = await Effect.runPromise(makeDatabaseClient(pool));
    repository = await makeInvoiceRepository({ db, keys: makeKeyService() });
  });

  afterAll(async () => {
    await pool?.end();
  });

  test("issues exactly once across concurrent retries and keeps ciphertext immutable", async () => {
    const fixture = await createPaidFixture(db);
    const countersBefore = await readCounters(db);
    const buyer = {
      kind: "business" as const,
      legalName: `Synthetic Ciphertext Sentinel ${fixture.reservationId}`,
      companyId: "12345678",
      vatId: "CZ12345678",
      address: {
        line1: "Synthetic 1",
        city: "Praha",
        postalCode: "100 00",
        country: "CZ",
      },
    };

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        Effect.runPromise(
          repository.issue({
            paymentAttemptId: fixture.paymentAttemptId,
            buyer,
          })
        )
      )
    );

    expect(new Set(results.map(({ invoice }) => invoice.id))).toHaveLength(1);
    expect(
      new Set(results.map(({ invoice }) => invoice.invoiceNumber))
    ).toHaveLength(1);
    expect(results.filter(({ changed }) => changed)).toHaveLength(1);
    expect(results[0]?.invoice.document.buyer).toEqual(buyer);
    expect(results[0]?.invoice.document).not.toHaveProperty("schemaVersion");

    const issued = results[0]?.invoice;
    expect(issued).toBeDefined();
    if (!issued) return;
    const numberingYear = getInvoiceNumberingYear(issued.issuedAt);
    const countersAfter = await readCounters(db);
    expect(countersAfter.get(numberingYear)).toBe(
      (countersBefore.get(numberingYear) ?? 0) + 1
    );

    const [stored] = await runQuery(
      db
        .select({ encryptedDocument: invoices.encryptedDocument })
        .from(invoices)
        .where(eq(invoices.id, issued.id))
    );
    expect(
      stored?.encryptedDocument.includes(Buffer.from(buyer.legalName))
    ).toBe(false);

    const retry = await Effect.runPromise(
      repository.issue({
        paymentAttemptId: fixture.paymentAttemptId,
        buyer: { kind: "person", legalName: "Different Synthetic Buyer" },
      })
    );
    expect(retry.changed).toBe(false);
    expect(retry.invoice.id).toBe(issued.id);
    expect(retry.invoice.document.buyer).toEqual(buyer);
    expect(await readCounters(db)).toEqual(countersAfter);

    await expect(
      runQuery(
        db
          .update(invoices)
          .set({ invoiceNumber: "WS-FV-2099-999999" })
          .where(eq(invoices.id, issued.id))
      )
    ).rejects.toBeDefined();
    await expect(
      runQuery(db.delete(invoices).where(eq(invoices.id, issued.id)))
    ).rejects.toBeDefined();
  }, 30_000);

  test("serializes distinct reservations into unique contiguous numbers", async () => {
    const fixtures = await Promise.all(
      Array.from({ length: 5 }, () => createPaidFixture(db))
    );
    const countersBefore = await readCounters(db);
    const results = await Promise.all(
      fixtures.map(({ paymentAttemptId }) =>
        Effect.runPromise(repository.issue({ paymentAttemptId }))
      )
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

    expect(
      new Set(results.map(({ invoice }) => invoice.invoiceNumber))
    ).toHaveLength(fixtures.length);
    expect(sequences).toEqual(
      Array.from({ length: fixtures.length }, (_, index) => before + index + 1)
    );
    expect((await readCounters(db)).get(numberingYear)).toBe(
      before + fixtures.length
    );
  }, 30_000);

  test("rejects ineligible payment without advancing a counter", async () => {
    const fixture = await createPaidFixture(db, { paid: false });
    const before = await readCounters(db);

    await expect(
      Effect.runPromise(
        repository.issue({ paymentAttemptId: fixture.paymentAttemptId })
      )
    ).rejects.toMatchObject({ _tag: "InvoiceEligibilityError" });
    expect(await readCounters(db)).toEqual(before);
  });

  test("rolls back an allocated number when encrypted insertion fails", async () => {
    const fixture = await createPaidFixture(db);
    const badRepository = await makeInvoiceRepository({
      db,
      keys: makeKeyService({ ...testKey, id: "INVALID-ID" }),
    });
    const before = await readCounters(db);

    await expect(
      Effect.runPromise(
        badRepository.issue({ paymentAttemptId: fixture.paymentAttemptId })
      )
    ).rejects.toMatchObject({
      _tag: "InvoiceStorageError",
      operation: "encrypt",
    });
    expect(await readCounters(db)).toEqual(before);

    const successful = await Effect.runPromise(
      repository.issue({ paymentAttemptId: fixture.paymentAttemptId })
    );
    const numberingYear = getInvoiceNumberingYear(successful.invoice.issuedAt);
    expect(
      Number(
        successful.invoice.invoiceNumber.slice(
          successful.invoice.invoiceNumber.lastIndexOf("-") + 1
        )
      )
    ).toBe((before.get(numberingYear) ?? 0) + 1);
  });
});

const makeKeyService = (
  activeKey: AccountingSnapshotKey = testKey
): IAccountingSnapshotKeyService => ({
  getActive: Effect.succeed(activeKey),
  getById: (keyId) =>
    keyId === testKey.id
      ? Effect.succeed(testKey)
      : Effect.fail(
          new AccountingSnapshotKeyError({
            keyId,
            message: "Synthetic integration key is unavailable.",
          })
        ),
});

const makeInvoiceRepository = async (input: {
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
  const snapshotLayer = AccountingDocumentSnapshotRepository.Live.pipe(
    Layer.provide(baseLayer)
  );
  const repositoryLayer = InvoiceRepository.Live.pipe(
    Layer.provide(Layer.merge(baseLayer, snapshotLayer))
  );

  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* InvoiceRepository;
    }).pipe(Effect.provide(repositoryLayer))
  );
};

const createPaidFixture = async (
  db: DatabaseClient,
  options: { readonly paid?: boolean } = {}
) => {
  const paid = options.paid ?? true;
  const reservationId = randomUUID();
  const paymentAttemptId = randomUUID();
  const dotyposCustomerId = `synthetic-customer-${randomUUID()}`;
  const dotyposReservationId = `synthetic-reservation-${randomUUID()}`;
  const now = Temporal.Now.instant();
  const source = makeAccountingDocumentSnapshot({
    workspaceReservationId: reservationId,
    dotyposReservationId,
    dotyposCustomerId,
    locale: "en-US",
    prepared,
  });

  await runQuery(
    db.transaction((tx) =>
      Effect.gen(function* () {
        yield* tx.insert(workspaceReservations).values({
          id: reservationId,
          checkoutSessionKey: randomUUID(),
          checkoutAttemptKey: randomUUID(),
          correlationId: randomUUID(),
          dotyposCustomerId,
          dotyposReservationId,
          customerAccessCode: randomUUID(),
          reservationState: paid ? "confirmed" : "held",
          paymentState: paid ? "paid" : "pending",
          fulfillmentState: "not_started",
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
        });
        yield* tx.insert(paymentAttempts).values({
          id: paymentAttemptId,
          workspaceReservationId: reservationId,
          provider: "nexi",
          providerOrderId: `synthetic-order-${randomUUID()}`,
          state: paid ? "paid" : "pending",
          amountValue: source.quote.payment.expectedPrice.value,
          amountExponent: source.quote.payment.expectedPrice.exponent,
          currency: source.quote.payment.expectedPrice.currency,
        });
        yield* tx.insert(accountingDocumentSnapshots).values({
          paymentAttemptId,
          workspaceReservationId: reservationId,
          schemaVersion: source.schemaVersion,
          keyId: testKey.id,
          encryptedSnapshot: encryptAccountingSnapshot(
            JSON.stringify(source),
            testKey.secret
          ),
        });
      })
    )
  );

  return { paymentAttemptId, reservationId };
};

const readCounters = async (db: DatabaseClient) => {
  const rows = await runQuery(
    db
      .select()
      .from(invoiceNumberCounters)
      .orderBy(asc(invoiceNumberCounters.numberingYear))
  );
  return new Map(rows.map((row) => [row.numberingYear, row.lastSequence]));
};

const runQuery = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect as Effect.Effect<A, E, never>);
