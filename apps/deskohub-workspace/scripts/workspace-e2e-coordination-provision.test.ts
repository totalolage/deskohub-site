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

test("grants the provider permit role only database connectivity", async () => {
  const provisioner = await Bun.file(
    new URL("workspace-e2e-coordination-provision.ts", import.meta.url)
  ).text();

  expect(provisioner).toContain(
    `revoke all privileges on database \${database} from \${providerPermitRole}`
  );
  expect(provisioner).toContain(
    `revoke all on all tables in schema workspace_e2e_coordination from \${providerPermitRole}`
  );
  expect(provisioner).toContain(
    `revoke all on all sequences in schema workspace_e2e_coordination from \${providerPermitRole}`
  );
  expect(provisioner).toContain(
    `grant connect on database \${database} to \${providerPermitRole}`
  );
  expect(provisioner).not.toContain(
    `grant usage on schema workspace_e2e_coordination to \${providerPermitRole}`
  );
  expect(provisioner).not.toContain(
    `allocation_pools to \${providerPermitRole}`
  );
  expect(provisioner).not.toContain(
    `allocation_requests to \${providerPermitRole}`
  );
  expect(provisioner).not.toContain(
    `grant select, update on workspace_e2e_coordination.allocation_pools to \${providerPermitRole}`
  );
  expect(provisioner).toContain("The provider permit role is not isolated.");
  expect(provisioner).toContain('as "hasMemberships"');
  expect(provisioner).toContain('role.rolsuper as "isSuperuser"');
});
