import { expect, test } from "bun:test";

test("reads the active-sale clock inside a cache boundary", async () => {
  const source = await Bun.file(
    new URL("./active-public-sales.server.ts", import.meta.url)
  ).text();
  const cacheBoundary = source.indexOf('"use cache"');

  expect(cacheBoundary).toBeGreaterThan(-1);
  expect(cacheBoundary).toBeLessThan(source.indexOf("Date.now()"));
  expect(source).not.toContain("await connection()");
});
