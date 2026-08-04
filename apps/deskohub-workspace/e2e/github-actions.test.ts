import { expect, test } from "bun:test";
import { formatWorkspaceE2EFailureAnnotation } from "./github-actions";

test("formats only closed Workspace E2E failure fields", () => {
  expect(
    formatWorkspaceE2EFailureAnnotation({
      caseId: "checkout-meeting-room-paid-one-hour",
      failureKind: "timeout",
      outcome: "timed_out",
      stepId: "wait-for-provider-session-row",
    })
  ).toBe(
    "::error title=Workspace E2E case failed::case=checkout-meeting-room-paid-one-hour,step=wait-for-provider-session-row,outcome=timed_out,failure_kind=timeout\n"
  );
});

test("does not interpolate unexpected identifiers", () => {
  expect(
    formatWorkspaceE2EFailureAnnotation({
      caseId: "customer@example.com",
      failureKind: "error",
      outcome: "failed",
      stepId: "https://provider.invalid/reservation/123",
    })
  ).toBe(
    "::error title=Workspace E2E case failed::case=invalid,step=invalid,outcome=failed,failure_kind=error\n"
  );
});
