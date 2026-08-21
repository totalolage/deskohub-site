import { expect, test } from "bun:test";

test("hydrates a missing reservation order before generic payment dispatch", async () => {
  const source = await Bun.file(
    new URL("./order.repository.ts", import.meta.url)
  ).text();

  expect(source).toContain("db.transaction");
  expect(source).toContain("workspaceReservations");
  expect(source).toContain("ensureReservationOrder");
  expect(source).toContain('.for("update")');
});
