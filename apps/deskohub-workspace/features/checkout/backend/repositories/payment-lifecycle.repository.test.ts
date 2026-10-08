import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { paymentAttempts } from "@/db/schema";
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
  redeemCodeClaim,
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
const attemptRow = (): readonly unknown[] =>
  Object.entries(getTableColumns(paymentAttempts)).map(([propertyKey]) =>
    propertyKey === "id" ? "attempt-1" : null
  );

describe("PaymentLifecycleRepository", () => {
  test("owns attempt, reservation, and snapshot admission in one transaction", async () => {
    const { recording, repository } = await makeRepository();
    const snapshot = makeSource();
    recording.setRows([
      // BEGIN
      [
        [
          "reservation-1",
          "dotypos-customer-1",
          "dotypos-reservation-1",
          "2099-01-01T00:00:00Z",
        ],
      ],
      [attemptRow()],
      [], // snapshot insert
      [["reservation-1"]], // linking the attempt to the held reservation
    ]);

    await Effect.runPromise(
      repository.createPendingNexiAttempt({
        workspaceReservationId: "reservation-1" as never,
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

  test("re-redeems a released code claim within the per-customer use limit", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    recording.setRows([
      // Released claim of this payment attempt.
      [["customer-1", "code-1", "released"]],
      // No voucher claim.
      [],
      // Code without total or per-customer limits.
      [[null, null]],
      // The same customer redeemed the code once more since the release.
      [[1]],
      [],
    ]);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        return yield* db.transaction((tx) =>
          redeemCodeClaim(
            tx,
            "attempt-1" as never,
            Temporal.Instant.from("2026-01-01T00:00:00Z"),
            true
          )
        );
      }).pipe(Effect.provide(recording.layer), Effect.result)
    );

    expect(result._tag).toBe("Success");
    expect(
      recording.statements.some(({ sql }) =>
        sql.startsWith('update "discount_code_redemptions"')
      )
    ).toBe(true);
  });

  test("refuses to re-redeem a released code claim beyond the per-customer use limit", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    recording.setRows([
      [["customer-1", "code-1", "released"]],
      [],
      // One use per customer.
      [[null, 1]],
      // The customer already holds another active use.
      [[1]],
      [],
    ]);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        return yield* db.transaction((tx) =>
          redeemCodeClaim(
            tx,
            "attempt-1" as never,
            Temporal.Instant.from("2026-01-01T00:00:00Z"),
            true
          )
        );
      }).pipe(Effect.provide(recording.layer), Effect.result)
    );

    expect(result._tag).toBe("Failure");
    if (result._tag !== "Failure") throw new Error("Expected failure");
    expect(result.failure).toMatchObject({
      _tag: "DiscountClaimError",
      reason: "usage_limit_reached",
    });
    expect(
      recording.statements.some(({ sql }) =>
        sql.startsWith('update "discount_code_redemptions"')
      )
    ).toBe(false);
  });
});
