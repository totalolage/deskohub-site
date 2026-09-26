import { expect, test } from "bun:test";

test("mirrors reservation facts into the reservation-kind order upsert", async () => {
  const source = await Bun.file(
    new URL("./reservation-order.ts", import.meta.url)
  ).text();

  expect(source).toContain(".onConflictDoUpdate({");
  expect(source).toContain("target: orders.id");
  expect(source).toContain('setWhere: eq(orders.kind, "reservation")');
  expect(source).toContain('kind: "reservation" as const');
  expect(source).toContain("orderIdSchema.make(input.reservation.id)");
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
