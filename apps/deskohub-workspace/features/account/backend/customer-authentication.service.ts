import type { User as BetterAuthUser } from "better-auth";
import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import { headers } from "next/headers";
import { env } from "@/env";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import {
  CustomerAccountAccessError,
  CustomerAccountFailureCause,
  type CustomerAccountId,
  type CustomerSessionReadDiagnostic,
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
 * The request-scope failure Next.js raises for `headers()` and `cookies()`
 * outside a live request. The message ends with the fixed docs URL and the
 * error carries the non-enumerable `__NEXT_ERROR_CODE` E251, so the
 * classifier accepts either fixed identifier and never depends on trailing
 * message text staying stable. E1378 is the sibling after()-phase code.
 */
const nextRequestScopePattern =
  /^`(headers|cookies)` was called outside a request scope\. Read more: https:\/\/nextjs\.org\/docs\/messages\/next-dynamic-api-wrong-context/;

type NextRequestCode = "E251" | "E1378";

const nextRequestCodeOf = (cause: unknown): NextRequestCode | undefined => {
  if (!(cause instanceof Error)) return undefined;
  const code = (cause as { readonly __NEXT_ERROR_CODE?: unknown })
    .__NEXT_ERROR_CODE;
  if (code === "E251" || code === "E1378") return code;
  return nextRequestScopePattern.test(cause.message) ? "E251" : undefined;
};

const isNextRequestContextError = (cause: Error): boolean =>
  nextRequestCodeOf(cause) !== undefined;

/**
 * Better Auth rejections surface as errors named `APIError` carrying a
 * fixed `status`; the adapter recognizes that boundary shape without
 * importing the provider.
 */
const isBetterAuthApiError = (
  cause: unknown
): cause is Error & { readonly status?: unknown } =>
  cause instanceof Error && cause.name === "APIError";

/**
 * Maps a rejected session read onto the closed diagnostic taxonomy without
 * retaining any part of the raw failure. The mapped error stays the fixed
 * fail-closed `authentication.session` unavailability, so callers keep
 * their existing contract while telemetry gains one low-cardinality code
 * naming the recognized mechanism — rate limit, request-scope loss, a
 * Better Auth API rejection, or an unclassified failure.
 */
const diagnosticOf = (cause: unknown): CustomerSessionReadDiagnostic => {
  if (isBetterAuthApiError(cause)) {
    return cause.status === "TOO_MANY_REQUESTS"
      ? "authentication.session.rate-limited"
      : "authentication.session.api-error";
  }
  if (cause instanceof Error && isNextRequestContextError(cause)) {
    return "authentication.session.request-context";
  }
  return "authentication.session.unclassified";
};

const unavailableWith = (diagnostic: CustomerSessionReadDiagnostic) =>
  new CustomerAccountAccessError({
    reason: "unavailable",
    cause: new CustomerAccountFailureCause({ code: "authentication.session" }),
    diagnostic,
  });

const classifySessionReadFailure = (
  cause: unknown
): CustomerAccountAccessError => unavailableWith(diagnosticOf(cause));

// ---------------------------------------------------------------------------
// Internal authority-read phase instrumentation. These types and the wrapper
// errors never leave this module: the exported domain contract stays the
// closed `CustomerAccountAccessError` diagnostic. Foreign causes are only
// ever read — never mutated, frozen-or-not — and are dropped the moment the
// closed facts are computed.
// ---------------------------------------------------------------------------

type AuthorityReadStage =
  | "auth-import"
  | "request-headers"
  | "get-session"
  | "unattributed";

type FailureCategory = "Error" | "TypeError" | "AbortError" | "Unknown";

interface AuthorityReadFacts {
  readonly stage: AuthorityReadStage;
  readonly category: FailureCategory;
  readonly nextCode: NextRequestCode | undefined;
}

const failureFactsOf = (
  stage: Exclude<AuthorityReadStage, "unattributed">,
  cause: unknown
): AuthorityReadFacts => ({
  stage,
  category: failureCategoryOf(cause),
  nextCode: nextRequestCodeOf(cause),
});

/**
 * Internal sanitized stage failure computed at the phase boundary: the
 * mapped diagnostic plus the closed facts, and nothing else. Rejecting with
 * this instead of tagging the foreign cause keeps frozen and primitive
 * rejections intact.
 */
class AuthorityStageFailure extends Data.TaggedError("AuthorityStageFailure")<{
  readonly diagnostic: CustomerSessionReadDiagnostic;
  readonly facts: AuthorityReadFacts;
}> {}

const stageFailureOf = (
  stage: Exclude<AuthorityReadStage, "unattributed">,
  cause: unknown
): AuthorityStageFailure =>
  new AuthorityStageFailure({
    diagnostic: diagnosticOf(cause),
    facts: failureFactsOf(stage, cause),
  });

const failureCategoryOf = (cause: unknown): FailureCategory => {
  if (!(cause instanceof Error)) return "Unknown";
  if (cause.name === "TypeError") return "TypeError";
  if (cause.name === "AbortError") return "AbortError";
  if (cause.name === "Error") return "Error";
  return "Unknown";
};

/**
 * The production authority read, split into the boundaries a rejection can
 * come from. The phase order preserves the original read exactly — the
 * authority module loads first, then the request headers are read as the
 * get-session argument, then the call is issued — so the diagnostics change
 * no semantics.
 */
interface AuthoritySessionModule {
  readonly auth: {
    readonly api: {
      readonly getSession: (input: {
        readonly query: { readonly disableRefresh: true };
        readonly headers: Headers;
      }) => Promise<{ readonly user: BetterAuthUser } | null>;
    };
  };
}

export const makeAuthoritySessionRead =
  (phases: {
    readonly readRequestHeaders: () => Promise<Headers>;
    readonly loadAuthority: () => Promise<AuthoritySessionModule>;
  }) =>
  async (): Promise<{ readonly user: BetterAuthUser } | null> => {
    const authority = await phases
      .loadAuthority()
      .catch((cause: unknown) =>
        Promise.reject(stageFailureOf("auth-import", cause))
      );
    let requestHeaders: Headers;
    try {
      requestHeaders = await phases.readRequestHeaders();
    } catch (cause) {
      return Promise.reject(stageFailureOf("request-headers", cause));
    }
    try {
      return await authority.auth.api.getSession({
        query: { disableRefresh: true },
        headers: requestHeaders,
      });
    } catch (cause) {
      return Promise.reject(stageFailureOf("get-session", cause));
    }
  };

/**
 * Internal wrapper pairing the fail-closed mapped error with the fixed
 * phase/category facts for the single censored log line. Never exported.
 */
class AuthorityReadFailure extends Data.TaggedError("AuthorityReadFailure")<{
  readonly failure: CustomerAccountAccessError;
  readonly stage: AuthorityReadStage;
  readonly category: FailureCategory;
  readonly nextCode: NextRequestCode | undefined;
}> {}

/**
 * Reads the authoritative session and classifies failures for the closed
 * account error contract. Only genuinely absent Better Auth secrets yield
 * `not-configured`; once configured, bootstrap, provider, and database
 * session-read failures fail closed as `unavailable` under the fixed
 * `authentication.session` code without the raw failure. The single censored
 * log line carries the closed diagnostic plus the internal phase, a
 * constructor-category, and a Next.js fixed code when one exists.
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
        catch: (cause) => {
          if (cause instanceof AuthorityStageFailure) {
            return new AuthorityReadFailure({
              failure: unavailableWith(cause.diagnostic),
              stage: cause.facts.stage,
              category: cause.facts.category,
              nextCode: cause.facts.nextCode,
            });
          }
          return new AuthorityReadFailure({
            failure: classifySessionReadFailure(cause),
            stage: "unattributed",
            category: failureCategoryOf(cause),
            nextCode: nextRequestCodeOf(cause),
          });
        },
      }).pipe(
        Effect.tapError((failure) =>
          failure.nextCode === undefined
            ? Effect.logWarning("Customer session read failed closed.", {
                diagnostic: failure.failure.diagnostic,
                stage: failure.stage,
                category: failure.category,
              })
            : Effect.logWarning("Customer session read failed closed.", {
                diagnostic: failure.failure.diagnostic,
                stage: failure.stage,
                category: failure.category,
                nextCode: failure.nextCode,
              })
        ),
        Effect.catch((failure) => Effect.fail(failure.failure))
      );
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
    readCurrentSession: makeAuthoritySessionRead({
      readRequestHeaders: () => headers(),
      loadAuthority: () => import("@/features/account/server/auth.server"),
    }),
  });
}
