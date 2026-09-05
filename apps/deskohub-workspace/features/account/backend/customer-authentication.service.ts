import type { User as BetterAuthUser } from "better-auth";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { headers } from "next/headers";
import { env } from "@/env";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
  customerAccountIdSchema,
  customerAccountUnavailable,
} from "../customer-account";
import {
  type BetterAuthSecretsMessage,
  parseBetterAuthSecrets,
} from "./auth/auth-secrets";

/**
 * The closed account-domain view of an authoritative Better Auth session.
 * Better Auth user, provider, and session field types never cross this
 * adapter, so domain code sees only these three facts.
 */
export type CustomerAccountSession = {
  readonly accountId: CustomerAccountId;
  readonly email: typeof reservationCustomerEmailSchema.Type;
  readonly deletionRequested: boolean;
};

const accessError = (reason: CustomerAccountAccessError["reason"]) =>
  new CustomerAccountAccessError({ reason });

export const decodeCustomerAccountSession = (
  session: { readonly user: BetterAuthUser } | null
): Effect.Effect<CustomerAccountSession | null, CustomerAccountAccessError> =>
  Effect.gen(function* () {
    if (!session) return null;

    const accountId = Option.getOrUndefined(
      Schema.decodeOption(customerAccountIdSchema)(session.user.id)
    );
    const email = Option.getOrUndefined(
      Schema.decodeOption(reservationCustomerEmailSchema)(session.user.email)
    );
    if (!accountId || !email) {
      return yield* accessError("unauthenticated");
    }
    if (session.user.emailVerified !== true) {
      return yield* accessError("unverified-email");
    }

    const withDeletionMarker = session.user as BetterAuthUser & {
      deletionRequestedAt?: Date | null;
    };

    return {
      accountId,
      email,
      deletionRequested: withDeletionMarker.deletionRequestedAt != null,
    } satisfies CustomerAccountSession;
  });

/**
 * The environment facts behind the authoritative session read. Secret
 * absence is meaningful: outside production the deployment may intentionally
 * run without authentication and anonymous visitors stay supported.
 */
export interface CustomerAuthenticationEnvironment {
  readonly readBetterAuthSecretsRaw: () => string | undefined;
  /**
   * The Better Auth session for the current request. Rejections are
   * bootstrap, provider, or database failures.
   */
  readonly readCurrentSession: () => Promise<{
    readonly user: BetterAuthUser;
  } | null>;
}

const authenticationUnconfiguredSecretsMessage: BetterAuthSecretsMessage =
  "BETTER_AUTH_SECRETS is not configured.";

/**
 * Reads the authoritative session and classifies failures for the closed
 * account error contract. Only genuinely absent Better Auth secrets yield
 * `not-configured`; once configured, bootstrap, provider, and database
 * session-read failures fail closed as `unavailable` under the fixed
 * `authentication.session` code without the raw failure.
 */
const readAuthoritativeSession = (
  environment: CustomerAuthenticationEnvironment
): Effect.Effect<
  { readonly user: BetterAuthUser } | null,
  CustomerAccountAccessError
> =>
  Effect.gen(function* () {
    const secrets = parseBetterAuthSecrets(
      environment.readBetterAuthSecretsRaw()
    );
    if (secrets.kind === "valid") {
      return yield* Effect.tryPromise({
        try: environment.readCurrentSession,
        catch: () => customerAccountUnavailable("authentication.session"),
      });
    }
    return yield* secrets.message === authenticationUnconfiguredSecretsMessage
      ? accessError("not-configured")
      : customerAccountUnavailable("authentication.session");
  });

interface ICustomerAuthentication {
  readonly currentUser: Effect.Effect<
    CustomerAccountSession | null,
    CustomerAccountAccessError
  >;
}

export class CustomerAuthentication extends Context.Service<
  CustomerAuthentication,
  ICustomerAuthentication
>()("@deskohub-workspace/account/CustomerAuthentication") {
  /**
   * Builds the service over an injected authentication environment so
   * adapter tests can prove configuration classification and fail-closed
   * session reads without touching the global environment.
   */
  static fromEnvironment = (environment: CustomerAuthenticationEnvironment) =>
    Layer.succeed(this, {
      currentUser: readAuthoritativeSession(environment).pipe(
        Effect.flatMap(decodeCustomerAccountSession)
      ),
    });

  static Default = this.fromEnvironment({
    readBetterAuthSecretsRaw: () => env.BETTER_AUTH_SECRETS,
    readCurrentSession: async () => {
      const { auth } = await import("@/features/account/server/auth.server");
      return auth.api.getSession({
        // Every server-side read through this service is refresh-free. Reads
        // run in RSC renders, hard reloads without an `RSC` header, and
        // Server Actions alike, so this read must never roll the database
        // session ahead of a cookie the server cannot rewrite; the mounted
        // get-session route handler, reached by the browser, is the only
        // path that refreshes the session expiry and cookie together.
        query: { disableRefresh: true },
        headers: await headers(),
      });
    },
  });
}
