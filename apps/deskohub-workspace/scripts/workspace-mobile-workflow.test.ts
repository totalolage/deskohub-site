import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("reuses a verified immutable APK when a production release is rerun", async () => {
  const workflow = await Bun.file(
    resolve(
      import.meta.dir,
      "../../../.github/workflows/workspace-mobile-production.yml"
    )
  ).text();
  const reuseStep = workflow.slice(
    workflow.indexOf("- name: Reuse immutable APK when available"),
    workflow.indexOf("- name: Build Android release")
  );
  const buildStep = workflow.slice(
    workflow.indexOf("- name: Build Android release"),
    workflow.indexOf("- name: Verify production identity")
  );
  const publishStep = workflow.slice(
    workflow.indexOf("- name: Publish immutable release"),
    workflow.indexOf("- name: Publish signed small update")
  );

  expect(reuseStep).toContain("id: reuse-release");
  expect(reuseStep).toContain("--pattern deskohub-workspace.apk");
  expect(reuseStep).toContain("--pattern deskohub-workspace.apk.sha256");
  expect(reuseStep).toContain("sha256sum --check");
  expect(buildStep).toContain(
    "if: steps.reuse-release.outputs.reused != 'true'"
  );
  expect(publishStep).not.toContain("cmp ");
  expect(publishStep).not.toContain("--clobber");
});
