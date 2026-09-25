import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { workspaceReservations } from "@/db/schema";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationStateError,
} from "./workspace-reservation.repository";

const now = Temporal.Instant.from("2026-01-01T12:00:00.000Z");
const staleBefore = Temporal.Instant.from("2026-01-01T11:00:00.000Z");

const makeRepository = async () => {
  const recording = await makeRecordingWorkspaceDatabase();
  const repository = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* WorkspaceReservationRepository;
    }).pipe(
      Effect.provide(
        WorkspaceReservationRepository.Default.pipe(
          Layer.provide(recording.layer)
        )
      )
    )
  );
  return { recording, repository };
};

// The recording database answers in pg's array row mode: build positional
// rows from the table's column order.
const reservationRowBase = {
  id: "reservation-1",
  checkoutSessionKey: "session-1",
  checkoutAttemptKey: "attempt-key-1",
  correlationId: "correlation-1",
  dotyposCustomerId: "dotypos-customer-1",
  dotyposReservationId: "dotypos-reservation-1",
  reservationState: "held",
  paymentState: "paid",
  fulfillmentState: "fulfilled",
  reservationDetails: {
    kind: "cowork",
    entryTier: "basic",
    coffee: false,
  },
  locale: "en-US",
  paidAt: "2026-01-01T10:00:00Z",
  reservationConfirmedAt: "2026-01-01T10:00:00Z",
};
const reservationRow = (
  values: Partial<typeof reservationRowBase> = {}
): readonly unknown[] => {
  const base = { ...reservationRowBase, ...values };
  return Object.entries(getTableColumns(workspaceReservations)).map(
    ([propertyKey]) =>
      propertyKey in values
        ? values[propertyKey]
        : (base[propertyKey as keyof typeof base] ?? null)
  );
};

const sqlTextsOf = (
  recording: Awaited<ReturnType<typeof makeRecordingWorkspaceDatabase>>
) => recording.statements.map(({ sql }) => sql);

describe("WorkspaceReservationRepository", () => {
  test("selects expired holds in a deterministic starvation-safe limited order", async () => {
    const { recording, repository } = await makeRepository();
    recording.setRows([[]]);

    const holds = await Effect.runPromise(
      repository.selectExpiredHolds({ now, limit: 5 })
    );

    expect(holds).toEqual([]);
    const sql = recording.statements[0].sql;
    const params = recording.statements[0].params;
    expect(params).toContain("held");
    expect(sql).toContain("\"payment_state\" <> 'paid'");
    expect(sql).toContain('"reservation_hold_expires_at" <= $');
    expect(sql).toContain("order by coalesce(");
    expect(sql.indexOf('"reservation_hold_expires_at" asc')).toBeGreaterThan(
      sql.indexOf("coalesce(")
    );
    expect(sql).toContain('"id" asc');
    expect(sql).toContain("limit $");
    expect(params).toContain(5);
  });

  test("records skipped cleanup attempts without changing reservation state", async () => {
    const { recording, repository } = await makeRepository();
    recording.setRows([[]]);

    const error = await Effect.runPromise(
      Effect.flip(
        repository.recordHoldCleanupSkipped({
          id: "reservation-1" as never,
          holdExpiredAt: now,
          failureCode: "provider_unavailable",
        })
      )
    );

    expect(error).toBeInstanceOf(WorkspaceReservationStateError);
    const { sql, params } = recording.statements[0];
    const setClause = sql.slice(0, sql.toLowerCase().indexOf(" where "));
    expect(setClause).toContain('"reservation_hold_expired_at" = $');
    expect(setClause).toContain('"failure_code" = $');
    expect(setClause).not.toContain('"reservation_state"');
    const whereClause = sql.slice(sql.toLowerCase().indexOf(" where "));
    expect(whereClause).toContain('"reservation_state" = $');
    expect(params).toContain("held");
    expect(whereClause).toContain("\"payment_state\" <> 'paid'");
    expect(whereClause).toContain('"reservation_hold_expires_at" <= $');
  });

  test("only claims paid fulfillment for a usable booking", async () => {
    const { recording, repository } = await makeRepository();
    recording.setRows([[]]);

    const claimed = await Effect.runPromise(
      repository.claimPaidFulfillment({
        id: "reservation-1" as never,
        staleProcessingBefore: staleBefore,
      })
    );

    expect(claimed).toBeNull();
    const { sql, params } = recording.statements[0];
    expect(sql).toContain('"fulfillment_state" = $');
    expect(params).toContain("processing");
    expect(params).toContain("paid");
    expect(params).toContain("held");
    expect(params).toContain("confirmed");
    expect(sql).toContain("not exists");
    expect(sql).toContain('from "late_payment_recoveries"');
    expect(sql).toContain('"late_payment_recoveries"."payment_attempt_id" = ');
    expect(sql).toContain('"late_payment_recoveries"."state" <> ');
    expect(params).toContain("recovered");
  });

  test("marks paid Nexi attempts as requiring a refund with admin cancellation fencing", async () => {
    const { recording, repository } = await makeRepository();
    const claimedAt = Temporal.Instant.from("2026-01-01T10:00:00.000Z");
    recording.setRows([[["reservation-1"]], []]);

    await Effect.runPromise(
      repository.markAdministrationCancelled({
        id: "reservation-1" as never,
        cancelledAt: now,
        claimedAt,
        failureCode: "operator_cancelled",
      })
    );

    const reservationUpdate = recording.statements.find(({ sql }) =>
      sql.startsWith('update "workspace_reservations"')
    );
    const attemptUpdate = recording.statements.find(({ sql }) =>
      sql.startsWith('update "payment_attempts"')
    );
    expect(reservationUpdate).toBeDefined();
    expect(attemptUpdate).toBeDefined();
    expect(reservationUpdate?.sql).toContain('"updated_at" = $');
    expect(reservationUpdate?.sql).toContain('"reservation_state" = $');
    expect(reservationUpdate?.params).toContain("cancelled");
    expect(reservationUpdate?.params).toContain("operator_cancelled");
    expect(
      (reservationUpdate?.params ?? []).some((param) =>
        String(param).startsWith("2026-01-01T10:00:00")
      )
    ).toBe(true);
    expect(attemptUpdate?.sql).toContain('"refund_state" = $');
    expect(attemptUpdate?.params).toContain("required");
    expect(attemptUpdate?.params).toContain("nexi");
    expect(attemptUpdate?.params).toContain("paid");
  });

  test("fences admin cancellation failure to the claimed reservation revision", async () => {
    const { recording, repository } = await makeRepository();
    const claimedAt = Temporal.Instant.from("2026-01-01T10:00:00.000Z");
    recording.setRows([[]]);

    const error = await Effect.runPromise(
      Effect.flip(
        repository.markAdministrationCancellationFailed({
          id: "reservation-1" as never,
          claimedAt,
          failureCode: "provider_rejected_cancellation",
        })
      )
    );

    expect(error).toBeInstanceOf(WorkspaceReservationStateError);
    const { sql, params } = recording.statements[0];
    expect(sql).toContain('"reservation_state" = $');
    expect(params).toContain("cancellation_failed");
    expect(params).toContain("provider_rejected_cancellation");
    expect(
      params.some((param) => String(param).startsWith("2026-01-01T10:00:00"))
    ).toBe(true);
  });

  test("does not claim an admin cancellation while payment is pending", async () => {
    const { recording, repository } = await makeRepository();
    recording.setRows([[], []]);

    const claimed = await Effect.runPromise(
      repository.claimAdministrationCancellation({
        id: "reservation-1" as never,
        providerCredentialRemoved: false,
        accessGrantUpdatedAt: null,
        staleCancellingBefore: staleBefore,
      })
    );

    expect(claimed).toBeNull();
    const guardSql =
      recording.statements.find(({ sql }) =>
        sql.startsWith('update "workspace_reservations"')
      )?.sql ?? "";
    expect(guardSql).toContain("\"payment_state\" <> 'pending'");
    expect(guardSql).toContain("\"fulfillment_state\" <> 'processing'");
    expect(guardSql).toContain("\"fulfillment_state\" <> 'awaiting_delivery'");
  });

  test("cancels the pending payment attempt inside a forced payment cancellation", async () => {
    const { recording, repository } = await makeRepository();
    recording.setRows([
      [], // access grant lookup
      [reservationRow()], // claimed reservation row
      [["attempt-1"]], // cancelled payment attempt
      [], // discount claim lookup for release
      [], // voucher claim lookup for release
    ]);

    await Effect.runPromise(
      repository.claimAdministrationCancellation({
        id: "reservation-1" as never,
        providerCredentialRemoved: true,
        accessGrantUpdatedAt: null,
        staleCancellingBefore: staleBefore,
        pendingPaymentCancellation: {
          paymentAttemptId: "attempt-1" as never,
          failureCode: "provider_abandoned",
        },
      })
    );

    const sqlTexts = sqlTextsOf(recording);
    const guardStatement = recording.statements.find(({ sql }) =>
      sql.startsWith('update "workspace_reservations"')
    );
    expect(guardStatement?.sql).toContain('"payment_state" = $');
    expect(guardStatement?.params).toContain("pending");
    expect(guardStatement?.params).toContain("attempt-1");
    expect(guardStatement?.params).toContain("provider_abandoned");
    const attemptUpdate = recording.statements.find(({ sql }) =>
      sql.startsWith('update "payment_attempts"')
    );
    expect(attemptUpdate?.sql).toContain('update "payment_attempts"');
    expect(attemptUpdate?.params).toContain("cancelled");
    expect(attemptUpdate?.params).toContain("provider_abandoned");
    expect(sqlTexts.some((sql) => sql.includes("pg_advisory"))).toBe(false);
  });

  test("expires a live access credential before cancelling", async () => {
    const { recording, repository } = await makeRepository();
    recording.setRows([
      [
        [
          "grant-1",
          "issued",
          "2099-01-01T00:00:00.000Z",
          "2026-01-01T09:59:00.000Z",
          "2026-01-01T09:59:00.000Z",
        ],
      ],
      [reservationRow()],
      [["attempt-1"]],
      [],
      [],
      [["grant-1"]],
    ]);

    await Effect.runPromise(
      repository.claimAdministrationCancellation({
        id: "reservation-1" as never,
        providerCredentialRemoved: true,
        accessGrantUpdatedAt: "2026-01-01T09:59:00Z",
        staleCancellingBefore: staleBefore,
        pendingPaymentCancellation: {
          paymentAttemptId: "attempt-1" as never,
          failureCode: "provider_abandoned",
        },
      })
    );

    const grantUpdate = recording.statements.find(({ sql }) =>
      sql.includes('update "reservation_access_grants"')
    );
    expect(grantUpdate).toBeDefined();
    expect(grantUpdate?.params).toContain("expired");
    expect(grantUpdate?.params).toContain(null);
  });

  test("recovers an email delivery failure only for a verified earlier provider delivery", async () => {
    const { recording, repository } = await makeRepository();
    recording.setRows([[]]);

    const recovered = await Effect.runPromise(
      repository.recoverEmailDeliveryFailure({
        id: "reservation-1" as never,
        deliveredAt: now,
      })
    );

    expect(recovered).toBeNull();
    const { sql, params } = recording.statements[0];
    expect(params).toContain("paid");
    expect(params).toContain("failed");
    expect(sql).toContain('"fulfillment_failed_at" is not null');
    expect(sql).toContain('"fulfillment_failed_at" < ');
    expect(sql).not.toContain("<=");
    expect(params).toContain("fulfilled");
    expect(sql).toContain("returning");
  });

  test("applies fulfillment delivery failures only over older recorded outcomes", async () => {
    const { recording, repository } = await makeRepository();
    recording.setRows([[]]);

    const failed = await Effect.runPromise(
      repository.markFulfillmentDeliveryFailed({
        id: "reservation-1" as never,
        failureCode: "fulfillment_email_failed",
        failedAt: now,
      })
    );

    expect(failed).toBeNull();
    const { sql, params } = recording.statements[0];
    expect(params).toContain("failed");
    expect(params).toContain("fulfillment_email_failed");
    expect(sql).toContain('"fulfilled_at" is not null');
    expect(sql).toContain('"fulfilled_at" < ');
    expect(sql).toContain('"fulfillment_failed_at" is not null');
    expect(sql).toContain('"fulfillment_failed_at" < ');
    expect(sql).not.toContain("<=");
  });

  test("keeps markFulfilled restricted to processing fulfillment", async () => {
    const { recording, repository } = await makeRepository();
    recording.setRows([[]]);

    const error = await Effect.runPromise(
      Effect.flip(
        repository.markFulfilled({
          id: "reservation-1" as never,
          fulfilledAt: now,
        })
      )
    );

    expect(error).toBeInstanceOf(WorkspaceReservationStateError);
    const { sql, params } = recording.statements[0];
    expect(sql).toContain('"fulfillment_state" = $');
    expect(params).toContain("processing");
    expect(params).not.toContain("failed");
    expect(sql).not.toContain('"fulfillment_failure_code"');
  });

  test("selects expired local Dotypos holds for availability filtering", async () => {
    const { recording, repository } = await makeRepository();
    recording.setRows([[["dotypos-1"]]]);

    const ids = await Effect.runPromise(
      repository.selectExpiredHoldDotyposReservationIds({ now })
    );

    expect(ids).toHaveLength(1);
    const { sql, params } = recording.statements[0];
    expect(sql).toContain('"dotypos_reservation_id"');
    expect(params).toContain("held");
    expect(params).toContain("not_started");
    expect(params).toContain("failed");
    expect(params).toContain("cancelled");
    expect(params).toContain("expired");
    expect(params).not.toContain("pending");
    expect(sql).toContain('"dotypos_reservation_id" is not null');
    expect(sql).toContain('"reservation_hold_expires_at" <= $');
  });
});
