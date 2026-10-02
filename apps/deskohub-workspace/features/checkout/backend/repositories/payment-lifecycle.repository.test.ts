import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import { orders, paymentAttempts, workspaceReservations } from "@/db/schema";
import {
  type AccountingDocumentSnapshot,
  accountingDocumentSnapshotSchema,
} from "@/features/accounting/accounting-document-snapshot";
import { makeCoworkInvoiceDocument } from "@/features/accounting/invoice.test-utils";
import {
  getDiscountCommitmentPayload,
  makeDiscountCommitment,
} from "@/features/discounts/commitment";
import { discountIdSchema } from "@/features/discounts/contracts";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import {
  PaymentLifecycleRepository,
  validateDiscountCommitment,
  validateInternalPaymentCommitment,
} from "./payment-lifecycle.repository";

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
    workspaceReservationId: "00000000-0000-4000-8000-000000000001",
    billing: {
      purpose: "personal",
      invoice: "none",
    },
    delivery: { email: "synthetic@example.test" },
  });
};

const makeRepository = async () => {
  const recording = await makeRecordingWorkspaceDatabase();
  const repository = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* PaymentLifecycleRepository;
    }).pipe(
      Effect.provide(
        PaymentLifecycleRepository.Default.pipe(Layer.provide(recording.layer))
      )
    )
  );
  return { recording, repository };
};

// The recording database answers in pg's array row mode: build positional
// rows from the table's column order.
const attemptRowValues = {
  id: "attempt-1",
  workspaceReservationId: "00000000-0000-4000-8000-000000000001",
  provider: "nexi",
  state: "created",
  amountValue: 35_000,
  amountExponent: 2,
  currency: "CZK",
};

const attemptRow = (): readonly unknown[] =>
  Object.entries(getTableColumns(paymentAttempts)).map(
    ([propertyKey]) =>
      attemptRowValues[propertyKey as keyof typeof attemptRowValues] ?? null
  );

// The order mirror upsert returns the mirrored order row; the canned row must
// be complete because the orders table decodes every column positionally.
const orderRowValues = {
  id: "00000000-0000-4000-8000-000000000001",
  kind: "reservation",
};

const orderRow = (): readonly unknown[] =>
  Object.entries(getTableColumns(orders)).map(
    ([propertyKey]) =>
      orderRowValues[propertyKey as keyof typeof orderRowValues] ?? null
  );

const heldReservationRowValues = {
  id: "00000000-0000-4000-8000-000000000001",
  checkoutSessionKey: "session-1",
  checkoutAttemptKey: "attempt-key-1",
  correlationId: "correlation-1",
  dotyposCustomerId: "dotypos-customer-1",
  dotyposReservationId: "dotypos-reservation-1",
  reservationState: "held",
  paymentState: "not_started",
  fulfillmentState: "not_started",
  locale: "en-US",
  reservationHoldExpiresAt: "2099-01-01T00:00:00Z",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const heldReservationRow = (): readonly unknown[] =>
  Object.entries(getTableColumns(workspaceReservations)).map(
    ([propertyKey]) =>
      heldReservationRowValues[
        propertyKey as keyof typeof heldReservationRowValues
      ] ?? null
  );

describe("PaymentLifecycleRepository", () => {
  test("owns attempt, reservation, and snapshot admission in one transaction", async () => {
    const { recording, repository } = await makeRepository();
    const snapshot = makeSource();
    recording.setRows([
      // BEGIN
      [heldReservationRow()], // locking the current held reservation
      [orderRow()], // order mirror upsert
      [attemptRow()],
      [], // snapshot insert
      [heldReservationRow()], // linking the attempt to the held reservation
      [orderRow()], // order mirror upsert after linking
    ]);

    await Effect.runPromise(
      repository.createPendingNexiAttempt({
        workspaceReservationId: "00000000-0000-4000-8000-000000000001" as never,
        providerOrderId: "order-1" as never,
        amount: snapshot.quote.payment.expectedPrice,
        commitment: makeDiscountCommitment({
          product: { kind: "cowork", tier: "basic" },
          applications: [],
        }),
        locale: "en-US",
        accountingSnapshot: snapshot,
      })
    ).catch(() => undefined);

    const statements = recording.statements;
    expect(statements[0].sql.toLowerCase()).toBe("begin");
    const reservationLockIndex = statements.findIndex(
      ({ sql }) =>
        sql.includes('from "workspace_reservations"') &&
        sql.includes("for update")
    );
    const attemptInsertIndex = statements.findIndex(({ sql }) =>
      sql.includes('insert into "payment_attempts"')
    );
    const snapshotInsertIndex = statements.findIndex(({ sql }) =>
      sql.includes('insert into "accounting_document_snapshots"')
    );
    const linkUpdateIndex = statements.findIndex(
      ({ sql }) =>
        sql.startsWith('update "workspace_reservations"') &&
        sql.includes('"active_payment_attempt_id"')
    );

    expect(reservationLockIndex).toBeGreaterThan(0);
    expect(attemptInsertIndex).toBeGreaterThan(reservationLockIndex);
    expect(snapshotInsertIndex).toBeGreaterThan(attemptInsertIndex);
    expect(linkUpdateIndex).toBeGreaterThan(snapshotInsertIndex);
  });

  test("rejects inconsistent committed money before opening a transaction", async () => {
    const discountId =
      Schema.decodeUnknownSync(discountIdSchema)("public-discount");
    const application = {
      discount: {
        id: discountId,
        label: "Test discount",
        adjustment: { kind: "percentage" as const, basisPoints: 2000 },
      },
      subtotalBefore: {
        value: 35_000,
        exponent: 2,
        currency: "CZK",
      },
      amount: { value: 7000, exponent: 2, currency: "CZK" },
      subtotalAfter: {
        value: 27_999,
        exponent: 2,
        currency: "CZK",
      },
    };
    const commitment = makeDiscountCommitment({
      product: { kind: "cowork", tier: "basic" },
      applications: [
        {
          application,
          candidate: {
            discount: application.discount,
            provenance: {
              providerNamespace: "test",
              providerReference: "test",
            },
          },
        },
      ],
    });

    const result = await Effect.runPromise(
      Effect.result(
        validateDiscountCommitment(getDiscountCommitmentPayload(commitment))
      )
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DiscountClaimError",
        operation: "reserve",
        reason: "money_mismatch",
      },
    });
  });

  test("rejects an internal payment without a full-discount commitment", async () => {
    const commitment = makeDiscountCommitment({
      product: { kind: "cowork", tier: "basic" },
      applications: [],
    });

    const result = await Effect.runPromise(
      Effect.result(
        validateInternalPaymentCommitment(
          getDiscountCommitmentPayload(commitment),
          {
            value: 0,
            exponent: 2,
            currency: "CZK",
          }
        )
      )
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DiscountClaimError",
        operation: "reserve",
        reason: "money_mismatch",
      },
    });
  });
});
