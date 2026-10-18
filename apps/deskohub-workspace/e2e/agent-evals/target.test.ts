import { describe, expect, test } from "bun:test";
import { assessAgentEvalDeployment } from "./target";

const expectation = { sha: "a".repeat(40), vercelProjectId: "prj_workspace" };
const preview = {
  meta: { githubCommitSha: "a".repeat(40) },
  projectId: "prj_workspace",
  readyState: "READY",
  target: null,
};

describe("assessAgentEvalDeployment", () => {
  test("accepts a ready Workspace preview built from the pinned commit", () => {
    expect(assessAgentEvalDeployment(preview, expectation)).toEqual({
      kind: "preview",
    });
    expect(
      assessAgentEvalDeployment(preview, { vercelProjectId: "prj_workspace" })
    ).toEqual({ kind: "preview" });
  });

  test.each([
    [
      "a production deployment",
      { ...preview, target: "production" },
      "production",
    ],
    [
      "a custom environment",
      { ...preview, target: "staging" },
      "not a preview",
    ],
    [
      "another project",
      { ...preview, projectId: "prj_other" },
      "another Vercel project",
    ],
    [
      "a deployment still building",
      { ...preview, readyState: "BUILDING" },
      "not ready",
    ],
    [
      "a preview of another commit",
      { ...preview, meta: { githubCommitSha: "b".repeat(40) } },
      "TARGET_SHA",
    ],
    ["a missing record", null, "no deployment record"],
  ])("refuses %s", (_label, payload, reason) => {
    const assessment = assessAgentEvalDeployment(payload, expectation);
    expect(assessment.kind).toBe("refused");
    expect(assessment.kind === "refused" && assessment.reason).toContain(
      reason
    );
  });
});
