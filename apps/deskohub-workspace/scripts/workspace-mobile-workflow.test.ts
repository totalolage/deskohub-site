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
  const promotionGuardStep = workflow.slice(
    workflow.indexOf(
      "- name: Confirm this is the latest successful production deployment"
    ),
    workflow.indexOf("- name: Attest production APK provenance")
  );

  expect(reuseStep).toContain("id: reuse-release");
  expect(reuseStep).toContain("--pattern deskohub-workspace.apk");
  expect(reuseStep).toContain("--pattern deskohub-workspace.apk.sha256");
  expect(reuseStep).toContain("sha256sum --check");
  expect(workflow).toContain('git rev-list --count "$TARGET_SHA"');
  expect(reuseStep).toContain(
    `EXPECTED_VERSION_CODE: \${{ steps.version.outputs.code }}`
  );
  expect(reuseStep).toContain("versionCode='$EXPECTED_VERSION_CODE'");
  expect(buildStep).toContain(
    "if: steps.reuse-release.outputs.reused != 'true'"
  );
  expect(buildStep).toContain(
    `DW_ANDROID_VERSION_CODE: \${{ steps.version.outputs.code }}`
  );
  expect(workflow).not.toContain(
    `DW_ANDROID_VERSION_CODE: \${{ github.event.workflow_run.run_number }}`
  );
  expect(publishStep).not.toContain("cmp ");
  expect(publishStep).not.toContain("--clobber");
  expect(workflow).toContain("actions: read");
  expect(promotionGuardStep).toContain(
    "actions/workflows/deploy-workspace-production.yml/runs"
  );
  expect(promotionGuardStep).toContain("max_by(.run_number)");
  expect(promotionGuardStep).toContain("github.event.workflow_run.id");
  expect(
    workflow.indexOf("latest successful production deployment")
  ).toBeLessThan(workflow.indexOf("Publish signed small update"));
});
