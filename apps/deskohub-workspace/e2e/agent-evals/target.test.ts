import { describe, expect, test } from "bun:test";
import { assessAgentEvalDeployment } from "./target";

const expectation = { sha: "a".repeat(40) };
const preview = {
  githubCommitSha: "a".repeat(40),
  readyState: "READY",
  target: null,
};

describe("assessAgentEvalDeployment", () => {
  test("accepts a ready preview built from the pinned commit", () => {
    expect(assessAgentEvalDeployment(preview, expectation)).toEqual({
      kind: "preview",
    });
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
      "a record without a target",
      { ...preview, target: undefined },
      "not a preview",
    ],
    [
      "a deployment still building",
      { ...preview, readyState: "BUILDING" },
      "not ready",
    ],
    [
      "a preview of another commit",
      { ...preview, githubCommitSha: "b".repeat(40) },
      "TARGET_SHA",
    ],
    [
      "a preview without a commit",
      { ...preview, githubCommitSha: undefined },
      "TARGET_SHA",
    ],
  ])("refuses %s", (_label, deployment, reason) => {
    const assessment = assessAgentEvalDeployment(deployment, expectation);
    expect(assessment.kind).toBe("refused");
    expect(assessment.kind === "refused" && assessment.reason).toContain(
      reason
    );
  });
});
