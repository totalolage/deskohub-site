import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("keeps the atomic allocator isolated from exact-SHA test code", async () => {
  const workflow = await Bun.file(
    resolve(import.meta.dir, "../../../.github/workflows/workspace-e2e.yml")
  ).text();

  expect(workflow).not.toContain("  allocate-shard:");
  expect(workflow).toContain(
    "uses: ./.workspace-e2e-coordinator/.github/actions/workspace-e2e-allocation"
  );
  expect(workflow).not.toContain("group: workspace-e2e-shard-allocation");
  expect(workflow).toContain("inputs.allow_concurrent");
  expect(workflow).toContain("inputs.cleanup_stale_e2e_reservations");
  expect(workflow).toContain("!inputs.cleanup_stale_e2e_reservations");
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).not.toContain("contents: write");
  expect(workflow).toContain(
    `database-url: \${{ secrets.WORKSPACE_E2E_COORDINATOR_DATABASE_URL }}`
  );
  expect(workflow).toContain(`group: \${{ github.event_name ==`);
  expect(workflow).toContain("'workspace-e2e-dotypos-sandbox'");
  const testJob = workflow.slice(
    workflow.indexOf("  test-e2e:"),
    workflow.indexOf("  publish-final-status:")
  );
  expect(testJob).toContain("contents: read");
  expect(testJob).not.toContain("contents: write");
  expect(workflow).toContain("Validate aggregate Dotypos capacity");
  expect(workflow).toContain("Reconcile stale Workspace E2E reservations");
  expect(workflow).toContain("e2e:cleanup-stale --apply");
  expect(workflow).not.toContain("pulls?state=open");
});

test("holds the provider lock for the complete shard lease lifetime", async () => {
  const workflow = await Bun.file(
    resolve(import.meta.dir, "../../../.github/workflows/workspace-e2e.yml")
  ).text();
  const testJob = workflow.slice(
    workflow.indexOf("  test-e2e:"),
    workflow.indexOf("  publish-final-status:")
  );

  expect(testJob).toContain("concurrency:");
  const lockIndex = testJob.indexOf("concurrency:");
  const targetCheckoutIndex = testJob.indexOf("Checkout exact target");
  const coordinatorCheckoutIndex = testJob.indexOf(
    "Checkout allocation action"
  );
  const leaseIndex = testJob.indexOf("Lease an available date shard");
  const runIndex = testJob.indexOf("Run checkout E2E");
  const releaseIndex = testJob.indexOf("Release date shard");

  expect(lockIndex).toBeLessThan(targetCheckoutIndex);
  expect(targetCheckoutIndex).toBeLessThan(coordinatorCheckoutIndex);
  expect(coordinatorCheckoutIndex).toBeLessThan(leaseIndex);
  expect(leaseIndex).toBeLessThan(runIndex);
  expect(runIndex).toBeLessThan(releaseIndex);
});
