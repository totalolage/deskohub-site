import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { countOccurrences } from "../../scripts/shared/source-contract";

const readFixtureSource = () =>
  readFileSync(
    fileURLToPath(new URL("./discount-fixtures.ts", import.meta.url)),
    "utf8"
  );

test("expires a code beyond cross-host clock skew", () => {
  const source = readFixtureSource();

  expect(
    countOccurrences(source, 'Temporal.Instant.from("2000-01-01T00:00:00Z")')
  ).toBe(1);
  expect(
    countOccurrences(source, "Temporal.Now.instant().subtract({ seconds: 1 })")
  ).toBe(0);
});

test("toggles only the transient Calendar target idempotently", () => {
  const source = readFixtureSource();

  expect(countOccurrences(source, ".onConflictDoNothing()")).toBeGreaterThan(0);
  expect(
    countOccurrences(
      source,
      "eq(discountProductTargets.productTarget, product)"
    )
  ).toBeGreaterThan(0);
  expect(countOccurrences(source, "with removed as (")).toBe(0);
});

test("targets the zero-total fixture at the meeting-room family", () => {
  const source = readFixtureSource();

  expect(countOccurrences(source, '{ kind: "meeting-room" }')).toBeGreaterThan(
    0
  );
});
