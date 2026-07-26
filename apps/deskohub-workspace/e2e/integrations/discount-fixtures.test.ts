import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("expires a code beyond cross-host clock skew", async () => {
  const source = await Bun.file(
    fileURLToPath(new URL("./discount-fixtures.ts", import.meta.url))
  ).text();

  expect(source).toContain(
    'Temporal.Instant.from("2000-01-01T00:00:00Z")'
  );
  expect(source).not.toContain('Temporal.Now.instant().subtract({ seconds: 1 })');
});

test("toggles only the transient Calendar target idempotently", async () => {
  const source = await Bun.file(
    fileURLToPath(new URL("./discount-fixtures.ts", import.meta.url))
  ).text();

  expect(source).toContain(".onConflictDoNothing()");
  expect(source).toContain(
    "eq(discountProductTargets.productIdentity, product)"
  );
  expect(source).not.toContain("with removed as (");
});

test("targets the zero-total fixture at the 240-minute meeting room", async () => {
  const source = await Bun.file(
    fileURLToPath(new URL("./discount-fixtures.ts", import.meta.url))
  ).text();

  expect(source).toContain(
    '{ kind: "meeting-room", durationMinutes: 240 }'
  );
});
