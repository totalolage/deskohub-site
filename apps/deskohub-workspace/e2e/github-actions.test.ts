import { expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { formatWorkspaceE2EFailureAnnotation } from "./github-actions";

test("formats a fixed code-owned diagnostic code", () => {
  expect(
    formatWorkspaceE2EFailureAnnotation({
      caseId: "checkout-calendar-sale",
      diagnosticCode: "nexi_webhook_fulfillment_failed",
      failureKind: "error",
      outcome: "failed",
      stepId: "replay-payment-webhook",
    })
  ).toBe(
    "::error title=Workspace E2E case failed::case=checkout-calendar-sale,step=replay-payment-webhook,diagnostic_code=nexi_webhook_fulfillment_failed,outcome=failed,failure_kind=error\n"
  );
});

test("does not interpolate unexpected identifiers", () => {
  expect(
    formatWorkspaceE2EFailureAnnotation({
      caseId: testEmailAddress("customer"),
      failureKind: "error",
      outcome: "failed",
      stepId: "https://provider.invalid/reservation/123",
    })
  ).toBe(
    "::error title=Workspace E2E case failed::case=invalid,step=invalid,outcome=failed,failure_kind=error\n"
  );
});

test("omits diagnostic codes outside the fixed code-owned allowlist", () => {
  expect(
    formatWorkspaceE2EFailureAnnotation({
      caseId: "checkout-calendar-sale",
      diagnosticCode: "provider-response-secret" as never,
      failureKind: "error",
      outcome: "failed",
    })
  ).toBe(
    "::error title=Workspace E2E case failed::case=checkout-calendar-sale,outcome=failed,failure_kind=error\n"
  );
});
