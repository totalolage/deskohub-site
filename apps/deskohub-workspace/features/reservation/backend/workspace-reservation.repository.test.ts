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
  test("locks and repairs the reservation order before fulfillment state branches", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      "const findByIdForFulfillment = Effect.fn(",
      "      return {"
    );

    expect(section).toContain("db.transaction((tx)");
    expect(section).toContain('.for("update")');
    expect(section).toContain(
      "yield* ensureReservationOrder({ tx, reservation: row })"
    );
    expect(section.indexOf('.for("update")')).toBeLessThan(
      section.indexOf("ensureReservationOrder")
    );
  });

  test("creates or repairs a generic order for every draft return path", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      'createDraft: Effect.fn("workspaceReservations.createDraft")',
      "        findById,"
    );

    expect(section).toContain("db.transaction((tx)");
    expect(section.match(/ensureReservationOrder\(\{/g)).toHaveLength(3);
    expect(section.match(/\.for\("update"\)/g)).toHaveLength(2);
    expect(section).toContain("reservation: inserted");
    expect(section).toContain("reservation: existingAttempt");
    expect(section).toContain("reservation: currentAttempt");
  });

  test("creates the replacement reservation and order in one transaction", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      "completeSupersessionAndCreateDraft: Effect.fn(",
      "markCancellationFailed: Effect.fn("
    );

    expect(section).toContain("db.transaction((tx)");
    expect(section).toContain(".insert(workspaceReservations)");
    expect(section).toContain(
      "yield* ensureReservationOrder({ tx, reservation: replacement })"
    );
  });

  test("mirrors every fulfillment transition inside its transaction", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      "claimPaidFulfillment: Effect.fn(",
      "markReservationConfirmed: Effect.fn("
    );

    expect(section.match(/db\.transaction\(\(tx\)/g)).toHaveLength(4);
    expect(section.match(/ensureReservationOrder\(\{/g)).toHaveLength(4);
    expect(section).toContain('fulfillmentState: "processing"');
    expect(section).toContain('fulfillmentState: "fulfilled"');
    expect(section).toContain('fulfillmentState: "failed"');
    expect(section).toContain("fulfilledAt: null");
  });

  test("selects expired holds in a deterministic starvation-safe limited order", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      "selectExpiredHolds: Effect.fn(",
      "(effect, input) => effect.pipe(Effect.annotateLogs(input))"
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

  test("only claims paid fulfillment for a usable booking", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      "claimPaidFulfillment: Effect.fn(",
      "markFulfilled: Effect.fn("
    );

    expect(section).toContain("inArray(workspaceReservations.reservationState");
    expect(section).toContain('"held"');
    expect(section).toContain('"confirmed"');
    expect(section).toContain("notExists(");
    expect(section).toContain("latePaymentRecoveries.paymentAttemptId");
    expect(section).toContain("workspaceReservations.activePaymentAttemptId");
    expect(section).toContain('ne(latePaymentRecoveries.state, "recovered")');
  });

  test("selects expired local Dotypos holds for availability filtering", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      "selectExpiredHoldDotyposReservationIds: Effect.fn(",
      "} satisfies IWorkspaceReservationRepository"
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

  test("does not cancel while a live access credential remains", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      "claimAdministrationCancellation: Effect.fn(",
      'markCancelled: Effect.fn("workspaceReservations.markCancelled")'
    );

    expect(section).toContain("db.transaction");
    expect(section).toContain("reservationAccessGrants");
    expect(section).toContain("input.providerCredentialRemoved");
    expect(section).toContain("input.accessGrantUpdatedAt");
    expect(section).toContain('state: "expired"');
    expect(section).toContain("accessCode: null");
    expect(section).toContain(
      "reservationAccessProvisioningStaleAfterMilliseconds"
    );
  });
});
