import { expect, test } from "bun:test";
import { resolve } from "node:path";

const readWorkflow = (name: string) =>
  Bun.file(
    resolve(import.meta.dir, `../../../.github/workflows/${name}`)
  ).text();

const pullRequestTrigger = (workflow: string) =>
  workflow.slice(
    workflow.indexOf("  pull_request:"),
    workflow.indexOf("concurrency:")
  );

test("runs Workspace and dhw CI for stacked pull requests", async () => {
  const [workspace, dhw] = await Promise.all([
    readWorkflow("workspace-tests.yml"),
    readWorkflow("dhw-ci.yml"),
  ]);

  expect(pullRequestTrigger(workspace)).not.toContain("branches:");
  expect(workspace).toContain("github.event.pull_request.base.sha");
  expect(pullRequestTrigger(dhw)).not.toContain("branches:");
  expect(pullRequestTrigger(dhw)).toContain("paths:");
  expect(dhw).toContain("!startsWith(github.head_ref");
});
