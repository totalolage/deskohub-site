import { expect, test } from "bun:test";

test("resolves active sales at request time outside the source cache", async () => {
  const source = await Bun.file(
    new URL("./active-public-sales.server.ts", import.meta.url)
  ).text();
  const connection = source.indexOf("await connection()");

  expect(connection).toBeGreaterThan(-1);
  expect(connection).toBeLessThan(source.indexOf("getCurrentWorkspaceDate()"));
  expect(source).not.toContain('"use cache"');
});
