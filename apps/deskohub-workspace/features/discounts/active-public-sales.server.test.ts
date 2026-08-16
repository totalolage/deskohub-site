import { expect, test } from "bun:test";

test("resolves active sales inside a cache boundary without retaining failures", async () => {
  const source = await Bun.file(
    new URL("./active-public-sales.server.ts", import.meta.url)
  ).text();
  const cacheBoundary = source.indexOf('"use cache"');

  expect(cacheBoundary).toBeGreaterThan(-1);
  expect(cacheBoundary).toBeLessThan(
    source.indexOf("getCurrentWorkspaceDate()")
  );
  expect(source).toContain('cacheLife("publicContent")');
  expect(source).toContain("cacheLife({ expire: 0 })");
  expect(source).not.toContain("await connection()");
});
