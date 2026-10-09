import {
  isWorkspaceE2ETimeout,
  type NexiHostedPaymentDiagnosticCode,
  type NexiHostedPaymentPageStateCode,
  type NexiHostedPaymentStep,
  parseNexiHostedPaymentDiagnosticCode,
  toNexiHostedPaymentDiagnosticCode,
  type WorkspaceE2EError,
} from "../errors";
import type { NexiBuildResponse } from "./nexi-build-api";

// The shared Nexi sandbox intermittently rejects a hosted payment on its own
// side. A checkout case may restart such a payment once, through a fresh
// payment attempt, when the rejection provably happened before Nexi could
// authorize anything.

// Provider pages the sandbox never leaves; the driver fails on them without
// waiting, so a restart stays inside the case budget. Timeouts never qualify.
const nexiSandboxRejectionStates = [
  "card_submission_rejected",
  "provider_error_page",
  "provider_failure_page",
] as const satisfies readonly NexiHostedPaymentPageStateCode[];

// Steps that run before Pay asks Nexi to authorize the payment.
const nexiPreAuthorizationSteps = [
  "card_entry",
  "continue",
] as const satisfies readonly NexiHostedPaymentStep[];

// Hosted-field calls that only follow an accepted authorization request.
const nexiPostAuthorizationEndpoints = ["gdi-result", "finalize-payment"];

export const nexiSandboxRetryDelayMs = 5_000;

export type NexiSandboxRejection = {
  readonly diagnosticCode: NexiHostedPaymentDiagnosticCode;
  readonly state: NexiHostedPaymentPageStateCode;
  readonly step: NexiHostedPaymentStep;
};

export type NexiSandboxRetryDecision =
  | { readonly rejection: NexiSandboxRejection; readonly retry: true }
  | { readonly reason: string; readonly retry: false };

const decline = (reason: string): NexiSandboxRetryDecision => ({
  reason,
  retry: false,
});

// Classifies a hosted-payment failure as a Nexi sandbox rejection, or returns
// undefined for timeouts and every failure that is not a terminal Nexi page.
export const classifyNexiSandboxRejection = (
  error: Pick<WorkspaceE2EError, "diagnosticCode" | "reason" | "cause">
): NexiSandboxRejection | undefined => {
  if (isWorkspaceE2ETimeout(error)) return undefined;
  const parsed = parseNexiHostedPaymentDiagnosticCode(error.diagnosticCode);
  if (!parsed) return undefined;
  if (!nexiSandboxRejectionStates.some((state) => state === parsed.state))
    return undefined;
  return {
    diagnosticCode: toNexiHostedPaymentDiagnosticCode(
      parsed.step,
      parsed.state
    ),
    ...parsed,
  };
};

// Nexi answered every authorization request with a server error and never
// reached the 3-D Secure result or payment finalization.
const isAuthorizationRequestRejected = (
  responses: readonly NexiBuildResponse[]
) => {
  const authorizations = responses.filter(
    (response) => response.endpoint === "validate-and-pay"
  );
  return (
    authorizations.length > 0 &&
    authorizations.every((response) => response.status >= 500) &&
    !responses.some(
      (response) =>
        nexiPostAuthorizationEndpoints.includes(response.endpoint) &&
        response.status < 400
    )
  );
};

export const decideNexiSandboxRetry = ({
  authorizationRequested,
  error,
  responses,
}: {
  // Whether the driver activated Pay, the only authorization request.
  readonly authorizationRequested: boolean;
  readonly error: Pick<
    WorkspaceE2EError,
    "diagnosticCode" | "reason" | "cause"
  >;
  // Nexi hosted-field responses observed in the browser session.
  readonly responses: readonly NexiBuildResponse[];
}): NexiSandboxRetryDecision => {
  const rejection = classifyNexiSandboxRejection(error);
  if (!rejection)
    return decline("the failure is not a terminal Nexi sandbox page");
  if (nexiPreAuthorizationSteps.some((step) => step === rejection.step))
    return { rejection, retry: true };
  if (rejection.step !== "pay")
    return decline(`Nexi ${rejection.step} runs after payment authorization`);
  if (!authorizationRequested) return { rejection, retry: true };
  return isAuthorizationRequestRejected(responses)
    ? { rejection, retry: true }
    : decline("Nexi may have authorized the payment");
};
