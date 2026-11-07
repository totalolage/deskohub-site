import { Effect, Match, Result } from "effect";
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
export const requestCurrentAccountDeletion = Effect.fn(
  "account.requestCurrentAccountDeletion"
)(function* () {
  const session = yield* Effect.result(requireVerifiedSession);
  if (Result.isFailure(session)) {
    const result = toDeletionSessionFailureResult(session.failure);
    if (result.status === "failed") {
      yield* Effect.log("Customer account deletion did not complete").pipe(
        Effect.annotateLogs({
          code: "account.delete.session",
          reason: session.failure.reason,
          diagnostic: session.failure.diagnostic,
        })
      );
    }
    return result;
  }

  const endpoint = yield* CustomerAccountDeletionEndpoint;
  const result = yield* currentRequestHeaders.pipe(
    Effect.flatMap(endpoint.deleteCurrentAccount),
    Effect.orElseSucceed(
      (): CustomerAccountDeletionEndpointResult => ({
        status: "failed",
        code: "account.delete.unexpected",
      })
    )
  );
  if (result.status === "failed") {
    yield* Effect.log("Customer account deletion did not complete").pipe(
      Effect.annotateLogs({ code: result.code })
    );
    return { status: "failed" } as const;
  }
  return result;
});

const toDeletionSessionFailureResult = (
  failure: CustomerAccountAccessError
): CustomerAccountDeletionResult =>
  Match.value(failure.reason).pipe(
    Match.when(
      Match.is("unauthenticated", "unverified-email", "link-required"),
      () => ({ status: "reauthentication-required" }) as const
    ),
    Match.when(
      Match.is("not-configured", "unavailable"),
      () => ({ status: "failed" }) as const
    ),
    Match.exhaustive
  );
