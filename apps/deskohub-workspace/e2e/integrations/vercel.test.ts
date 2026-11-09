import { describe, expect, test } from "bun:test";
import { decodeVercelDeployment } from "./vercel";

const payload = {
  id: "dpl_synthetic",
  meta: { githubCommitSha: "a".repeat(40) },
  ownerId: "team_synthetic",
  projectId: "prj_workspace",
  readyState: "READY",
  target: null,
};

describe("decodeVercelDeployment", () => {
  test("reads the deployment, its state, target, and commit", () => {
    expect(decodeVercelDeployment(payload, "prj_workspace")).toEqual({
      deployment: {
        githubCommitSha: "a".repeat(40),
        id: "dpl_synthetic",
        ownerId: "team_synthetic",
        projectId: "prj_workspace",
        readyState: "READY",
        target: null,
      },
      kind: "match",
    });
  });

  test("refuses another project's deployment", () => {
    expect(decodeVercelDeployment(payload, "prj_other")).toEqual({
      kind: "project-mismatch",
    });
  });

  test.each([
    ["no record", null],
    ["no id", { ...payload, id: "" }],
    ["no owner", { ...payload, ownerId: undefined }],
  ])("rejects %s", (_label, candidate) => {
    expect(decodeVercelDeployment(candidate, "prj_workspace")).toEqual({
      kind: "invalid",
    });
  });
});
