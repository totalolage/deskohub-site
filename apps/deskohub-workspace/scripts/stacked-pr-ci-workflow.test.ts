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
  expect(workspace).toContain(
    "ghcr.io/fboulnois/pg_uuidv7@sha256:bc82ea4d74252366e41f5ec537bdf80b47eb3ec27027877438e8fd6a5a8a4433"
  );
  expect(pullRequestTrigger(dhw)).not.toContain("branches:");
  expect(pullRequestTrigger(dhw)).toContain("paths:");
  expect(dhw).toContain("!startsWith(github.head_ref");
});
