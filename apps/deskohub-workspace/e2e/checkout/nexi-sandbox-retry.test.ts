import { expect, test } from "bun:test";
import {
  type NexiHostedPaymentDiagnosticCode,
  workspaceE2EError,
  workspaceE2ETimeoutError,
} from "../errors";
import {
  classifyNexiSandboxRejection,
  decideNexiSandboxRetry,
} from "./nexi-sandbox-retry";

const hostedPaymentError = (diagnosticCode: NexiHostedPaymentDiagnosticCode) =>
  workspaceE2EError("Nexi hosted payment failed", {
    diagnosticCode,
    operation: "Nexi control",
  });

const decide = (
  diagnosticCode: NexiHostedPaymentDiagnosticCode,
  {
    authorizationRequested = false,
  }: { readonly authorizationRequested?: boolean } = {}
) =>
  decideNexiSandboxRetry({
    authorizationRequested,
    error: hostedPaymentError(diagnosticCode),
  });

test("classifies only terminal Nexi pages as sandbox rejections", () => {
  expect(
    classifyNexiSandboxRejection(
      hostedPaymentError("nexi_hosted_continue_card_submission_rejected")
    )
  ).toEqual({
    diagnosticCode: "nexi_hosted_continue_card_submission_rejected",
    state: "card_submission_rejected",
    step: "continue",
  });
  for (const diagnosticCode of [
    "nexi_hosted_card_entry_provider_error_page",
    "nexi_hosted_pay_provider_failure_page",
  ] as const)
    expect(
      classifyNexiSandboxRejection(hostedPaymentError(diagnosticCode))
    ).toMatchObject({ diagnosticCode });

  for (const diagnosticCode of [
    "nexi_hosted_continue_provider_server_error",
    "nexi_hosted_pay_pay_disabled",
    "nexi_hosted_card_entry_snapshot_unavailable",
    "nexi_hosted_continue_unknown",
  ] as const)
    expect(
      classifyNexiSandboxRejection(hostedPaymentError(diagnosticCode))
    ).toBeUndefined();
});

test("never classifies timeouts, app assertions, or uncoded failures", () => {
  expect(
    classifyNexiSandboxRejection(
      workspaceE2ETimeoutError("Nexi continue timed out", {
        diagnosticCode: "nexi_hosted_continue_card_submission_rejected",
      })
    )
  ).toBeUndefined();
  expect(
    classifyNexiSandboxRejection(
      workspaceE2EError("wrapped", {
        cause: workspaceE2ETimeoutError("inner timeout"),
        diagnosticCode: "nexi_hosted_continue_provider_error_page",
      })
    )
  ).toBeUndefined();
  expect(
    classifyNexiSandboxRejection(
      workspaceE2EError("checkout row assertion failed", {
        diagnosticCode: "postgres_checkout_row_assertion_failed",
      })
    )
  ).toBeUndefined();
  expect(
    classifyNexiSandboxRejection(workspaceE2EError("no code"))
  ).toBeUndefined();
});

test("retries the card-data save rejection Nexi answers with HTTP 400", () => {
  expect(decide("nexi_hosted_continue_card_submission_rejected")).toMatchObject(
    { retry: true }
  );
  expect(decide("nexi_hosted_card_entry_provider_error_page")).toMatchObject({
    retry: true,
  });
});

test("retries a Pay-step rejection only before Pay asked Nexi to authorize", () => {
  expect(decide("nexi_hosted_pay_provider_error_page")).toMatchObject({
    retry: true,
  });
  for (const diagnosticCode of [
    "nexi_hosted_pay_provider_error_page",
    "nexi_hosted_pay_provider_failure_page",
  ] as const)
    expect(decide(diagnosticCode, { authorizationRequested: true })).toEqual({
      reason: "Nexi may have authorized the payment",
      retry: false,
    });
});

test("never retries the 3-D Secure challenge or the return to the shop", () => {
  for (const diagnosticCode of [
    "nexi_hosted_challenge_provider_error_page",
    "nexi_hosted_return_provider_failure_page",
  ] as const)
    expect(decide(diagnosticCode)).toMatchObject({ retry: false });
});
