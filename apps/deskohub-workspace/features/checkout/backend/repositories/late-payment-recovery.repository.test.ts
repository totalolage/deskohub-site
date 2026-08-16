import { expect, test } from "bun:test";

test("allows a replacement to settle after the original reservation was cancelled", async () => {
  const source = await Bun.file(
    new URL("./late-payment-recovery.repository.ts", import.meta.url)
  ).text();
  const originalRecoveryGuard = source.slice(
    source.indexOf("if (\n                input.reservationState"),
    source.indexOf("if (\n                input.recoveredDotyposReservationId")
  );

  expect(originalRecoveryGuard).toContain(
    "!input.recoveredDotyposReservationId &&"
  );
});

test("only treats later checkout-session reservations as superseding", async () => {
  const source = await Bun.file(
    new URL("./late-payment-recovery.repository.ts", import.meta.url)
  ).text();

  expect(
    source.match(
      /gt\(\s*workspaceReservations\.createdAt,\s*reservation\.createdAt\s*\)/g
    )
  ).toHaveLength(2);
});

test("rechecks supersession when settling with the original reservation", async () => {
  const source = await Bun.file(
    new URL("./late-payment-recovery.repository.ts", import.meta.url)
  ).text();

  expect(source).not.toContain(
    "if (input.recoveredDotyposReservationId) {\n                const [newer]"
  );
});

test("allows refund settlement for a superseded late payment", async () => {
  const source = await Bun.file(
    new URL("./late-payment-recovery.repository.ts", import.meta.url)
  ).text();

  expect(source).toContain(
    'if (input.state === "recovered") {\n                const [newer]'
  );
});

test("marks the settled payment attempt as requiring a refund", async () => {
  const source = await Bun.file(
    new URL("./late-payment-recovery.repository.ts", import.meta.url)
  ).text();

  expect(source).toMatch(
    /input\.state === "refund_required" && \{\s+refundState: "required"/
  );
});

test("records an older attempt refund without replacing the active attempt", async () => {
  const source = await Bun.file(
    new URL("./late-payment-recovery.repository.ts", import.meta.url)
  ).text();
  const start = source.slice(source.indexOf("start: Effect.fn"));

  expect(start).not.toContain(
    "workspaceReservations.activePaymentAttemptId,\n                        input.paymentAttemptId"
  );
  expect(source).toContain(
    '!isActiveAttempt && input.state !== "refund_required"'
  );
  expect(source).toContain("if (isActiveAttempt) {");
});

test("redeems the attempt's discount claim in recovered settlements", async () => {
  const source = await Bun.file(
    new URL("./late-payment-recovery.repository.ts", import.meta.url)
  ).text();

  expect(source).toContain("yield* redeemCodeClaim(");
});

test("repairs release-skew attempts before recovery starts or settles idempotently", async () => {
  const source = await Bun.file(
    new URL("./late-payment-recovery.repository.ts", import.meta.url)
  ).text();
  const helper = source.slice(
    source.indexOf("const lockAndRepairReservationPaymentAttempt"),
    source.length
  );
  const settle = source.slice(
    source.indexOf(
      'const settle = Effect.fn("LatePaymentRecoveryRepository.settle")'
    ),
    source.indexOf("      return {\n        findByPaymentAttemptId")
  );
  const existingStart = source.slice(
    source.indexOf("if (existing) {"),
    source.indexOf(
      "                const [reservation]",
      source.indexOf("                  return existing;")
    )
  );

  expect(helper).toContain("isNull(paymentAttempts.orderId)");
  expect(helper).toContain(".set({ orderId })");
  expect(settle.indexOf("lockAndRepairReservationPaymentAttempt")).toBeLessThan(
    settle.indexOf("if (recovery.state === input.state) return")
  );
  expect(existingStart).toContain("lockAndRepairReservationPaymentAttempt");
  expect(existingStart).toContain("return existing");
});
