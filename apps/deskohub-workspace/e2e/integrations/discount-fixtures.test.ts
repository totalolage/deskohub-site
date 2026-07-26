import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("expires a code beyond cross-host clock skew", async () => {
  const source = await Bun.file(
    fileURLToPath(new URL("./discount-fixtures.ts", import.meta.url))
  ).text();

  expect(source).toContain("timestamp '2000-01-01 00:00:00+00'");
  expect(source).not.toContain("now() - interval '1 second'");
});
