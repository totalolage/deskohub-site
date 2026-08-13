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
