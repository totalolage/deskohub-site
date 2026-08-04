import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("keeps the atomic allocator isolated from exact-SHA test code", async () => {
  const workflow = await Bun.file(
    resolve(import.meta.dir, "../../../.github/workflows/workspace-e2e.yml")
  ).text();

  expect(workflow).toContain("allocate-shard:");
  expect(workflow).toContain(
    "uses: ./.workspace-e2e-coordinator/.github/actions/workspace-e2e-allocation"
  );
  expect(workflow).not.toContain("group: workspace-e2e-shard-allocation");
  expect(workflow).toContain("inputs.allow_concurrent");
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow.indexOf("contents: write")).toBeLessThan(
    workflow.indexOf("  test-e2e:")
  );
  const testJob = workflow.slice(
    workflow.indexOf("  test-e2e:"),
    workflow.indexOf("  publish-final-status:")
  );
  expect(testJob).toContain("contents: read");
  expect(testJob).not.toContain("contents: write");
  expect(workflow).toContain("Validate aggregate Dotypos capacity");
  expect(workflow).not.toContain("pulls?state=open");
});
