import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  readRemoteEvaluationPolicy,
  remoteEvaluationPolicyFor,
} from "./remote-evaluation-policy.server";

describe("remote evaluation policy", () => {
  test("allows remote evaluation only on the production deployment", () => {
    expect(remoteEvaluationPolicyFor("production")).toBe("allowed");
    expect(remoteEvaluationPolicyFor("preview")).toBe("disabled");
    expect(remoteEvaluationPolicyFor("development")).toBe("disabled");
  });

  test("disables remote evaluation when the deployment stage is missing", () => {
    expect(remoteEvaluationPolicyFor(undefined)).toBe("disabled");
  });

  test("disables remote evaluation for test runs", () => {
    expect(readRemoteEvaluationPolicy()).toBe("disabled");
  });
});
