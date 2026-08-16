import { expect, test } from "bun:test";

test("enters request time before reading the active-sale clock", async () => {
  const source = await Bun.file(
    new URL("./active-public-sales.server.ts", import.meta.url)
  ).text();
  const connection = source.indexOf("await connection()");

  expect(connection).toBeGreaterThan(-1);
  expect(connection).toBeLessThan(source.indexOf("Clock.currentTimeMillis"));
});
