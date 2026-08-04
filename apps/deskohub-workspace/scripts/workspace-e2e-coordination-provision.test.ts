import { expect, test } from "bun:test";

test("grants the runtime allocator only the pool access needed for row locking", async () => {
  const provisioner = await Bun.file(
    new URL("workspace-e2e-coordination-provision.ts", import.meta.url)
  ).text();

  expect(provisioner).toContain(
    "grant select, update on workspace_e2e_coordination.allocation_pools"
  );
  expect(provisioner).not.toContain(
    "grant all on workspace_e2e_coordination.allocation_pools"
  );
});
