import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { countOccurrences } from "./shared/source-contract";

const provisioner = () =>
  readFileSync(
    new URL("workspace-e2e-coordination-provision.ts", import.meta.url)
      .pathname,
    "utf8"
  );

test("grants the runtime allocator only the pool access needed for row locking", () => {
  const source = provisioner();

  expect(
    countOccurrences(
      source,
      "grant select, update on workspace_e2e_coordination.allocation_pools"
    )
  ).toBe(1);
  expect(
    countOccurrences(
      source,
      "grant all on workspace_e2e_coordination.allocation_pools"
    )
  ).toBe(0);
});

test("grants the provider permit role only database connectivity", () => {
  const source = provisioner();
  const role = `\${providerPermitRole}`;

  // Connectivity only: no schema usage, no table or sequence privileges, and
  // no pool-row access that could bypass the allocator.
  expect(
    countOccurrences(
      source,
      `revoke all privileges on database \${database} from ${role}`
    )
  ).toBe(1);
  expect(
    countOccurrences(
      source,
      `revoke all on all tables in schema workspace_e2e_coordination from ${role}`
    )
  ).toBe(1);
  expect(
    countOccurrences(
      source,
      `revoke all on all sequences in schema workspace_e2e_coordination from ${role}`
    )
  ).toBe(1);
  expect(
    countOccurrences(
      source,
      `grant connect on database \${database} to ${role}`
    )
  ).toBe(1);
  expect(
    countOccurrences(
      source,
      `grant usage on schema workspace_e2e_coordination to ${role}`
    )
  ).toBe(0);
  expect(countOccurrences(source, `allocation_pools to ${role}`)).toBe(0);
  expect(countOccurrences(source, `allocation_requests to ${role}`)).toBe(0);
  expect(
    countOccurrences(source, "The provider permit role is not isolated.")
  ).toBe(1);

  // The isolation probe inspects role membership and superuser status.
  expect(countOccurrences(source, 'as "hasMemberships"')).toBe(1);
  expect(countOccurrences(source, 'role.rolsuper as "isSuperuser"')).toBe(1);
});
