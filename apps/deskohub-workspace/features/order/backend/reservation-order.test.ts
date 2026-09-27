import { expect, test } from "bun:test";

test("mirrors reservation facts into the reservation-kind order upsert", async () => {
  const source = await Bun.file(
    new URL("./reservation-order.ts", import.meta.url)
  ).text();
  const mirror = source.slice(
    source.indexOf("export const ensureReservationOrder")
  );

  expect(source).toContain(".onConflictDoUpdate({");
  expect(source).toContain("target: orders.id");
  expect(source).toContain('setWhere: eq(orders.kind, "reservation")');
  expect(source).toContain('kind: "reservation" as const');
  expect(source).toContain("orderIdSchema.make(input.reservation.id)");
  // Lock-order contract: the mirror is reservation → order only. It must
  // never touch payment_attempts (attempt relink belongs to the
  // attempt-first payment writers), or reservation-first callers would
  // invert the rolling-deploy lock order.
  expect(mirror).not.toContain("paymentAttempts");
  expect(mirror).not.toContain("isNull");
  for (const field of [
    "correlationId",
    "dotyposCustomerId",
    "paymentState",
    "fulfillmentState",
    "activePaymentAttemptId",
    "paidAt",
    "fulfilledAt",
    "fulfillmentFailedAt",
    "fulfillmentFailureCode",
    "createdAt",
    "updatedAt",
  ]) {
    expect(source).toContain(`${field}: input.reservation.${field}`);
  }
});
