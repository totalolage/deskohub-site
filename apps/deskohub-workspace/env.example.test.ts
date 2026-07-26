import { expect, test } from "bun:test";

const checkoutRolloutNames = [
  "CHECKOUT_PAY_STATE_KEYS",
  "CHECKOUT_RESERVATION_HMAC_SECRET",
  "CHECKOUT_RESERVATION_HMAC_CUTOVER_AT",
  "CHECKOUT_RESERVATION_HMAC_LEGACY_READ_UNTIL",
] as const;

test("documents every checkout key rollout field exactly once", async () => {
  const example = await Bun.file(
    new URL("./.env.example", import.meta.url)
  ).text();
  const documentedNames = example
    .split(/\r?\n/)
    .flatMap((line) => line.match(/^([A-Z0-9_]+)=/)?.[1] ?? []);

  for (const name of checkoutRolloutNames) {
    expect(
      documentedNames.filter((candidate) => candidate === name)
    ).toHaveLength(1);
  }
});
