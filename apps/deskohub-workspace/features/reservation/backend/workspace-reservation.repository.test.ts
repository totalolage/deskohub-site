import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";

const readRepository = () =>
  Bun.file(
    new URL("./workspace-reservation.repository.ts", import.meta.url)
  ).text();

const sliceFrom = (source: string, startNeedle: string, endNeedle: string) => {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe("WorkspaceReservationRepository", () => {
  test("selects expired, failed, and stale cancellation recovery in deterministic order", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      'selectCancellationCandidates: Effect.fn(\n        "workspaceReservations.selectCancellationCandidates"',
      "        (effect, input) => effect.pipe(Effect.annotateLogs(input))"
    );

    expect(source).toContain("readonly limit: number");
    expect(source).toContain("readonly staleClaimBefore: Temporal.Instant");
    expect(section).toContain(
      'eq(workspaceReservations.reservationState, "held")'
    );
    expect(section).toContain('"cancellation_failed"');
    expect(section).toContain('"cancelling"');
    expect(section).toContain("workspaceReservations.cancellationClaimedAt");
    expect(section).toContain("input.staleClaimBefore");
    expect(section).toContain("workspaceReservations.paymentState");
    expect(section).toContain("<> 'paid'");
    expect(section).toContain(".orderBy(");
    expect(section).toContain("coalesce(");
    expect(section).toContain("workspaceReservations.cancellationClaimedAt");
    expect(section).toContain("workspaceReservations.reservationHoldExpiredAt");
    expect(section).toContain(
      "asc(workspaceReservations.reservationHoldExpiresAt)"
    );
    expect(section).toContain("asc(workspaceReservations.id)");
    expect(section.indexOf(".orderBy(")).toBeLessThan(
      section.indexOf(".limit(input.limit)")
    );
  });

  test("claims cancellation with an explicit owner and only takes over a bounded stale lease", async () => {
    const source = await readRepository();
    const claim = sliceFrom(
      source,
      'claimCancellation: Effect.fn("workspaceReservations.claimCancellation")',
      "      claimSupersessionCancellation: Effect.fn("
    );

    expect(claim).toContain("cancellationClaimOwner: input.ownerId");
    expect(claim).toContain("cancellationClaimedAt: input.claimedAt");
    expect(claim).toContain(
      'eq(workspaceReservations.reservationState, "cancelling")'
    );
    expect(claim).toContain(
      "lte(\n                      workspaceReservations.cancellationClaimedAt,\n                      input.staleClaimBefore"
    );
    expect(claim).toContain('"not_started"');
    expect(claim).toContain('"failed"');
    expect(claim).toContain('"cancelled"');
    expect(claim).toContain('"expired"');
    expect(claim).not.toContain('"pending"');
  });

  test("renews, reloads, and transitions cancellations with owner CAS guards", async () => {
    const source = await readRepository();
    const owned = sliceFrom(
      source,
      "renewCancellationClaim: Effect.fn(",
      'markCancelled: Effect.fn("workspaceReservations.markCancelled")'
    );
    const transitions = sliceFrom(
      source,
      'markCancelled: Effect.fn("workspaceReservations.markCancelled")',
      "      recordHoldCleanupSkipped: Effect.fn("
    );

    expect(owned).toContain(
      "eq(workspaceReservations.cancellationClaimOwner, input.ownerId)"
    );
    expect(owned).toContain("cancellationClaimedAt: input.claimedAt");
    expect(owned).toContain(".returning()");
    expect(
      transitions.match(/cancellationClaimOwner/g)?.length
    ).toBeGreaterThan(4);
    expect(transitions).toContain("input.cancellationOwnerId");
    expect(transitions).toContain("cancellationClaimOwner: null");
    expect(transitions).toContain("cancellationClaimedAt: null");
  });

  test("schema and migration enforce paired ownership and recover pre-lease cancelling rows", async () => {
    const schema = await Bun.file(
      new URL("../../../db/schema/workspace-reservations.ts", import.meta.url)
    ).text();
    const migration = await Bun.file(
      new URL(
        "../../../db/migrations/20260723110632_real_cobalt_man/migration.sql",
        import.meta.url
      )
    ).text();

    expect(schema).toContain("workspace_reservations_cancellation_claim_check");
    expect(schema).toContain(
      "workspace_reservations_cancellation_recovery_idx"
    );
    expect(migration).toContain(
      "\"reservation_state\" = 'cancellation_failed'"
    );
    expect(migration).toContain("WHERE \"reservation_state\" = 'cancelling'");
    expect(migration.indexOf("UPDATE")).toBeLessThan(
      migration.indexOf(
        'ADD CONSTRAINT "workspace_reservations_cancellation_claim_check"'
      )
    );
  });

  test("records skipped cleanup attempts without changing reservation state", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      "recordHoldCleanupSkipped: Effect.fn(",
      'markPaymentPaid: Effect.fn("workspaceReservations.markPaymentPaid")'
    );

    expect(section).toContain("reservationHoldExpiredAt: input.holdExpiredAt");
    expect(section).toContain("failureCode: input.failureCode");
    expect(section).toContain(
      'eq(workspaceReservations.reservationState, "held")'
    );
    expect(section).toContain("workspaceReservations.paymentState");
    expect(section).toContain("<> 'paid'");
    expect(section).not.toContain("reservationState:");
  });

  test("selects expired local Dotypos holds for availability filtering", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      "selectExpiredHoldDotyposReservationIds: Effect.fn(",
      "      }),\n    });"
    );

    expect(section).toContain("dotyposReservationId");
    expect(section).toContain(
      'eq(workspaceReservations.reservationState, "held")'
    );
    expect(section).toContain("inArray(workspaceReservations.paymentState");
    expect(section).toContain('"not_started"');
    expect(section).toContain('"failed"');
    expect(section).toContain('"cancelled"');
    expect(section).toContain('"expired"');
    expect(section).not.toContain('"pending"');
    expect(section).toContain("dotyposReservationId} is not null");
    expect(section).toContain(
      "lte(workspaceReservations.reservationHoldExpiresAt, input.now)"
    );
  });
});
