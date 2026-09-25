import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import {
  type AccountingDocumentSnapshot,
  accountingDocumentSnapshotSchema,
} from "@/features/accounting/accounting-document-snapshot";
import { makeCoworkInvoiceDocument } from "@/features/accounting/invoice.test-utils";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import { AccountingDocumentSnapshotRepository } from "./accounting-document-snapshot.repository";
import { AccountingSnapshotKeyService } from "./accounting-snapshot-key.service";
import { InvoiceRepository } from "./invoice.repository";

mock.module("server-only", () => ({}) as never);

const personalAddress = {
  line1: "Synthetic 1",
  city: "Praha",
  postalCode: "100 00",
  country: "CZ",
};

const makeSource = (): AccountingDocumentSnapshot => {
  const document = makeCoworkInvoiceDocument("en-US");
  const {
    fulfilledAt: _fulfilledAt,
    invoiceNumber: _invoiceNumber,
    issuedAt: _issuedAt,
    paidAt: _paidAt,
    paymentAttemptId: _paymentAttemptId,
    supplier: invoiceSupplier,
    ...identity
  } = document;
  const { commercialRegister: _commercialRegister, ...supplier } =
    invoiceSupplier;

  return Schema.decodeUnknownSync(accountingDocumentSnapshotSchema)({
    ...identity,
    supplier,
    billing: {
      purpose: "personal",
      invoice: "requested",
      address: personalAddress,
    },
    delivery: { email: "synthetic@example.test" },
  });
};

const makeHarness = async () => {
  const recording = await makeRecordingWorkspaceDatabase();
  const snapshotLayer = Layer.succeed(
    AccountingDocumentSnapshotRepository,
    AccountingDocumentSnapshotRepository.of({
      findByPaymentAttemptId: () => Effect.succeed(makeSource()) as never,
    } as never)
  );
  const keysLayer = Layer.succeed(
    AccountingSnapshotKeyService,
    AccountingSnapshotKeyService.of({
      getActive: Effect.succeed({
        id: "key-1" as never,
        secret: "synthetic-secret",
      }),
      getById: () =>
        Effect.succeed({ id: "key-1" as never, secret: "synthetic-secret" }),
    } as never)
  );
  const repository = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* InvoiceRepository;
    }).pipe(
      Effect.provide(
        InvoiceRepository.Default.pipe(
          Layer.provide(snapshotLayer),
          Layer.provide(keysLayer),
          Layer.provide(recording.layer)
        )
      )
    )
  );
  return { recording, repository };
};

// Column order mirrors the locked reservation/attempt select in issue().
const lockedRowBase = {
  reservationId: "reservation-1",
  reservationPaymentState: "paid",
  activePaymentAttemptId: "payment-attempt-1",
  dotyposCustomerId: "dotypos-customer-1",
  dotyposReservationId: "dotypos-reservation-1",
  paidAt: "2026-08-10T12:30:00Z",
  fulfillmentState: "fulfilled",
  fulfilledAt: "2026-08-11T08:00:00Z",
  paymentAttemptState: "paid",
};
const lockedRow = (overrides: Partial<typeof lockedRowBase> = {}) => {
  const base = { ...lockedRowBase, ...overrides };
  return Object.values(base);
};

const issueFlowRows = (locked: readonly unknown[]) => [
  [], // no invoice issued yet for the attempt
  [locked], // locked reservation row
  [], // no existing reservation invoice
  [[3]], // counter allocation returns sequence 3
  [], // invoice insert
];

const buyer = {
  kind: "person" as const,
  legalName: "Ada Lovelace",
  address: personalAddress,
};

describe("invoice repository persistence contract", () => {
  test("locks the reservation and rechecks idempotency before numbering", async () => {
    const { recording, repository } = await makeHarness();
    recording.setRows(issueFlowRows(lockedRow()));

    // The final re-read finds no stored invoice and fails closed; the
    // statement order up to that point is the contract under test.
    await Effect.runPromise(
      repository.issue({ paymentAttemptId: "payment-attempt-1", buyer })
    ).catch(() => undefined);

    const sqlTexts = recording.statements.map(({ sql }) => sql);
    const lockedIndex = sqlTexts.findIndex(
      (sql) =>
        sql.includes('from "payment_attempts"') && sql.includes("for update")
    );
    const existingIndex = sqlTexts.findIndex(
      (sql) =>
        sql.includes('from "invoices"') &&
        sql.includes("workspace_reservation_id")
    );
    const counterIndex = sqlTexts.findIndex((sql) =>
      sql.includes('insert into "invoice_number_counters"')
    );
    const invoiceInsertIndex = sqlTexts.findIndex((sql) =>
      sql.includes('insert into "invoices"')
    );

    expect(lockedIndex).toBeGreaterThan(-1);
    expect(existingIndex).toBeGreaterThan(lockedIndex);
    expect(counterIndex).toBeGreaterThan(existingIndex);
    expect(invoiceInsertIndex).toBeGreaterThan(counterIndex);
  });

  test("allocates the sequence with an upsert instead of a PostgreSQL sequence", async () => {
    const { recording, repository } = await makeHarness();
    recording.setRows(issueFlowRows(lockedRow()));

    await Effect.runPromise(
      repository.issue({ paymentAttemptId: "payment-attempt-1", buyer })
    ).catch(() => undefined);

    const sqlTexts = recording.statements.map(({ sql }) => sql);
    const counterSql = sqlTexts.find((sql) =>
      sql.includes('insert into "invoice_number_counters"')
    );
    expect(counterSql).toContain("on conflict");
    expect(counterSql).toContain('"last_sequence" + 1');
    expect(sqlTexts.join("\n")).not.toContain("nextval");
  });

  test("refuses to invoice before the attempt, reservation, and delivery are all paid", async () => {
    const { recording, repository } = await makeHarness();
    recording.setRows(
      issueFlowRows(lockedRow({ paymentAttemptState: "failed" }))
    );

    const error = await Effect.runPromise(
      Effect.flip(
        repository.issue({ paymentAttemptId: "payment-attempt-1", buyer })
      )
    );

    expect(error).toMatchObject({ _tag: "InvoiceEligibilityError" });
    const sqlTexts = recording.statements.map(({ sql }) => sql);
    expect(
      sqlTexts.some((sql) =>
        sql.includes('insert into "invoice_number_counters"')
      )
    ).toBe(false);
  });

  test("does not return a reservation invoice issued from a different attempt", async () => {
    const { recording, repository } = await makeHarness();
    // The existing-invoice lookup returns an id, meaning the reservation was
    // already invoiced from another payment attempt.
    recording.setRows([
      [],
      [lockedRow()],
      [["invoice-1", "payment-attempt-9"]],
    ]);

    const error = await Effect.runPromise(
      Effect.flip(
        repository.issue({ paymentAttemptId: "payment-attempt-1", buyer })
      )
    );

    expect(error).toMatchObject({ _tag: "InvoiceEligibilityError" });
  });

  test("requires complete buyer billing details", async () => {
    const { recording, repository } = await makeHarness();
    recording.setRows(issueFlowRows(lockedRow()));

    const error = await Effect.runPromise(
      Effect.flip(
        repository.issue({
          paymentAttemptId: "payment-attempt-1",
          buyer: { kind: "person", legalName: "Ada Lovelace" } as never,
        })
      )
    );

    expect(error).toMatchObject({ _tag: "InvoiceEligibilityError" });
  });

  test("serializes manual invoice ids with an advisory lock before numbering", async () => {
    const { recording, repository } = await makeHarness();
    recording.setRows([
      [], // findById: no stored invoice yet
      [], // advisory lock statement (no rows)
      [], // existing id lookup inside the transaction
      [[2]], // counter allocation
      [], // manual invoice insert
      [], // final findById key lookup (fails closed afterwards)
    ]);

    await Effect.runPromise(
      repository.issueManual({
        invoiceId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
        dotyposCustomerId: "dotypos-customer-1" as never,
        buyer,
        deliveryEmail: "synthetic@example.test",
        locale: "en-US",
        serviceDate: "2026-01-01",
        payment: { status: "paid", date: "2026-01-01" },
        currency: "CZK" as never,
        lines: [{ description: "Synthetic line", price: "100.00" }],
        provenance: { source: "admin-ui", actor: "synthetic-admin" },
      } as never)
    ).catch(() => undefined);

    const sqlTexts = recording.statements.map(({ sql }) => sql);
    const advisoryIndex = sqlTexts.findIndex((sql) =>
      sql.includes("pg_advisory_xact_lock")
    );
    const existingIndex = sqlTexts.findIndex(
      (sql, index) =>
        index > advisoryIndex &&
        sql.includes('from "invoices"') &&
        sql.includes("limit")
    );
    const counterIndex = sqlTexts.findIndex((sql) =>
      sql.includes('insert into "invoice_number_counters"')
    );

    expect(advisoryIndex).toBeGreaterThan(-1);
    expect(existingIndex).toBeGreaterThan(advisoryIndex);
    expect(counterIndex).toBeGreaterThan(existingIndex);
  });
});
