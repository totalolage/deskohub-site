import { APIError } from "better-auth";
import { Context, Effect, Layer } from "effect";

export type CustomerAccountDeletionEndpointResult =
  | { readonly status: "deleted" }
  | { readonly status: "reauthentication-required" }
  | { readonly status: "refused" }
  | {
      readonly status: "failed";
      readonly code: "account.delete.endpoint" | "account.delete.unexpected";
    };

interface ICustomerAccountDeletionEndpoint {
  /**
   * Deletes the account whose session `requestHeaders` carry. Every
   * rejection becomes its closed, censored result; nothing fails.
   */
  readonly deleteCurrentAccount: (
    requestHeaders: Headers
  ) => Effect.Effect<CustomerAccountDeletionEndpointResult>;
}

/**
 * Runs account deletion exclusively through Better Auth's public delete-user
 * endpoint, so its session-freshness gate and the provider-first beforeDelete
 * hook stay the single identity-deletion path. Better Auth names stay inside
 * the auth boundary; callers see only the closed result union.
 */
export class CustomerAccountDeletionEndpoint extends Context.Service<
  CustomerAccountDeletionEndpoint,
  ICustomerAccountDeletionEndpoint
>()("@deskohub-workspace/account/CustomerAccountDeletionEndpoint") {
  /** Loads the Better Auth server on first use, like the session reads. */
  static Default = Layer.succeed(this, {
    deleteCurrentAccount: (requestHeaders) =>
      Effect.tryPromise({
        try: async () => {
          const { auth } = await import(
            "@/features/account/server/auth.server"
          );
          await auth.api.deleteUser({ body: {}, headers: requestHeaders });
        },
        catch: toDeletionRejection,
      }).pipe(
        Effect.as<CustomerAccountDeletionEndpointResult>({ status: "deleted" }),
        Effect.catch((rejection) => Effect.succeed(rejection)),
        Effect.withSpan("CustomerAccountDeletionEndpoint.deleteCurrentAccount")
      ),
  });
}

/** The closed result of a rejected deletion, without Better Auth's names. */
const toDeletionRejection = (
  cause: unknown
): CustomerAccountDeletionEndpointResult => {
  if (!(cause instanceof APIError)) {
    return { status: "failed", code: "account.delete.unexpected" };
  }
  if (
    cause.body?.code === "SESSION_EXPIRED" ||
    cause.body?.code === "UNAUTHORIZED"
  ) {
    return { status: "reauthentication-required" };
  }
  if (cause.body?.code === "REVIEW_ACCOUNT_DELETION_REFUSED") {
    return { status: "refused" };
  }
  return { status: "failed", code: "account.delete.endpoint" };
};
