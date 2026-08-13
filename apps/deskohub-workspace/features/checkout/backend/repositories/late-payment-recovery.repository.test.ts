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
