import { expect, test } from "bun:test";

test("repairs reservation order facts without overwriting another order kind", async () => {
  const source = await Bun.file(
    new URL("./reservation-order.ts", import.meta.url)
  ).text();

  expect(source).toContain(".onConflictDoUpdate({");
  expect(source).toContain("target: orders.id");
  expect(source).toContain('setWhere: eq(orders.kind, "reservation")');
  expect(source).toContain('kind: "reservation"');
  expect(source).toContain(
    "activePaymentAttemptId: input.reservation.activePaymentAttemptId"
  );
  for (const field of [
    "correlationId",
    "dotyposCustomerId",
    "paymentState",
    "fulfillmentState",
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
