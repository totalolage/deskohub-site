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
  test("selects expired holds in a deterministic starvation-safe limited order", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      'selectExpiredHolds: Effect.fn("workspaceReservations.selectExpiredHolds")',
      "        (effect, input) => effect.pipe(Effect.annotateLogs(input))"
    );

    expect(source).toContain("readonly limit: number");
    expect(section).toContain(
      'eq(workspaceReservations.reservationState, "held")'
    );
    expect(section).toContain("workspaceReservations.paymentState");
    expect(section).toContain("<> 'paid'");
    expect(section).toContain(".orderBy(");
    expect(section).toContain("coalesce(");
    expect(section).toContain("workspaceReservations.reservationHoldExpiredAt");
    expect(section).toContain(
      "asc(workspaceReservations.reservationHoldExpiresAt)"
    );
    expect(section).toContain("asc(workspaceReservations.id)");
    expect(section.indexOf(".orderBy(")).toBeLessThan(
      section.indexOf(".limit(input.limit)")
    );
  });

  test("records skipped cleanup attempts without changing reservation state", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      "recordHoldCleanupSkipped: Effect.fn(",
      "claimPaidFulfillment: Effect.fn("
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

  test("marks paid Nexi attempts as requiring a refund with admin cancellation", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      "markAdministrationCancelled: Effect.fn(",
      "completeSupersessionAndCreateDraft: Effect.fn("
    );

    expect(section).toContain("db.transaction");
    expect(section).toContain(".update(paymentAttempts)");
    expect(section).toContain('refundState: "required"');
    expect(section).toContain('eq(paymentAttempts.provider, "nexi")');
    expect(section).toContain('eq(paymentAttempts.state, "paid")');
  });

  test("fences admin cancellation completion to the active claim", async () => {
    const source = await readRepository();
    const completed = sliceFrom(
      source,
      "markAdministrationCancelled: Effect.fn(",
      "completeSupersessionAndCreateDraft: Effect.fn("
    );
    const failed = sliceFrom(
      source,
      "markAdministrationCancellationFailed: Effect.fn(",
      "recordHoldCleanupSkipped: Effect.fn("
    );

    expect(source).toContain("readonly claimedAt: Temporal.Instant");
    expect(completed).toContain(
      "eq(workspaceReservations.updatedAt, input.claimedAt)"
    );
    expect(failed).toContain(
      "eq(workspaceReservations.updatedAt, input.claimedAt)"
    );
  });

  test("does not claim an admin cancellation while payment is pending", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      "claimAdministrationCancellation: Effect.fn(",
      'markCancelled: Effect.fn("workspaceReservations.markCancelled")'
    );

    expect(section).toContain("workspaceReservations.paymentState");
    expect(section).toContain("<> 'pending'");
  });
});
