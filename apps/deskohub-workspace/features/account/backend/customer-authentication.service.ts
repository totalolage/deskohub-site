import type { User as BetterAuthUser } from "better-auth";
import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import { headers } from "next/headers";
import { env } from "@/env";
import { type Locale, locales } from "@/features/i18n";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { CurrentWorkspaceRequestHeaders } from "@/shared/backend/workspace-request-context";
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
 * adapter, so domain code sees only these facts.
 */
export type CustomerAccountSession = {
  readonly accountId: CustomerAccountId;
  readonly email: typeof reservationCustomerEmailSchema.Type;
  readonly deletionRequested: boolean;
  /**
   * The saved locale preference on the account. Absent for an account that
   * has none yet; never defaulted.
   */
  readonly localePreference?: Locale;
};

const decodeLocalePreference = Schema.decodeUnknownOption(
  Schema.Literals(locales)
);

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
    const localePreference = Option.getOrUndefined(
      decodeLocalePreference((session.user as { locale?: unknown }).locale)
    );

    return {
      accountId,
      email,
      deletionRequested: withDeletionMarker.deletionRequestedAt != null,
      ...(localePreference && { localePreference }),
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

// ---------------------------------------------------------------------------
// Internal authority-read phase instrumentation. These types and the stage
// error never leave this module: the exported domain contract stays the
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

const failureCategoryOf = (cause: unknown): FailureCategory => {
  if (!(cause instanceof Error)) return "Unknown";
  if (cause.name === "TypeError") return "TypeError";
  if (cause.name === "AbortError") return "AbortError";
  if (cause.name === "Error") return "Error";
  return "Unknown";
};

/**
 * Internal sanitized stage failure computed at the phase boundary: the
 * mapped diagnostic plus the closed facts, and nothing else. Failing with
 * this instead of tagging the foreign cause keeps frozen and primitive
 * rejections intact. `unattributed` covers a rejection from an injected
 * session read that did not come from the phased authority read.
 */
class AuthorityStageFailure extends Data.TaggedError("AuthorityStageFailure")<{
  readonly diagnostic: CustomerSessionReadDiagnostic;
  readonly facts: AuthorityReadFacts;
}> {
  static at =
    (stage: AuthorityReadStage) =>
    (cause: unknown): AuthorityStageFailure =>
      new AuthorityStageFailure({
        diagnostic: diagnosticOf(cause),
        facts: {
          stage,
          category: failureCategoryOf(cause),
          nextCode: nextRequestCodeOf(cause),
        },
      });
}

type AuthoritySession = { readonly user: BetterAuthUser } | null;

/**
 * The production authority read, split into the boundaries a failure can
 * come from. The phase order preserves the original read exactly — the
 * authority module loads first, then the request headers are read as the
 * get-session argument, then the call is issued — so the diagnostics change
 * no semantics.
 */
interface AuthoritySessionModule {
  readonly auth: {
    readonly api: {
      readonly getSession: (input: {
        readonly query: {
          readonly disableRefresh: true;
          readonly disableCookieCache: true;
        };
        readonly headers: Headers;
      }) => Promise<AuthoritySession>;
    };
  };
}

interface AuthoritySessionPhases {
  readonly readRequestHeaders: () => Promise<Headers>;
  readonly loadAuthority: () => Promise<AuthoritySessionModule>;
}

const readAuthoritySession = (
  phases: AuthoritySessionPhases
): Effect.Effect<AuthoritySession, AuthorityStageFailure> =>
  Effect.Do.pipe(
    Effect.bind("authority", () =>
      Effect.tryPromise({
        try: () => phases.loadAuthority(),
        catch: AuthorityStageFailure.at("auth-import"),
      })
    ),
    Effect.bind("requestHeaders", () =>
      Effect.tryPromise({
        try: () => phases.readRequestHeaders(),
        catch: AuthorityStageFailure.at("request-headers"),
      })
    ),
    Effect.flatMap(({ authority, requestHeaders }) =>
      Effect.tryPromise({
        try: () =>
          authority.auth.api.getSession({
            // Cookie caching is off in the auth options; asking again keeps
            // every read authoritative even if that setting changes, so a
            // revoked session or administrator stops on the next request.
            query: { disableRefresh: true, disableCookieCache: true },
            headers: requestHeaders,
          }),
        catch: AuthorityStageFailure.at("get-session"),
      })
    )
  );

/**
 * The phased authority read as the Promise-shaped session read that
 * `CustomerAuthenticationEnvironment` injects. It rejects with the internal
 * stage failure, which the service recognizes and attributes to its stage.
 * `CustomerAuthentication.Default` composes the phased read directly and
 * never calls this adapter, so the Workspace runner is loaded on demand and
 * the service module stays free of its instrumentation import.
 */
export const makeAuthoritySessionRead =
  (phases: AuthoritySessionPhases) => async (): Promise<AuthoritySession> => {
    const { runWorkspaceEffect } = await import(
      "@/shared/backend/workspace-effect"
    );
    return readAuthoritySession(phases).pipe(
      runWorkspaceEffect("account.authority-session.read")
    );
  };

/**
 * Adapts an injected Promise session read. Its stage failures keep their
 * attribution; any other rejection is classified as unattributed.
 */
const injectedSessionRead = (
  readCurrentSession: CustomerAuthenticationEnvironment["readCurrentSession"]
): Effect.Effect<AuthoritySession, AuthorityStageFailure> =>
  Effect.tryPromise({
    try: () => readCurrentSession(),
    catch: (cause) =>
      cause instanceof AuthorityStageFailure
        ? cause
        : AuthorityStageFailure.at("unattributed")(cause),
  });

const logSessionReadFailure = ({
  diagnostic,
  facts,
}: AuthorityStageFailure) => {
  const annotations = {
    diagnostic,
    stage: facts.stage,
    category: facts.category,
  };
  return Effect.logWarning(
    "Customer session read failed closed.",
    facts.nextCode === undefined
      ? annotations
      : { ...annotations, nextCode: facts.nextCode }
  );
};

/**
 * Reads the authoritative session and classifies failures for the closed
 * account error contract. Only genuinely absent Better Auth secrets yield
 * `not-configured`; once configured, bootstrap, provider, and database
 * session-read failures fail closed as `unavailable` under the fixed
 * `authentication.session` code without the raw failure. The single censored
 * log line carries the closed diagnostic plus the internal phase, a
 * constructor-category, and a Next.js fixed code when one exists.
 */
const readAuthoritativeSession = Effect.fn(
  "CustomerAuthentication.readAuthoritativeSession"
)(function* (source: {
  readonly readBetterAuthSecretsRaw: () => string | undefined;
  readonly session: Effect.Effect<AuthoritySession, AuthorityStageFailure>;
}) {
  const secrets = parseBetterAuthSecrets(source.readBetterAuthSecretsRaw());
  if (secrets.kind === "valid") {
    return yield* source.session.pipe(
      Effect.tapError(logSessionReadFailure),
      Effect.mapError((failure) => unavailableWith(failure.diagnostic))
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
      currentUser: readAuthoritativeSession({
        readBetterAuthSecretsRaw: () => environment.readBetterAuthSecretsRaw(),
        session: injectedSessionRead(environment.readCurrentSession),
      }).pipe(Effect.flatMap(decodeCustomerAccountSession)),
    });

  static Default = Layer.succeed(this, {
    currentUser: Effect.flatMap(CurrentWorkspaceRequestHeaders, (captured) =>
      readAuthoritativeSession({
        readBetterAuthSecretsRaw: () => env.BETTER_AUTH_SECRETS,
        session: readAuthoritySession({
          // Actions and routes capture headers at their request boundary.
          // RSC callers without that boundary still use Next's request store.
          readRequestHeaders: () =>
            captured ? Promise.resolve(captured) : headers(),
          loadAuthority: () => import("@/features/account/server/auth.server"),
        }),
      }).pipe(Effect.flatMap(decodeCustomerAccountSession))
    ),
  });
}
