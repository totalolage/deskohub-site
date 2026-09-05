import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Data, Schema } from "effect";

export const customerAccountIdSchema = Schema.Trim.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(255)
)
  .pipe(Schema.brand("CustomerAccountId"))
  .annotate({
    identifier: "CustomerAccountId",
    description: "Opaque identifier assigned by Better Auth.",
  });

export type CustomerAccountId = typeof customerAccountIdSchema.Type;

export type LinkedCustomerAccount = {
  readonly accountId: CustomerAccountId;
  readonly dotyposCustomerId: DotyposCustomerId;
};

export type CustomerAccountAccessFailure =
  | "not-configured"
  | "unauthenticated"
  | "unverified-email"
  | "link-required"
  | "unavailable";

export type CustomerAccountLinkFailure =
  | "not-found"
  | "ambiguous"
  | "unusable"
  | "claimed"
  | "deletion-requested";

export type CustomerAccountFailureCode =
  | "account-link.claim"
  | "account-link.lock"
  | "account-link.read"
  | "account-link.unlink"
  | "account.deletion-state"
  | "authentication.session"
  | "dotypos.customer-expiration"
  | "dotypos.customer-lookup";

export class CustomerAccountFailureCause extends Data.TaggedError(
  "CustomerAccountFailureCause"
)<{
  readonly code: CustomerAccountFailureCode;
}> {}

/**
 * The closed classification of an authoritative session-read rejection.
 * Each value names one recognized failure mechanism — a Better Auth rate
 * limit, a lost Next.js request scope, or a Better Auth API rejection —
 * so a fail-closed read stays diagnosable from telemetry without ever
 * carrying the raw failure. Values are low-cardinality and safe to log.
 */
export type CustomerSessionReadDiagnostic =
  | "authentication.session.rate-limited"
  | "authentication.session.request-context"
  | "authentication.session.api-error"
  | "authentication.session.unclassified";

export class CustomerAccountAccessError extends Data.TaggedError(
  "CustomerAccountAccessError"
)<{
  readonly reason: CustomerAccountAccessFailure;
  readonly linkReason?: CustomerAccountLinkFailure;
  readonly cause?: CustomerAccountFailureCause;
  readonly diagnostic?: CustomerSessionReadDiagnostic;
}> {}

export const customerAccountUnavailable = (code: CustomerAccountFailureCode) =>
  new CustomerAccountAccessError({
    reason: "unavailable",
    cause: new CustomerAccountFailureCause({ code }),
  });

export const mapCustomerAccountFailure =
  (code: CustomerAccountFailureCode) =>
  <E>(error: E): CustomerAccountAccessError =>
    error instanceof CustomerAccountAccessError
      ? error
      : customerAccountUnavailable(code);
