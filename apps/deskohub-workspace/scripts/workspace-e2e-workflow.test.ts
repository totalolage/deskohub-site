import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("discovers active shard leases independently of current PR heads", async () => {
  const workflow = await Bun.file(
    resolve(import.meta.dir, "../../../.github/workflows/workspace-e2e.yml")
  ).text();

  expect(workflow).toContain("commits/$lease_anchor_sha/statuses");
  expect(workflow).not.toContain("pulls?state=open");
});
