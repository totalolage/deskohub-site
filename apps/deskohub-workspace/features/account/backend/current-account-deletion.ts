import { Effect, Match } from "effect";
import { currentRequestHeaders } from "@/shared/backend/workspace-request-context";
import type { CustomerAccountAccessError } from "../customer-account";
import {
  CustomerAccountDeletionEndpoint,
  type CustomerAccountDeletionEndpointResult,
} from "./auth/delete-account-endpoint";
import { requireVerifiedSession } from "./verified-customer-session";

export type CustomerAccountDeletionResult =
  | { readonly status: "deleted" }
  | { readonly status: "reauthentication-required" }
  | { readonly status: "refused" }
  | { readonly status: "failed" };

/**
 * Deletes the current session's account, exclusively through Better Auth's
 * public delete-user endpoint, so its session-freshness gate and the
 * provider-first beforeDelete hook stay the single identity-deletion path. A
 * stale or missing session asks for reauthentication; a shared review
 * account is refused for good; an unreadable session or a retryable provider
 * failure reports a retryable failure and keeps the durable deletion marker
 * and the account untouched. Every outcome is a result; only fixed codes are
 * logged.
 */
export const requestCurrentAccountDeletion = requireVerifiedSession.pipe(
  Effect.matchEffect({
    onFailure: (failure) => refuseSessionDeletion(failure),
    onSuccess: () => deleteThroughEndpoint,
  }),
  Effect.withSpan("account.requestCurrentAccountDeletion")
);

/**
 * A session that can't delete: a missing, unverified or unlinked one asks
 * for reauthentication; an unconfigured or unreadable one is a retryable
 * failure, logged by its fixed code.
 */
const refuseSessionDeletion = (failure: CustomerAccountAccessError) =>
  Match.value(failure.reason).pipe(
    Match.when(
      Match.is("unauthenticated", "unverified-email", "link-required"),
      () => Effect.succeed({ status: "reauthentication-required" } as const)
    ),
    Match.when(Match.is("not-configured", "unavailable"), () =>
      logIncompleteDeletion({
        code: "account.delete.session",
        reason: failure.reason,
        diagnostic: failure.diagnostic,
      }).pipe(Effect.as({ status: "failed" } as const))
    ),
    Match.exhaustive
  );

/**
 * Deletes through the endpoint with the request's headers. Unreadable
 * headers are an unexpected failure; a failure reaches the caller without
 * its diagnostic code, which only the log keeps.
 */
const deleteThroughEndpoint = Effect.Do.pipe(
  Effect.bind("endpoint", () => CustomerAccountDeletionEndpoint),
  Effect.bind("result", ({ endpoint }) =>
    currentRequestHeaders.pipe(
      Effect.flatMap(endpoint.deleteCurrentAccount),
      Effect.orElseSucceed(
        (): CustomerAccountDeletionEndpointResult => ({
          status: "failed",
          code: "account.delete.unexpected",
        })
      )
    )
  ),
  Effect.flatMap(({ result }) =>
    Match.value(result).pipe(
      Match.discriminatorsExhaustive("status")({
        deleted: (deleted) => Effect.succeed(deleted),
        "reauthentication-required": (stale) => Effect.succeed(stale),
        refused: (refused) => Effect.succeed(refused),
        failed: ({ code }) =>
          logIncompleteDeletion({ code }).pipe(
            Effect.as({ status: "failed" } as const)
          ),
      })
    )
  )
);

/** The fixed code, and the session failure's reason, of a logged failure. */
type IncompleteDeletionLog = {
  readonly code:
    | "account.delete.session"
    | Extract<
        CustomerAccountDeletionEndpointResult,
        { readonly status: "failed" }
      >["code"];
  readonly reason?: CustomerAccountAccessError["reason"];
  readonly diagnostic?: CustomerAccountAccessError["diagnostic"];
};

const logIncompleteDeletion = (annotations: IncompleteDeletionLog) =>
  Effect.log("Customer account deletion did not complete").pipe(
    Effect.annotateLogs(annotations)
  );
