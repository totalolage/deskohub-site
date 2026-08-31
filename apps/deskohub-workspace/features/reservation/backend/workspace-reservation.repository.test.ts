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

  test("claims a forced payment cancellation in the reservation transaction", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      "claimAdministrationCancellation: Effect.fn(",
      'markCancelled: Effect.fn("workspaceReservations.markCancelled")'
    );

    expect(section).toContain("input.pendingPaymentCancellation");
    expect(section).toContain(".update(paymentAttempts)");
    expect(section).toContain("releaseCodeClaim(");
  });

  test("recovers an email delivery failure only for a verified earlier provider delivery", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      "recoverEmailDeliveryFailure: Effect.fn(",
      "markReservationConfirmed: Effect.fn("
    );

    expect(source).toContain("readonly recoverEmailDeliveryFailure: (input: {");
    expect(source).toContain("readonly deliveredAt: Temporal.Instant");
    expect(section).toContain('eq(workspaceReservations.paymentState, "paid")');
    expect(section).toContain(
      'eq(workspaceReservations.fulfillmentState, "failed")'
    );
    expect(section).toContain("workspaceReservations.fulfillmentFailureCode");
    expect(section).toContain('"fulfillment_email_failed"');
    expect(section).toContain(
      "workspaceReservations.fulfillmentFailedAt} is not null"
    );
    expect(section).toContain(
      "lt(workspaceReservations.fulfillmentFailedAt, input.deliveredAt)"
    );
    expect(section).not.toContain("lte(workspaceReservations");
    expect(section).toContain('fulfillmentState: "fulfilled"');
    expect(section).toContain("fulfilledAt: input.deliveredAt");
    expect(section).toContain("fulfillmentFailedAt: null");
    expect(section).toContain("fulfillmentFailureCode: null");
    expect(section).toContain("updatedAt: Temporal.Now.instant()");
    expect(section).toContain(".returning()");
    expect(section).toContain("decodeOptionalWorkspaceReservation");
    expect(section).not.toContain("ensureUpdated");
  });

  test("applies email delivery failures atomically in provider event order", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      "markFulfillmentDeliveryFailed: Effect.fn(",
      "recoverEmailDeliveryFailure: Effect.fn("
    );
    const signature = sliceFrom(
      source,
      "readonly markFulfillmentDeliveryFailed: (input: {",
      "readonly recoverEmailDeliveryFailure: (input: {"
    );

    expect(signature).toContain("WorkspaceReservation | null");
    expect(section).toContain('eq(workspaceReservations.paymentState, "paid")');
    expect(section).toContain('fulfillmentState: "failed"');
    expect(section).toContain("fulfilledAt: null");
    expect(section).toContain("fulfillmentFailedAt: input.failedAt");
    expect(section).toContain("fulfillmentFailureCode: input.failureCode");
    expect(section).toContain(
      'eq(workspaceReservations.fulfillmentState, "processing")'
    );
    expect(section).toContain(
      'eq(workspaceReservations.fulfillmentState, "fulfilled")'
    );
    expect(section).toContain(
      "lt(workspaceReservations.fulfilledAt, input.failedAt)"
    );
    expect(section).toContain(
      'eq(workspaceReservations.fulfillmentState, "failed")'
    );
    expect(section).toContain("workspaceReservations.fulfillmentFailureCode");
    expect(section).toContain("input.failureCode");
    expect(section).toContain(
      "lt(workspaceReservations.fulfillmentFailedAt, input.failedAt)"
    );
    expect(section).not.toContain("lte(workspaceReservations");
    expect(section).toContain(".returning()");
    expect(section).toContain("decodeOptionalWorkspaceReservation");
    expect(section).not.toContain("ensureUpdated");
  });

  test("keeps markFulfilled restricted to processing fulfillment", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      'markFulfilled: Effect.fn("workspaceReservations.markFulfilled")',
      "markFulfillmentFailed: Effect.fn("
    );

    expect(section).toContain(
      'eq(workspaceReservations.fulfillmentState, "processing")'
    );
    expect(section).not.toContain('"failed"');
    expect(section).not.toContain("fulfillmentFailureCode");
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
