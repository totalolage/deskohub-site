import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import {
  getAuthenticatorName,
  type PasskeyOptions,
  passkey,
} from "@better-auth/passkey";
import { getLocaleFromPathname } from "@deskohub/i18n/pathname";
import {
  APIError,
  type AuthContext,
  type BetterAuthOptions,
  betterAuth,
  type DBAdapter,
} from "better-auth";
import {
  createAuthMiddleware,
  getSessionFromCtx,
  isAPIError,
} from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { emailOTP, magicLink } from "better-auth/plugins";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Data, Effect, Layer, Match, Option, Predicate, Schema } from "effect";
import { after } from "next/server";
import { makeAuthDatabase } from "@/db/auth-database-client";
import { WorkspaceDatabase } from "@/db/database.service";
import { workspaceDatabasePool } from "@/db/database-provider.server";
import { drizzleAuthTables } from "@/db/schema/auth";
import { env } from "@/env";
import {
  type CustomerAccountDeletionError,
  CustomerAccountDeletionService,
} from "@/features/account/backend/customer-account-deletion";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import { defaultLocale, type Locale, locales } from "@/features/i18n";
import type {
  BotDetectedError,
  BotVerificationError,
  VerifyHumanInput,
} from "@/shared/backend/bot-protection/bot-protection.service";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  lookupMagicLinkDeliveryLocale,
  type MagicLinkLocaleLookup,
} from "../customer-locale-preference";
import type { PasskeyRelyingParty } from "./auth-hosts";
import {
  authOptions,
  betterAuthMagicLinkOptions,
  betterAuthSignInCodeOptions,
} from "./auth-options";
import { renderMagicLinkEmail } from "./magic-link-email";
import {
  magicLinkDeliveryEnvironment,
  makeMagicLinkEmailDelivery,
} from "./send-magic-link-email";
import {
  claimSignInCode,
  claimSignInLink,
  dateSignInCodeRow,
  issueSignInCode,
  reserveSignInEmail,
  type SignInEmailLock,
} from "./sign-in-code";

/**
 * A sign-in email: the magic link and, while sign-in codes are on, the code
 * that signs in the same way.
 */
export type SignInEmail = Parameters<
  NonNullable<Parameters<typeof magicLink>[0]["sendMagicLink"]>
>[0] & { readonly code?: string };

export type MagicLinkSendFunction = (
  email: SignInEmail
) => Promise<void> | void;

export type WorkspaceAuthConfig = {
  readonly database: NonNullable<BetterAuthOptions["database"]>;
  readonly secrets: NonNullable<BetterAuthOptions["secrets"]>;
  readonly allowedHosts: readonly string[];
  /** This deployment's passkey RP ID and origins, never the plugin default. */
  readonly passkeyRelyingParty: PasskeyRelyingParty;
  readonly httpsOnly: boolean;
  /**
   * The `login_email_code` read, once per sign-in email; a rejection counts
   * as disabled.
   */
  readonly isSignInCodeEnabled: () => Promise<boolean>;
  /**
   * The `login_passkeys` read, once per passkey registration request; a
   * rejection counts as disabled.
   */
  readonly arePasskeysEnabled: () => Promise<boolean>;
  /** BotID verification of the current request. */
  readonly verifyHuman: (
    input: VerifyHumanInput
  ) => Effect.Effect<void, BotDetectedError | BotVerificationError>;
  /** Serializes sign-in code issues for one email address. */
  readonly withSignInEmailLock: SignInEmailLock;
  readonly sendMagicLink: MagicLinkSendFunction;
  /**
   * Requests the account's deletion before Better Auth removes it. Its
   * failures stay typed up to the hook's Promise boundary.
   */
  readonly beforeDeleteUser: (
    accountId: CustomerAccountId
  ) => Effect.Effect<void, CustomerAccountDeletionError>;
  /**
   * Sets the locale preference of an account that has none, never
   * overwriting a saved one. Every sign-in captures it from the callback
   * locale for accounts that predate the preference.
   */
  readonly captureAccountLocalePreference: (
    accountId: CustomerAccountId,
    locale: Locale
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
};

/** Both steps of adding a passkey; `login_passkeys` gates them. */
const passkeyRegistrationPaths = new Set([
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
]);

/**
 * The email-OTP plugin serves only code sign-in. Codes are issued with the
 * magic link, so every other plugin endpoint stays unreachable over HTTP;
 * `check-verification-otp` would otherwise be a non-consuming guessing
 * oracle.
 */
const disabledSignInCodePaths = [
  "/email-otp/send-verification-otp",
  "/email-otp/check-verification-otp",
  "/email-otp/verify-email",
  "/email-otp/request-password-reset",
  "/forget-password/email-otp",
  "/email-otp/reset-password",
  "/email-otp/request-email-change",
  "/email-otp/change-email",
];

/** The only body fields code sign-in accepts; none reach the user insert. */
const signInCodeBodyFields = new Set(["email", "otp", "callbackURL"]);

const magicLinkMetadataSchema = Schema.Struct({
  locale: Schema.optional(Schema.Literals(locales)),
});

const signInCodeMetadataSchema = Schema.Struct({
  signInCode: Schema.Boolean,
});

/**
 * Whether the sign-in email carries a code. Only the server writes this
 * metadata: the `/sign-in/magic-link` guard overwrites any client value.
 */
const isSignInCodeRequested = (metadata: SignInEmail["metadata"]) =>
  Option.match(Schema.decodeUnknownOption(signInCodeMetadataSchema)(metadata), {
    onNone: () => false,
    onSome: ({ signInCode }) => signInCode,
  });

const makeBotDetectedError = () =>
  new APIError("FORBIDDEN", {
    code: "BOT_DETECTED",
    message: "Automated request detected.",
  });

const makePasskeyRegistrationUnavailableError = () =>
  new APIError("FORBIDDEN", {
    code: "PASSKEY_REGISTRATION_UNAVAILABLE",
    message: "Passkeys can't be added right now.",
  });

const makePasskeyAccountMismatchError = () =>
  new APIError("FORBIDDEN", {
    code: "PASSKEY_ACCOUNT_MISMATCH",
    message: "This passkey belongs to a different account.",
  });

const makePasskeyUserVerificationRequiredError = () =>
  new APIError("FORBIDDEN", {
    code: "PASSKEY_USER_VERIFICATION_REQUIRED",
    message: "Confirming with a passkey requires user verification.",
  });

/** Better Auth's response to a wrong or used code. */
const makeInvalidSignInCodeError = () =>
  new APIError("BAD_REQUEST", { code: "INVALID_OTP", message: "Invalid OTP" });

const makeSignInEmailLimitError = () =>
  new APIError("TOO_MANY_REQUESTS", {
    code: "SIGN_IN_EMAIL_LIMIT_REACHED",
    message: "Too many sign-in emails were requested for this address.",
  });

/** The initiating site locale in the magic-link metadata, else the default. */
const decodeMagicLinkLocale = (
  data: Parameters<MagicLinkSendFunction>[0]
): Locale =>
  Option.getOrUndefined(
    Schema.decodeOption(magicLinkMetadataSchema)(data.metadata ?? {})
  )?.locale ?? defaultLocale;

const authContextSchema = Schema.Struct({
  path: Schema.optional(Schema.String),
  query: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  body: Schema.optional(
    Schema.Struct({ callbackURL: Schema.optional(Schema.String) })
  ),
});

type ParsedAuthContext = {
  readonly path?: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: { readonly callbackURL?: string };
};

/**
 * Reads the site language from the auth request's localized callback URL:
 * the magic-link verify request carries it in its query, a code sign-in in
 * its body. Returns nothing when the callback is absent, unparseable, or
 * carries no locale.
 */
const callbackLocaleFromAuthContext = (
  ctx: ParsedAuthContext
): Locale | undefined => {
  const callbackURL =
    ctx.query?.callbackURL ?? ctx.body?.callbackURL ?? ctx.path;
  if (!callbackURL) return undefined;
  const parsed = URL.parse(callbackURL, "https://auth.internal.invalid");
  return parsed ? getLocaleFromPathname(parsed.pathname, locales) : undefined;
};

/**
 * Captures the sign-in callback locale as the preference of an account that
 * has none, such as one created before preferences existed. The update never
 * overwrites a saved preference. A failure is logged with a fixed code and
 * never blocks the login: readers fall back without a preference, and the
 * next sign-in retries.
 */
const captureLocalePreference = (
  config: WorkspaceAuthConfig,
  accountId: CustomerAccountId,
  locale: Locale
) =>
  config
    .captureAccountLocalePreference(accountId, locale)
    .pipe(
      Effect.catch(() =>
        Effect.logWarning(
          "Customer language preference capture failed; continuing the sign-in.",
          { code: "account-locale-preference.capture-failed" }
        )
      )
    );

/** The deleting session's user id is not a customer account id. */
class DeletingAccountIdInvalidError extends Data.TaggedError(
  "DeletingAccountIdInvalidError"
)<Record<never, never>> {
  override readonly message =
    "The deleting session carried an invalid account identifier.";
}

/** The account id of a Better Auth user or session, when it is one of ours. */
const decodeAccountId = (userId: string) =>
  Option.getOrUndefined(Schema.decodeOption(customerAccountIdSchema)(userId));

/** Decodes the auth request context, the hooks' I/O boundary. */
const decodeAuthContext = Schema.decodeUnknownOption(authContextSchema);

type GuardedAuthRequest = {
  readonly path: string;
  readonly body?: unknown;
  readonly query?: unknown;
  readonly context: {
    readonly adapter: DBAdapter;
    readonly internalAdapter: AuthContext["internalAdapter"];
  };
};

type AuthRequestGuard = {
  readonly config: WorkspaceAuthConfig;
  readonly request: GuardedAuthRequest;
};

/**
 * BotID screens both sign-in code paths. A verification outage lets the
 * request through; the per-email limit, the per-IP rate limits, and the
 * code's attempt budget still apply.
 */
const verifySignInHuman = (config: WorkspaceAuthConfig) =>
  Effect.suspend(() =>
    config.verifyHuman({ verificationFailurePolicy: "allow" })
  ).pipe(Effect.mapError(() => makeBotDetectedError()));

/**
 * Adding a passkey needs `login_passkeys` on; an unreadable flag counts as
 * off. Passkey sign-in never reads it, so turning the flag off locks no one
 * out.
 */
const requirePasskeyRegistration = ({ config, request }: AuthRequestGuard) =>
  Effect.tryPromise(() => config.arePasskeysEnabled()).pipe(
    Effect.orElseSucceed(() => false),
    Effect.filterOrFail(Boolean, makePasskeyRegistrationUnavailableError),
    Effect.when(Effect.succeed(passkeyRegistrationPaths.has(request.path)))
  );

const hasProfileFields = ({ path, body }: GuardedAuthRequest) =>
  path === "/update-user" ||
  (path === "/sign-in/magic-link" &&
    Predicate.isObject(body) &&
    (Object.hasOwn(body, "name") || Object.hasOwn(body, "image")));

const rejectProfileFields = ({ request }: AuthRequestGuard) =>
  Effect.failSync(
    () =>
      new APIError("BAD_REQUEST", {
        message: "Profile fields are not accepted.",
      })
  ).pipe(Effect.when(Effect.succeed(hasProfileFields(request))));

const hasOnlySignInCodeFields = ({ body }: GuardedAuthRequest) =>
  !Predicate.isObject(body) ||
  Object.keys(body).every((field) => signInCodeBodyFields.has(field));

/** A code sign-in carries only the email, code, and callback URL. */
const screenSignInCode = ({ config, request }: AuthRequestGuard) =>
  Effect.succeed(request).pipe(
    Effect.filterOrFail(
      hasOnlySignInCodeFields,
      () =>
        new APIError("BAD_REQUEST", {
          message: "Only the email, code, and callback URL are accepted.",
        })
    ),
    Effect.andThen(verifySignInHuman(config))
  );

const magicLinkQuerySchema = Schema.Struct({ token: Schema.String });

/**
 * A magic link takes its email's claim before Better Auth consumes it. Better
 * Auth rejects a missing token after the hook.
 */
const claimMagicLink = ({ request }: AuthRequestGuard) =>
  Option.match(
    Schema.decodeUnknownOption(magicLinkQuerySchema)(request.query),
    {
      onNone: () => Effect.void,
      onSome: ({ token }) =>
        claimSignInLink({
          token,
          verifications: request.context.adapter,
          signInLinks: request.context.internalAdapter,
        }),
    }
  );

const readSignInCodeFlag = ({ config }: AuthRequestGuard) =>
  Effect.tryPromise(() => config.isSignInCodeEnabled()).pipe(
    Effect.orElseSucceed(() => false)
  );

const signInEmailBodySchema = Schema.Struct({ email: Schema.String });

/**
 * BotID and the per-email limit screen sign-in emails that carry a code.
 * Better Auth rejects a missing or malformed email after the hook.
 */
const screenSignInEmail = ({ config, request }: AuthRequestGuard) =>
  verifySignInHuman(config).pipe(
    Effect.andThen(
      Option.match(
        Schema.decodeUnknownOption(signInEmailBodySchema)(request.body),
        {
          onNone: () => Effect.void,
          onSome: ({ email }) =>
            reserveSignInEmail({
              verifications: request.context.adapter,
              email,
            }).pipe(
              Effect.filterOrFail(Boolean, makeSignInEmailLimitError),
              Effect.asVoid
            ),
        }
      )
    )
  );

/**
 * Evaluates `login_email_code` once for a sign-in email (fail closed) and
 * records the decision in the request metadata, replacing any client value,
 * so the email and the response follow one evaluation. While it is on, the
 * send is BotID-checked and counted against the per-email limit.
 */
const decideSignInCode = (guard: AuthRequestGuard) =>
  Effect.succeed(guard).pipe(
    Effect.bind("signInCode", readSignInCodeFlag),
    Effect.tap(({ signInCode }) =>
      screenSignInEmail(guard).pipe(Effect.when(Effect.succeed(signInCode)))
    ),
    Effect.map(({ signInCode }) => ({
      context: { body: { metadata: { signInCode } } },
    })),
    Effect.withSpan("WorkspaceAuth.decideSignInCode")
  );

const guardSignInPath = (guard: AuthRequestGuard) =>
  Match.value(guard.request.path).pipe(
    Match.when("/sign-in/magic-link", () => decideSignInCode(guard)),
    Match.when("/magic-link/verify", () => claimMagicLink(guard)),
    Match.when("/sign-in/email-otp", () => screenSignInCode(guard)),
    Match.orElse(() => Effect.void)
  );

/**
 * Rejects passkey registrations while passkeys are disabled (an unreadable
 * flag counts as disabled), any request carrying profile fields, and code
 * sign-ins carrying anything beyond the email, code, and callback URL.
 */
const guardAuthRequest = (guard: AuthRequestGuard) =>
  Effect.succeed(guard).pipe(
    Effect.tap(requirePasskeyRegistration),
    Effect.tap(rejectProfileFields),
    Effect.flatMap(guardSignInPath),
    Effect.withSpan("WorkspaceAuth.guardRequest")
  );

type SignInEmailSend = {
  readonly config: WorkspaceAuthConfig;
  readonly email: Omit<SignInEmail, "code">;
  /** The sign-in request's auth context; absent outside a request. */
  readonly context: AuthContext | undefined;
  readonly createSignInCode: (email: string) => Promise<string>;
};

/**
 * Issues the code when the request's decision says so. A code that can't be
 * stored fails the request: the response would otherwise promise a code the
 * email lacks.
 */
const issueRequestedSignInCode = ({
  config,
  email,
  context,
  createSignInCode,
}: SignInEmailSend) =>
  Option.fromNullishOr(context).pipe(
    Option.filter(() => isSignInCodeRequested(email.metadata)),
    Option.match({
      onNone: () => Effect.succeedNone,
      onSome: ({ adapter, internalAdapter }) =>
        issueSignInCode({
          email: email.email,
          token: email.token,
          verifications: adapter,
          signInCodes: internalAdapter,
          createSignInCode,
          withSignInEmailLock: config.withSignInEmailLock,
        }).pipe(
          Effect.tapError(({ code }) =>
            Effect.logWarning("Sign-in code issuance failed.", { code })
          ),
          Effect.map(Option.some)
        ),
    })
  );

/** Sends the sign-in email, adding a code when the request's decision says so. */
const sendSignInEmail = (send: SignInEmailSend) =>
  Effect.succeed(send).pipe(
    Effect.bind("code", issueRequestedSignInCode),
    Effect.flatMap(({ config, email, code }) =>
      Effect.promise(async () =>
        config.sendMagicLink(
          Option.match(code, {
            onNone: () => email,
            onSome: (signInCode) => ({ ...email, code: signInCode }),
          })
        )
      )
    ),
    Effect.withSpan("WorkspaceAuth.sendSignInEmail")
  );

const signInCodeBodySchema = Schema.Struct({
  email: Schema.String,
  otp: Schema.String,
});

type AuthEndpointContext = {
  readonly path?: string;
  readonly body?: unknown;
  readonly context: { readonly adapter: DBAdapter };
} | null;

/** The code sign-in a Better Auth database hook runs within, if any. */
const signInCodeRequest = (ctx: AuthEndpointContext) =>
  Option.fromNullishOr(ctx).pipe(
    Option.filter(({ path }) => path === "/sign-in/email-otp"),
    Option.flatMap(({ body, context }) =>
      Option.map(
        Schema.decodeUnknownOption(signInCodeBodySchema)(body),
        ({ email, otp }) => ({
          email,
          code: otp,
          verifications: context.adapter,
        })
      )
    )
  );

/**
 * A code sign-in takes its email's claim after Better Auth accepts the code
 * and before it creates the session. Losing to the link reads like any used
 * code.
 */
const claimSignInCodeSession = ({
  ctx,
}: {
  readonly ctx: AuthEndpointContext;
}) =>
  signInCodeRequest(ctx).pipe(
    Option.match({
      onNone: () => Effect.void,
      onSome: (request) =>
        claimSignInCode(request).pipe(
          Effect.catchTag("SignInEmailUsedError", () =>
            Effect.fail(makeInvalidSignInCodeError())
          )
        ),
    })
  );

/**
 * A code that Better Auth writes back after a wrong guess keeps its issue
 * time, so it never outranks a newer email's code.
 */
const dateRestoredSignInCode = ({
  verification,
  ctx,
}: {
  readonly verification: {
    readonly identifier: string;
    readonly expiresAt: Date;
  };
  readonly ctx: AuthEndpointContext;
}) =>
  signInCodeRequest(ctx).pipe(
    Option.map(({ email }) => dateSignInCodeRow({ email, row: verification })),
    Effect.transposeOption,
    Effect.map((dated) =>
      Option.getOrUndefined(
        Option.map(Option.flatten(dated), (data) => ({ data }))
      )
    )
  );

/**
 * Captures the sign-in callback locale for the session's account, when both
 * are known.
 */
const captureSessionLocale = ({
  config,
  session,
  ctx,
}: {
  readonly config: WorkspaceAuthConfig;
  readonly session: { readonly userId: string };
  readonly ctx: AuthEndpointContext;
}) =>
  Option.all({
    accountId: Option.fromNullishOr(decodeAccountId(session.userId)),
    locale: Option.fromNullishOr(
      callbackLocaleFromAuthContext(
        Option.getOrElse(decodeAuthContext(ctx), () => ({}))
      )
    ),
  }).pipe(
    Option.match({
      onNone: () => Effect.void,
      onSome: ({ accountId, locale }) =>
        captureLocalePreference(config, accountId, locale),
    })
  );

/**
 * Prepares a session before Better Auth stores it: a code sign-in takes its
 * claim first, the callback locale is captured, and the session keeps no IP
 * address or user agent.
 */
const prepareSession = <Session extends { readonly userId: string }>(request: {
  readonly config: WorkspaceAuthConfig;
  readonly session: Session;
  readonly ctx: AuthEndpointContext;
}) =>
  Effect.succeed(request).pipe(
    Effect.tap(claimSignInCodeSession),
    Effect.tap(captureSessionLocale),
    Effect.map(({ session }) => ({
      data: { ...session, ipAddress: null, userAgent: null },
    }))
  );

type CompletedAuthRequest = {
  readonly path: string;
  readonly body?: { readonly metadata?: SignInEmail["metadata"] };
  readonly json: (body: {
    readonly status: true;
    readonly signInCode: boolean;
  }) => unknown;
  readonly context: { readonly returned?: unknown };
};

/**
 * Returns the sign-in code decision with the sign-in email response, so the
 * client shows the code step only for an email that carries a code.
 */
const completeAuthRequest = (ctx: CompletedAuthRequest) =>
  ctx.path === "/sign-in/magic-link" && !isAPIError(ctx.context.returned)
    ? ctx.json({
        status: true,
        signInCode: isSignInCodeRequested(ctx.body?.metadata),
      })
    : undefined;

type PasskeyAssertion = Parameters<
  NonNullable<
    NonNullable<PasskeyOptions["authentication"]>["afterVerification"]
  >
>[0];

const passkeyOwnerSchema = Schema.Struct({ userId: Schema.String });

/** The account a verified passkey belongs to, if its row still exists. */
const passkeyOwner = ({ ctx, verification }: PasskeyAssertion) =>
  Effect.promise(() =>
    ctx.context.adapter.findOne({
      model: "passkey",
      where: [
        {
          field: "credentialID",
          value: verification.authenticationInfo.credentialID,
        },
      ],
    })
  ).pipe(
    Effect.map((row) =>
      Option.map(
        Schema.decodeUnknownOption(passkeyOwnerSchema)(row),
        ({ userId }) => userId
      )
    )
  );

/**
 * A passkey assertion from a browser that already holds a session confirms
 * that same customer, as the delete-account and stale-enrolment
 * reauthentication do: it must come from one of the session account's own
 * passkeys and carry user verification. Otherwise it fails before the
 * plugin creates a session, so the current session stays in place. Better
 * Auth already limits the options' `allowCredentials` to the session
 * account's passkeys; this check doesn't rely on the browser honouring it.
 * An anonymous assertion is an ordinary passkey sign-in.
 */
const confirmSessionPasskey = (assertion: PasskeyAssertion) =>
  Effect.promise(() => getSessionFromCtx(assertion.ctx)).pipe(
    Effect.map(Option.fromNullishOr),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (session) =>
          passkeyOwner(assertion).pipe(
            Effect.filterOrFail(
              (owner) => Option.contains(owner, session.user.id),
              makePasskeyAccountMismatchError
            ),
            Effect.filterOrFail(
              () => assertion.verification.authenticationInfo.userVerified,
              makePasskeyUserVerificationRequiredError
            ),
            Effect.asVoid
          ),
      })
    ),
    Effect.withSpan("WorkspaceAuth.confirmSessionPasskey")
  );

type PasskeyOptionsRequest = Parameters<
  Parameters<typeof createAuthMiddleware>[0]
>[0];

/**
 * Asks the browser for user verification on a reauthentication: options
 * requested with a session, which `confirmSessionPasskey` then requires.
 * Sign-in options keep the plugin's `preferred` setting.
 */
const requireReauthenticationUserVerification = (ctx: PasskeyOptionsRequest) =>
  Option.liftPredicate(ctx.context.returned, Predicate.isObject).pipe(
    Option.filter(
      (returned) =>
        ctx.path === "/passkey/generate-authenticate-options" &&
        !isAPIError(returned)
    ),
    Option.match({
      onNone: () => Effect.void,
      onSome: (returned) =>
        Effect.promise(() => getSessionFromCtx(ctx)).pipe(
          Effect.map(Option.fromNullishOr),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.void,
              onSome: () =>
                Effect.promise(async () =>
                  ctx.json({ ...returned, userVerification: "required" })
                ),
            })
          )
        ),
    })
  );

/**
 * Picks the magic-link email language. A verified existing account uses its
 * saved preference. An account without a preference, a pre-account (first)
 * delivery, and a pending unverified signup use the initiating site locale.
 * An unreadable preference skips delivery so no wrong-language magic link
 * reaches a customer.
 */
type MagicLinkDeliveryDecision =
  | { readonly action: "deliver"; readonly locale: Locale }
  | {
      readonly action: "skip";
      readonly code: "account.magic-link.locale.read-failed";
    };

const decideMagicLinkDelivery = (
  lookup: MagicLinkLocaleLookup,
  fallback: Locale
): MagicLinkDeliveryDecision => {
  if (lookup.kind === "account")
    return { action: "deliver", locale: lookup.locale };
  if (lookup.kind === "read-failed") {
    return { action: "skip", code: "account.magic-link.locale.read-failed" };
  }
  return { action: "deliver", locale: fallback };
};

/**
 * Builds the Workspace Better Auth instance on top of the shared
 * connectionless options. The database adapter, secrets, dynamic host
 * allowlist, and lifecycle callbacks are the only runtime additions.
 */
export const makeWorkspaceAuth = (config: WorkspaceAuthConfig) => {
  const baseURL = { allowedHosts: [...config.allowedHosts] };
  if (config.httpsOnly) Object.assign(baseURL, { protocol: "https" as const });

  // Resolved lazily: `sendMagicLink` runs only after the instance exists.
  // The sign-in request resolves the dynamic base URL for the direct call.
  const createSignInCode = (
    email: string,
    request: Request | undefined
  ): Promise<string> =>
    auth.api.createVerificationOTP({
      body: { email, type: "sign-in" },
      request,
      asResponse: false,
    });

  const auth = betterAuth({
    ...authOptions,
    secrets: config.secrets,
    baseURL,
    database: config.database,
    logger: { disabled: true },
    onAPIError: {
      onError: (error) => {
        if (isAPIError(error) && error.statusCode < 500) return;

        void runWorkspaceEffect("account.auth.handler", { boundary: "route" })(
          Effect.logError("Better Auth request failed.", {
            code: "account.auth.handler",
          })
        ).catch(() => undefined);

        // Keep better-call from falling through to its raw error logger.
        // biome-ignore lint: This synchronous third-party callback must return a fixed APIError.
        throw new APIError("INTERNAL_SERVER_ERROR", {
          message: "Internal Server Error",
        });
      },
    },
    disabledPaths: ["/update-user", ...disabledSignInCodePaths],
    hooks: {
      before: createAuthMiddleware((ctx) =>
        runWorkspaceEffect("account.auth.guard", { boundary: "route" })(
          guardAuthRequest({ config, request: ctx })
        )
      ),
      after: createAuthMiddleware(
        async (ctx) =>
          completeAuthRequest(ctx) ??
          runWorkspaceEffect("account.passkey.reauthentication-options", {
            boundary: "route",
          })(requireReauthenticationUserVerification(ctx))
      ),
    },
    plugins: [
      magicLink({
        ...betterAuthMagicLinkOptions,
        sendMagicLink: (data, ctx) =>
          runWorkspaceEffect("account.sign-in-email.send", {
            boundary: "route",
          })(
            sendSignInEmail({
              config,
              email: data,
              context: ctx?.context,
              createSignInCode: (email) =>
                createSignInCode(email, ctx?.request),
            })
          ),
      }),
      emailOTP({
        ...betterAuthSignInCodeOptions,
        // Codes are issued only with a magic link; this plugin's own send
        // endpoint is disabled.
        sendVerificationOTP: () => Promise.reject(new APIError("NOT_FOUND")),
      }),
      passkey({
        rpID: config.passkeyRelyingParty.rpID,
        rpName: authOptions.appName,
        origin: [...config.passkeyRelyingParty.origins],
        registration: {
          // Labels a passkey the client didn't name with its provider, such
          // as "Google Password Manager". Unknown and anonymous authenticators
          // stay unnamed, and the client shows a generic localized label.
          afterVerification: ({ verification }) => ({
            name: getAuthenticatorName(verification.registrationInfo?.aaguid),
          }),
        },
        authentication: {
          afterVerification: (assertion) =>
            runWorkspaceEffect("account.passkey.confirm-session", {
              boundary: "route",
            })(confirmSessionPasskey(assertion)),
        },
      }),
      // Better Auth requires `nextCookies` to be the last plugin: it forwards
      // Set-Cookie headers into the Next.js cookie store for Server Action
      // `auth.api` calls and defers RSC-only session refreshes.
      nextCookies(),
    ],
    databaseHooks: {
      session: {
        create: {
          before: (session, ctx) =>
            runWorkspaceEffect("account.auth.capture-locale", {
              boundary: "route",
            })(prepareSession({ config, session, ctx })),
        },
      },
      verification: {
        create: {
          before: (verification, ctx) =>
            runWorkspaceEffect("account.sign-in-code.date", {
              boundary: "route",
            })(dateRestoredSignInCode({ verification, ctx })),
        },
      },
      user: {
        create: {
          // The locale preference is part of the user insert, so no account
          // exists without one. It comes from the initiating site locale in
          // the callback URL, else the site default.
          before: async (user, ctx) => ({
            data: {
              ...user,
              locale:
                callbackLocaleFromAuthContext(
                  Option.getOrElse(decodeAuthContext(ctx), () => ({}))
                ) ?? defaultLocale,
            },
          }),
        },
      },
    },
    user: {
      ...authOptions.user,
      deleteUser: {
        ...authOptions.user?.deleteUser,
        enabled: true,
        beforeDelete: (user) =>
          runWorkspaceEffect("account.deletion.provider-expiration", {
            boundary: "task",
          })(
            Effect.gen(function* () {
              const accountId = decodeAccountId(user.id);
              if (!accountId) {
                return yield* new DeletingAccountIdInvalidError();
              }
              yield* config.beforeDeleteUser(accountId);
            })
          ),
      },
    },
  });
  return auth;
};

const makeWorkspaceMagicLinkDelivery = () =>
  makeMagicLinkEmailDelivery(
    renderMagicLinkEmail,
    magicLinkDeliveryEnvironment({
      VERCEL_ENV: env.VERCEL_ENV,
      NODE_ENV: process.env.NODE_ENV,
    })
  );

export const makeWorkspaceAuthDatabase = () =>
  drizzleAdapter(makeAuthDatabase(workspaceDatabasePool), {
    provider: "pg",
    schema: drizzleAuthTables,
    schemaName: "auth",
  });

export const workspaceSendMagicLink: MagicLinkSendFunction = (data) =>
  runWorkspaceEffect("account.magic-link.locale", { boundary: "route" })(
    lookupMagicLinkDeliveryLocale(data.email).pipe(
      Effect.provide(WorkspaceDatabase.Default),
      Effect.orElseSucceed(() => ({ kind: "read-failed" }) as const),
      Effect.map((lookup) =>
        decideMagicLinkDelivery(lookup, decodeMagicLinkLocale(data))
      ),
      Effect.flatMap((decision) =>
        Match.value(decision).pipe(
          Match.discriminatorsExhaustive("action")({
            skip: ({ code }) =>
              Effect.logWarning(
                "Magic-link delivery skipped for an existing account with an unreadable language preference.",
                { code }
              ),
            deliver: ({ locale }) =>
              Effect.sync(() =>
                after(() =>
                  runWorkspaceEffect("account.magic-link.deliver", {
                    boundary: "task",
                  })(
                    makeWorkspaceMagicLinkDelivery().deliver({
                      email: data.email,
                      url: data.url,
                      code: data.code,
                      locale,
                    })
                  )
                )
              ),
          })
        )
      )
    )
  );

// A deletion service that cannot be built is a configuration defect, not a
// deletion failure; either way the hook rejects and Better Auth keeps the
// account.
export const workspaceBeforeDeleteUser = (accountId: CustomerAccountId) =>
  Effect.flatMap(CustomerAccountDeletionService, (service) =>
    service.requestDeletion(accountId)
  ).pipe(Effect.provide(CustomerAccountDeletionService.Live.pipe(Layer.orDie)));
