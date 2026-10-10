import { Data, Effect } from "effect";
import { redact } from "./runtime";

export const nexiWebhookDiagnosticCodes = [
  "nexi_webhook_parse_failed",
  "nexi_webhook_unknown_order",
  "nexi_webhook_missing_security_token",
  "nexi_webhook_invalid_currency",
  "nexi_webhook_verification_failed",
  "nexi_webhook_verification_mismatch",
  "nexi_webhook_late_payment",
  "nexi_webhook_transition_failed",
  "nexi_webhook_fulfillment_failed",
  "nexi_webhook_internal_error",
] as const;

export type NexiWebhookDiagnosticCode =
  (typeof nexiWebhookDiagnosticCodes)[number];

export const isNexiWebhookDiagnosticCode = (
  value: unknown
): value is NexiWebhookDiagnosticCode =>
  typeof value === "string" &&
  nexiWebhookDiagnosticCodes.some((code) => code === value);

export const workspaceE2ERunnerDiagnosticCodes = [
  "provider_session_row_read_failed_after_redirect",
  "provider_session_reservation_missing_after_redirect",
  "provider_session_active_attempt_missing_after_redirect",
  "provider_session_fields_missing_after_redirect",
  "postgres_checkout_row_convergence_failed",
  "postgres_checkout_row_assertion_failed",
  "postgres_legal_evidence_validation_failed",
  "postgres_local_pii_validation_failed",
  "checkout_payment_terminal_before_fulfillment",
  "checkout_fulfillment_failed_before_marker",
] as const;

export const workspaceE2EProfileNavigationDiagnosticCodes = [
  "account_profile_baseline_failed",
  "account_profile_clean_navigation_failed",
  "account_profile_draft_retention_failed",
  "account_profile_hidden_billing_validation_failed",
  "account_profile_header_dismissal_failed",
  "account_profile_history_dismissal_failed",
  "account_profile_discard_confirmation_failed",
  "account_profile_persisted_document_reload_failed",
  "account_profile_persisted_profile_navigation_failed",
  "account_profile_persisted_profile_handler_wait_failed",
  "account_profile_persisted_profile_panel_hydration_wait_failed",
  "account_profile_persisted_profile_click_failed",
  "account_profile_persisted_profile_landmark_wait_failed",
  "account_profile_persisted_profile_form_visibility_failed",
  "account_profile_persisted_first_name_restore_failed",
  "account_profile_persisted_last_name_restore_failed",
  "account_profile_persisted_phone_restore_failed",
  "account_profile_persisted_billing_navigation_failed",
  "account_profile_persisted_billing_kind_restore_failed",
  "account_profile_persisted_billing_company_restore_failed",
  "account_profile_persisted_return_profile_navigation_failed",
  "account_profile_persisted_unavailable_heading_expectation_failed",
] as const;

export type WorkspaceE2EProfileNavigationDiagnosticCode =
  (typeof workspaceE2EProfileNavigationDiagnosticCodes)[number];

export const workspaceE2EReservationExistingCustomerDiagnosticCodes = [
  "account_reservation_existing_customer_page_failed",
  "account_reservation_existing_customer_card_failed",
  "account_reservation_existing_customer_card_review_failed",
  "account_reservation_existing_customer_contact_switch_failed",
  "account_reservation_existing_customer_contact_inputs_failed",
  "account_reservation_existing_customer_contact_review_failed",
  "account_reservation_existing_customer_account_switch_failed",
  "account_reservation_existing_customer_card_restore_failed",
] as const;

export type WorkspaceE2EReservationExistingCustomerDiagnosticCode =
  (typeof workspaceE2EReservationExistingCustomerDiagnosticCodes)[number];

export const workspaceE2EAccountDiagnosticCodes = [
  "auth_delivery_request_rejected",
  "auth_delivery_message_not_observed",
  "auth_delivery_message_ambiguous",
  "auth_delivery_message_retrieve_failed",
  "auth_delivery_message_invalid",
  "auth_link_origin_mismatch",
  "auth_verification_failed",
  "auth_session_not_established",
  "postgres_account_fixture_assertion_failed",
  "postgres_account_fixture_convergence_failed",
  "dotypos_account_fixture_mutation_failed",
  ...workspaceE2EProfileNavigationDiagnosticCodes,
  ...workspaceE2EReservationExistingCustomerDiagnosticCodes,
] as const;

// The Nexi hosted payment page step that failed, paired with the provider page
// state observed when it failed. Both halves are closed code-owned sets.
export const nexiHostedPaymentSteps = [
  "card_entry",
  "continue",
  "pay",
  "challenge",
  "return",
] as const;

export const nexiHostedPaymentPageStates = [
  "card_entry_incomplete",
  "card_entry_ready",
  "card_submission_rejected",
  "provider_error_page",
  "provider_failure_page",
  "provider_server_error",
  "continue_enabled",
  "continue_disabled",
  "pay_enabled",
  "pay_disabled",
  "challenge_enabled",
  "challenge_disabled",
  "return_enabled",
  "return_disabled",
  "unknown",
  "snapshot_unavailable",
] as const;

export type NexiHostedPaymentStep = (typeof nexiHostedPaymentSteps)[number];
export type NexiHostedPaymentPageStateCode =
  (typeof nexiHostedPaymentPageStates)[number];
export type NexiHostedPaymentDiagnosticCode =
  `nexi_hosted_${NexiHostedPaymentStep}_${NexiHostedPaymentPageStateCode}`;

export const nexiHostedPaymentDiagnosticCodes = nexiHostedPaymentSteps.flatMap(
  (step) =>
    nexiHostedPaymentPageStates.map(
      (state): NexiHostedPaymentDiagnosticCode => `nexi_hosted_${step}_${state}`
    )
);

export const toNexiHostedPaymentDiagnosticCode = (
  step: NexiHostedPaymentStep,
  state: NexiHostedPaymentPageStateCode
): NexiHostedPaymentDiagnosticCode => `nexi_hosted_${step}_${state}`;

export const parseNexiHostedPaymentDiagnosticCode = (
  diagnosticCode: string | undefined
):
  | {
      readonly state: NexiHostedPaymentPageStateCode;
      readonly step: NexiHostedPaymentStep;
    }
  | undefined => {
  for (const step of nexiHostedPaymentSteps) {
    const prefix = `nexi_hosted_${step}_`;
    if (!diagnosticCode?.startsWith(prefix)) continue;
    const state = nexiHostedPaymentPageStates.find(
      (candidate) => candidate === diagnosticCode.slice(prefix.length)
    );
    if (state) return { state, step };
  }
  return undefined;
};

export const workspaceE2EDiagnosticCodes = [
  ...nexiWebhookDiagnosticCodes,
  ...workspaceE2ERunnerDiagnosticCodes,
  ...workspaceE2EAccountDiagnosticCodes,
  ...nexiHostedPaymentDiagnosticCodes,
] as const;

export type WorkspaceE2EDiagnosticCode =
  (typeof workspaceE2EDiagnosticCodes)[number];

export const isWorkspaceE2EDiagnosticCode = (
  value: unknown
): value is WorkspaceE2EDiagnosticCode =>
  typeof value === "string" &&
  workspaceE2EDiagnosticCodes.some((code) => code === value);

export class WorkspaceE2EError extends Data.TaggedError("WorkspaceE2EError")<{
  readonly cause?: unknown;
  readonly causes?: readonly unknown[];
  readonly diagnosticCode?: WorkspaceE2EDiagnosticCode;
  readonly message: string;
  readonly operation?: string;
  readonly reason?: "timeout";
}> {}

export const toWorkspaceE2EError = (operation: string, cause: unknown) =>
  cause instanceof WorkspaceE2EError
    ? cause
    : new WorkspaceE2EError({
        cause,
        message: `${operation} failed: ${getCauseMessage(cause)}`,
        operation,
      });

export const workspaceE2EError = (
  message: string,
  options: {
    readonly cause?: unknown;
    readonly causes?: readonly unknown[];
    readonly diagnosticCode?: WorkspaceE2EDiagnosticCode;
    readonly operation?: string;
  } = {}
) => new WorkspaceE2EError({ message, ...options });

export const workspaceE2ETimeoutError = (
  message: string,
  options: {
    readonly cause?: unknown;
    readonly diagnosticCode?: WorkspaceE2EDiagnosticCode;
    readonly operation?: string;
  } = {}
) => new WorkspaceE2EError({ message, ...options, reason: "timeout" });

export const withWorkspaceE2EDiagnosticCode =
  (diagnosticCode: WorkspaceE2EDiagnosticCode) =>
  <A, R>(
    effect: Effect.Effect<A, WorkspaceE2EError, R>
  ): Effect.Effect<A, WorkspaceE2EError, R> =>
    effect.pipe(
      Effect.mapError((error) =>
        error.diagnosticCode
          ? error
          : new WorkspaceE2EError({
              cause: error.cause,
              causes: error.causes,
              diagnosticCode,
              message: error.message,
              operation: error.operation,
              reason: error.reason,
            })
      )
    );

export const failWorkspaceE2E = (
  message: string,
  options: {
    readonly cause?: unknown;
    readonly causes?: readonly unknown[];
    readonly operation?: string;
  } = {}
) => Effect.fail(workspaceE2EError(message, options));

export const isWorkspaceE2ETimeout = (
  cause: unknown,
  seen: Set<unknown> = new Set()
): boolean => {
  if (!cause || (typeof cause !== "object" && typeof cause !== "function"))
    return false;
  if (seen.has(cause)) return false;
  seen.add(cause);

  if (cause instanceof WorkspaceE2EError) {
    if (cause.reason === "timeout") return true;
    if (cause.cause !== undefined && isWorkspaceE2ETimeout(cause.cause, seen))
      return true;
    return (
      cause.causes?.some((nestedCause) =>
        isWorkspaceE2ETimeout(nestedCause, seen)
      ) ?? false
    );
  }

  if (cause instanceof AggregateError)
    return cause.errors.some((error) => isWorkspaceE2ETimeout(error, seen));
  if (cause instanceof Error && cause.cause !== undefined)
    return isWorkspaceE2ETimeout(cause.cause, seen);
  return false;
};

export const tryWorkspaceE2EPromise = <A>(
  operation: string,
  try_: (signal: AbortSignal) => Promise<A>
) =>
  Effect.tryPromise({
    catch: (cause) => toWorkspaceE2EError(operation, cause),
    try: try_,
  });

export const tryWorkspaceE2ESync = <A>(operation: string, try_: () => A) =>
  Effect.try({
    catch: (cause) => toWorkspaceE2EError(operation, cause),
    try: try_,
  });

export const formatWorkspaceE2EFailure = (cause: unknown) =>
  redact(formatUnknownFailure(cause, new Set()));

const formatUnknownFailure = (cause: unknown, seen: Set<unknown>): string => {
  if (seen.has(cause)) return "[circular cause]";
  if (cause && typeof cause === "object") seen.add(cause);

  if (cause instanceof WorkspaceE2EError) {
    const parts = [cause.stack ?? cause.message];
    if (cause.causes?.length) {
      parts.push(
        "Causes:",
        ...cause.causes.map((nestedCause, index) =>
          indent(`${index + 1}. ${formatUnknownFailure(nestedCause, seen)}`)
        )
      );
    } else if (cause.cause !== undefined) {
      parts.push("Caused by:", indent(formatUnknownFailure(cause.cause, seen)));
    }
    return parts.join("\n");
  }

  if (cause instanceof AggregateError) {
    return [
      cause.stack ?? cause.message,
      "Causes:",
      ...cause.errors.map((nestedCause, index) =>
        indent(`${index + 1}. ${formatUnknownFailure(nestedCause, seen)}`)
      ),
    ].join("\n");
  }

  if (cause instanceof Error) return cause.stack ?? cause.message;
  return String(cause);
};

const getCauseMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

const indent = (value: string) =>
  value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
