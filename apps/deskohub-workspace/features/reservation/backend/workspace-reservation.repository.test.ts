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
      "selectCancellationCandidates: Effect.fn(",
      "selectExpiredHoldDotyposReservationIds: Effect.fn("
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
      "markPaymentPaid: Effect.fn("
    );

    expect(section).toContain("reservationHoldExpiredAt: sql`coalesce(");
    expect(section).toContain("clock_timestamp()");
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
      "const decodeOptionalWorkspaceReservation"
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
      "workspaceReservations.reservationHoldExpiresAt} <= clock_timestamp()"
    );
    expect(section).toContain("hasNoProviderEvidenceConflict()");
  });

  test("keeps provider-evidence-conflicted attempts out of automatic cancellation selectors", async () => {
    const source = await readRepository();
    const cancellationClaim = sliceFrom(
      source,
      "claimCancellation: Effect.fn(",
      "claimSupersessionCancellation: Effect.fn("
    );
    const cancellationCandidates = sliceFrom(
      source,
      "selectCancellationCandidates: Effect.fn(",
      "selectExpiredHoldDotyposReservationIds: Effect.fn("
    );
    const expiredHoldIds = sliceFrom(
      source,
      "selectExpiredHoldDotyposReservationIds: Effect.fn(",
      "const decodeOptionalWorkspaceReservation"
    );

    expect(source).toContain("const hasNoProviderEvidenceConflict = ()");
    expect(source).toContain("paymentAttempts.providerEvidenceConflicted");
    expect(cancellationClaim).toContain("hasNoProviderEvidenceConflict()");
    expect(cancellationCandidates).toContain("hasNoProviderEvidenceConflict()");
    expect(expiredHoldIds).toContain("hasNoProviderEvidenceConflict()");
  });
});
