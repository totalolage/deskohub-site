import { describe, expect, test } from "bun:test";
import { getTableColumns, type Table } from "drizzle-orm";
import { Effect, Layer } from "effect";
import "@/shared/polyfills/temporal";
import { latePaymentRecoveries, workspaceReservations } from "@/db/schema";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import {
  LatePaymentRecoveryRepository,
  LatePaymentRecoveryStateError,
} from "./late-payment-recovery.repository";

const paidAt = "2026-01-01T00:00:00.000Z";
const completedAt = Temporal.Instant.from("2026-01-01T01:00:00.000Z");

/**
 * The recording database answers in pg's array row mode, so canned rows are
 * positional: build them from the table's column order.
 */
const rowOf = <V extends object>(
  table: Table,
  values: V
): readonly unknown[] => {
  const valueByKey = new Map(Object.entries(values));
  return Object.entries(getTableColumns(table)).map(
    ([propertyKey]) => valueByKey.get(propertyKey) ?? null
  );
};

const makeRepository = async () => {
  const recording = await makeRecordingWorkspaceDatabase();
  const repository = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* LatePaymentRecoveryRepository;
    }).pipe(
      Effect.provide(
        LatePaymentRecoveryRepository.Default.pipe(
          Layer.provide(recording.layer)
        )
      )
    )
  );
  return { recording, repository };
};

const processingRecoveryRow = () =>
  rowOf(latePaymentRecoveries, {
    paymentAttemptId: "attempt-1",
    workspaceReservationId: "reservation-1",
    webhookEventId: "webhook-1",
    providerOperationId: "operation-1",
    providerStatus: "CAPTURED",
    state: "processing",
    originalDotyposReservationId: "dotypos-original",
    verifiedPaidAt: paidAt,
  });

const reservationRowDefaults = {
  id: "reservation-1",
  checkoutSessionKey: "session-1",
  createdAt: paidAt,
  activePaymentAttemptId: "attempt-1",
  reservationState: "held",
  dotyposReservationId: "dotypos-original",
};

const reservationRow = (
  overrides: Partial<typeof reservationRowDefaults> = {}
) =>
  rowOf(workspaceReservations, {
    ...reservationRowDefaults,
    ...overrides,
  });

const settleSuccessRows = (
  reservation: Partial<typeof reservationRowDefaults>
) => [
  [processingRecoveryRow()],
  [reservationRow(reservation)],
  [],
  [["attempt-1"]],
  [],
  [],
  [["reservation-1"]],
  [],
];

describe("LatePaymentRecoveryRepository", () => {
  test("only treats later checkout-session reservations as superseding", async () => {
    const { recording, repository } = await makeRepository();
    recording.setRows([[["session-1", paidAt]], [["reservation-2"]]]);

    const hasNewer = await Effect.runPromise(
      repository.hasNewerActiveReservation("reservation-1" as never)
    );

    expect(hasNewer).toBe(true);
    const supersessionSql = recording.statements[1].sql;
    expect(supersessionSql).toContain('"created_at" > ');
    expect(supersessionSql).toContain('"reservation_state" <> ');
    expect(supersessionSql).toContain('"checkout_session_key" = ');
    expect(supersessionSql).toContain('"id" <> ');
  });

  test("rechecks supersession when settling with the original reservation", async () => {
    const { recording, repository } = await makeRepository();
    recording.setRows([
      [processingRecoveryRow()],
      [reservationRow()],
      [["reservation-2"]],
    ]);

    const error = await Effect.runPromise(
      Effect.flip(
        repository.completeUsingOriginalReservation({
          paymentAttemptId: "attempt-1" as never,
          workspaceReservationId: "reservation-1" as never,
          reservationState: "confirmed",
          completedAt,
        })
      )
    );

    expect(error).toBeInstanceOf(LatePaymentRecoveryStateError);
    const supersessionStatement = recording.statements.find(({ sql }) =>
      sql.includes('"created_at" > ')
    );
    expect(supersessionStatement).toBeDefined();
    expect(recording.statements.map(({ sql }) => sql)).not.toContainEqual(
      expect.stringContaining('update "payment_attempts"')
    );
  });

  test("allows a replacement to settle after the original reservation was cancelled", async () => {
    const { recording, repository } = await makeRepository();
    recording.setRows(settleSuccessRows({ reservationState: "cancelled" }));

    await Effect.runPromise(
      repository.completeWithReplacement({
        paymentAttemptId: "attempt-1" as never,
        workspaceReservationId: "reservation-1" as never,
        recoveredDotyposReservationId: "dotypos-replacement" as never,
        reservationState: "confirmed",
        completedAt,
      })
    );

    const sqlTexts = recording.statements.map(({ sql }) => sql);
    expect(sqlTexts[0].toLowerCase()).toBe("begin");
    expect(sqlTexts.at(-1)?.toLowerCase()).toBe("commit");
    // The locked admission reads: the recovery row and the reservation row.
    expect(
      sqlTexts.filter(
        (sql) =>
          sql.includes("for update") &&
          (sql.includes('from "late_payment_recoveries"') ||
            sql.includes('from "workspace_reservations"'))
      )
    ).toHaveLength(2);
    const reservationUpdate = recording.statements.find(({ sql }) =>
      sql.startsWith('update "workspace_reservations"')
    );
    expect(reservationUpdate?.params).toContain("dotypos-replacement");
  });

  test("marks the settled payment attempt as requiring a refund without replacing the reservation", async () => {
    const { recording, repository } = await makeRepository();
    recording.setRows([
      [processingRecoveryRow()],
      [reservationRow({ activePaymentAttemptId: "attempt-2" })],
      [["attempt-1"]],
      [],
    ]);

    await Effect.runPromise(
      repository.requireRefund({
        paymentAttemptId: "attempt-1" as never,
        workspaceReservationId: "reservation-1" as never,
        failureCode: "provider_refund_needed",
        completedAt,
      })
    );

    const sqlTexts = recording.statements.map(({ sql }) => sql);
    const attemptUpdate = recording.statements.find(({ sql }) =>
      sql.startsWith('update "payment_attempts"')
    );
    expect(attemptUpdate?.params).toContain("required");
    expect(sqlTexts.join("\n")).not.toContain(
      'update "workspace_reservations" set'
    );
    const recoveryUpdate = recording.statements.find(({ sql }) =>
      sql.startsWith('update "late_payment_recoveries"')
    );
    expect(recoveryUpdate?.params).toContain("refund_required");
  });

  test("redeems the attempt's discount claim inside the recovered settlement transaction", async () => {
    const { recording, repository } = await makeRepository();
    recording.setRows(
      settleSuccessRows(reservationRow({ reservationState: "held" }))
    );

    await Effect.runPromise(
      repository.completeUsingOriginalReservation({
        paymentAttemptId: "attempt-1" as never,
        workspaceReservationId: "reservation-1" as never,
        reservationState: "confirmed",
        completedAt,
      })
    );

    const sqlTexts = recording.statements.map(({ sql }) => sql);
    const attemptUpdateIndex = sqlTexts.findIndex((sql) =>
      sql.startsWith('update "payment_attempts"')
    );
    const redemptionSelectIndex = sqlTexts.findIndex((sql) =>
      sql.includes('from "discount_code_redemptions"')
    );
    expect(attemptUpdateIndex).toBeGreaterThanOrEqual(0);
    expect(redemptionSelectIndex).toBeGreaterThan(attemptUpdateIndex);
    expect(sqlTexts[redemptionSelectIndex]).toContain("for update");
  });
});
