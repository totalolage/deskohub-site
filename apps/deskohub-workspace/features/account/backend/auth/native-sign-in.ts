import { createHash } from "node:crypto";
import { isMatchingSecret } from "@deskohub/secret-comparison";
import { customerSignInLocaleHeader } from "@deskohub/workspace-customer-api/customer-locale";
import { APIError, type AuthContext, type BetterAuthPlugin } from "better-auth";
import {
  createAuthEndpoint,
  createAuthMiddleware,
  freshSessionMiddleware,
  isAPIError,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import { Data, Effect, Option, Schema } from "effect";
import { isLocale, type Locale } from "@/features/i18n";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { digestVerificationKey } from "./auth-options";
import { nativeAppOrigin } from "./native-app";

/**
 * Native app sign-in on top of the browser sign-in.
 *
 * A sign-in email sent from the `/app/` page for the app callback carries the
 * app's App Link with only the token. The app, or the `/app/` page when the
 * link opens in a browser, verifies it through `/magic-link/verify` without a
 * callback and gets JSON either way.
 *
 * The handoff moves a browser sign-in into the app. The `/app/` page mints a
 * short-lived code bound to the app's S256 challenge, its return URI, and the
 * minting session. The app redeems the code with its verifier for a session
 * of its own. A code has no use without the verifier, so the exchange needs
 * no BotID check: it grants nothing the minting session doesn't hold.
 */

/** The `/app/` page that receives the App Link. */
const nativeAppCallbackPath = "/app/auth/callback";

const nativeAppReturnURI = `${nativeAppOrigin}auth/callback`;

/**
 * The App Link for a magic link sent for the app callback, else the
 * verification URL unchanged. Better Auth validated the callback before it
 * built the URL. Links that name a new-user or error callback keep the
 * verification URL, so those callbacks still apply.
 */
export const nativeAppLinkFor = (verificationURL: string): string => {
  const url = new URL(verificationURL);
  const token = url.searchParams.get("token");
  const callback = url.searchParams.get("callbackURL");
  const onlyTokenAndCallback = [...url.searchParams.keys()].every(
    (key) => key === "token" || key === "callbackURL"
  );
  if (!token || callback === null || !onlyTokenAndCallback) {
    return verificationURL;
  }
  const target = URL.parse(callback, url.origin);
  if (
    target?.origin !== url.origin ||
    target.pathname !== nativeAppCallbackPath ||
    target.search !== "" ||
    target.hash !== ""
  ) {
    return verificationURL;
  }
  const link = new URL(nativeAppCallbackPath, url.origin);
  link.searchParams.set("token", token);
  return link.toString();
};

/**
 * The requests that can create an account from the app: the `/app/` page's
 * sign-in code, and the magic-link verification of its App Link. The app
 * names its locale on them in `customerSignInLocaleHeader`, since `/app/`
 * paths carry no locale segment for the callback to show.
 */
const appLocalePaths: ReadonlySet<string> = new Set([
  "/sign-in/email-otp",
  "/magic-link/verify",
]);

type AppLocaleRequest = {
  readonly path?: string;
  /** Present on HTTP requests and on `auth.api` calls that pass headers. */
  readonly headers?: Headers;
};

const appLocaleHeaderValue = (request: AppLocaleRequest | null | undefined) =>
  Option.fromNullishOr(request).pipe(
    Option.filter(({ path }) => path !== undefined && appLocalePaths.has(path)),
    Option.flatMapNullishOr(({ headers }) =>
      headers?.get(customerSignInLocaleHeader)
    )
  );

/**
 * The app's locale on a sign-in code or magic-link verification, when it
 * names a supported one. The sign-in's callback locale takes precedence, so
 * this only applies where the request has none.
 */
export const appSignInLocale = (
  request: AppLocaleRequest | null | undefined
): Locale | undefined =>
  Option.getOrUndefined(Option.filter(appLocaleHeaderValue(request), isLocale));

const unsupportedAppLocale = () =>
  new APIError("BAD_REQUEST", {
    code: "INVALID_LOCALE",
    message: "The app's locale is not one the Workspace supports.",
  });

/**
 * Refuses a sign-in code or magic-link verification whose app locale isn't a
 * supported one. The auth guard runs this before it takes the request's
 * sign-in claim and before Better Auth uses the code or link, so the same
 * code or link still works when it is sent again with a valid locale.
 */
export const refuseUnsupportedAppLocale = (request: AppLocaleRequest) =>
  Option.match(
    Option.filter(appLocaleHeaderValue(request), (value) => !isLocale(value)),
    {
      onNone: () => Effect.void,
      onSome: () =>
        Effect.logWarning("Native sign-in refused.", {
          code: "account.native-sign-in.rejected",
          reason: "unsupported-locale",
        }).pipe(Effect.andThen(Effect.fail(unsupportedAppLocale()))),
    }
  );

const verifyCallbackParameters = [
  "callbackURL",
  "newUserCallbackURL",
  "errorCallbackURL",
] as const;

const verifyQuery = Schema.Struct({
  token: Schema.String,
  callbackURL: Schema.optional(Schema.String),
  newUserCallbackURL: Schema.optional(Schema.String),
  errorCallbackURL: Schema.optional(Schema.String),
});

const decodeVerifyQuery = Schema.decodeUnknownOption(verifyQuery);

/** A verification the app makes names no callback. */
const namesNoCallback = (query: Partial<typeof verifyQuery.Type> | undefined) =>
  verifyCallbackParameters.every((name) => !query?.[name]);

/** The email a magic-link verification row signs in. */
const decodeLinkEmail = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ email: Schema.String }))
);

const accountSwitchRefused = () =>
  new APIError("FORBIDDEN", {
    code: "ACCOUNT_SWITCH_REFUSED",
    message:
      "This sign-in link is for a different account. Sign out to use it.",
  });

type AppVerifyGuard = {
  readonly request: {
    /** The HTTP request; a server-side `auth.api` call has none. */
    readonly request?: Request;
    readonly query?: unknown;
    readonly context: {
      readonly internalAdapter: Pick<
        AuthContext["internalAdapter"],
        "findVerificationValue" | "findUserByEmail"
      >;
    };
  };
  /** The id of the login the request's session belongs to, if any. */
  readonly sessionUserId: () => Promise<string | undefined>;
};

/**
 * A verification the app makes never swaps the signed-in account: with a
 * session of another account, or any session when the link would create an
 * account, it is refused, as a passkey assertion from a signed-in browser is.
 * The auth guard runs this before it takes the link's sign-in claim and
 * before Better Auth consumes the link, so the session stays and the same
 * link still works once the customer signs out. A link Better Auth won't
 * accept gets its usual error.
 */
const refuseLinkOfAnotherAccount = Effect.fn(
  "NativeSignIn.refuseMagicLinkAccountSwitch"
)(function* (token: string, { request, sessionUserId }: AppVerifyGuard) {
  const currentUserId = yield* Effect.promise(sessionUserId);
  if (currentUserId === undefined) return;
  const { internalAdapter } = request.context;
  const link = yield* Effect.promise(async () =>
    internalAdapter.findVerificationValue(await digestVerificationKey(token))
  );
  const email = Option.fromNullishOr(link).pipe(
    Option.filter(({ expiresAt }) => expiresAt > new Date()),
    Option.flatMap(({ value }) => decodeLinkEmail(value))
  );
  if (Option.isNone(email)) return;
  const owner = yield* Effect.promise(() =>
    internalAdapter.findUserByEmail(email.value.email)
  );
  if (owner?.user.id === currentUserId) return;
  yield* Effect.logWarning("Native sign-in refused.", {
    code: "account.native-sign-in.rejected",
    reason: "account-switch",
  });
  return yield* Effect.fail(accountSwitchRefused());
});

export const refuseMagicLinkAccountSwitch = (guard: AppVerifyGuard) =>
  decodeVerifyQuery(guard.request.query).pipe(
    Option.filter(
      (query) => guard.request.request !== undefined && namesNoCallback(query)
    ),
    Option.match({
      onNone: () => Effect.void,
      onSome: ({ token }) => refuseLinkOfAnotherAccount(token, guard),
    })
  );

/**
 * Better Auth answers a failed verification with a redirect to its callback,
 * the site root when none was named. A verification the app makes names no
 * callback, so it gets the error as JSON instead of a page to follow. Better
 * Auth keeps the endpoint's redirect status for a replaced error, so the hook
 * answers with a whole response. Only HTTP requests get it; a server-side
 * `auth.api` call keeps Better Auth's thrown error.
 */
const answerCallbacklessVerifyFailure = createAuthMiddleware(async (ctx) => {
  const returned = ctx.context.returned;
  if (!isAPIError(returned)) return;
  const location = new Headers(returned.headers).get("location");
  const error = location
    ? URL.parse(location)?.searchParams.get("error")
    : null;
  if (!error) return;
  ctx.context.responseHeaders?.delete("location");
  return Response.json(
    { code: error, message: "The sign-in link is invalid or expired." },
    { status: 400, headers: { "cache-control": "no-store" } }
  );
});

/** S256 challenges are 43 base64url characters (RFC 7636 §4.2). */
const codeChallenge = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{43}$/)
);

/** RFC 7636 §4.1: 43 to 128 unreserved characters. */
const codeVerifier = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9._~-]{43,128}$/)
);

const mintBody = Schema.Struct({
  code_challenge: codeChallenge,
  code_challenge_method: Schema.Literal("S256"),
  state: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  return_uri: Schema.String,
});

const exchangeBody = Schema.Struct({
  code: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  code_verifier: codeVerifier,
  return_uri: Schema.String,
});

/**
 * What a code is bound to, as its verification row stores it. The row keeps
 * the minting session's token, which `auth.session` holds already, so the
 * exchange can check the session through Better Auth's own lookup.
 */
const handoffGrant = Schema.Struct({
  sessionToken: Schema.String,
  codeChallenge: Schema.String,
  returnURI: Schema.String,
});

const decodeHandoffGrant = Schema.decodeUnknownOption(
  Schema.fromJsonString(handoffGrant)
);

/** Codes are good for three minutes after minting. */
const handoffCodeLifetimeMs = 3 * 60 * 1000;

const handoffIdentifier = (code: string) => `native-handoff:${code}`;

const s256 = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

type HandoffRejection =
  | "unknown-or-expired"
  | "return-uri-mismatch"
  | "verifier-mismatch"
  | "replayed"
  | "session-ended";

class HandoffRejectedError extends Data.TaggedError("HandoffRejectedError")<{
  readonly reason: HandoffRejection;
}> {}

const invalidHandoffCode = () =>
  new APIError("BAD_REQUEST", {
    code: "INVALID_HANDOFF_CODE",
    message: "The sign-in handoff code is invalid or expired.",
  });

export type NativeSignInOptions = {
  /**
   * The customer-facing HTTPS origin whose `/app/` App Links open the app.
   */
  readonly appLinkOrigin: string;
};

export const nativeSignIn = ({ appLinkOrigin }: NativeSignInOptions) => {
  /**
   * The app scheme, the customer-facing App Link, and the App Link on the
   * request's own allowed host, so a development build can return through
   * a preview or a local server.
   */
  const isReturnURI = (returnURI: string, baseURL: string) =>
    [
      nativeAppReturnURI,
      `${appLinkOrigin}${nativeAppCallbackPath}`,
      `${new URL(baseURL).origin}${nativeAppCallbackPath}`,
    ].includes(returnURI);

  return {
    id: "native-sign-in",
    endpoints: {
      mintNativeHandoff: createAuthEndpoint(
        "/native-handoff/mint",
        {
          method: "POST",
          body: Schema.toStandardSchemaV1(mintBody),
          use: [freshSessionMiddleware],
          metadata: { noStore: true },
        },
        async (ctx) => {
          const { code_challenge, state, return_uri } = ctx.body;
          const code = generateRandomString(43);
          const minted = Effect.succeed(return_uri).pipe(
            Effect.filterOrFail(
              (returnURI) => isReturnURI(returnURI, ctx.context.baseURL),
              () =>
                new APIError("BAD_REQUEST", {
                  code: "INVALID_RETURN_URI",
                  message: "The return URI is not one of the app's.",
                })
            ),
            Effect.andThen(() =>
              Effect.promise(() =>
                ctx.context.internalAdapter.createVerificationValue({
                  identifier: handoffIdentifier(code),
                  value: JSON.stringify({
                    sessionToken: ctx.context.session.session.token,
                    codeChallenge: code_challenge,
                    returnURI: return_uri,
                  } satisfies typeof handoffGrant.Type),
                  expiresAt: new Date(Date.now() + handoffCodeLifetimeMs),
                })
              )
            ),
            Effect.map(() => {
              const url = new URL(return_uri);
              url.searchParams.set("code", code);
              url.searchParams.set("state", state);
              return url.toString();
            })
          );
          const url = await runWorkspaceEffect("account.native-handoff.mint", {
            boundary: "route",
          })(minted);
          return ctx.json({ url });
        }
      ),
      exchangeNativeHandoff: createAuthEndpoint(
        "/native-handoff/exchange",
        {
          method: "POST",
          body: Schema.toStandardSchemaV1(exchangeBody),
          metadata: { noStore: true },
        },
        async (ctx) => {
          const { code, code_verifier, return_uri } = ctx.body;
          const { internalAdapter } = ctx.context;
          const identifier = handoffIdentifier(code);
          const reject = (reason: HandoffRejection) =>
            Effect.fail(new HandoffRejectedError({ reason }));

          const redeem = Effect.gen(function* () {
            // The binding is checked before the code is consumed, so a
            // wrong verifier can't burn the app's code.
            const found = yield* Effect.promise(() =>
              internalAdapter.findVerificationValue(identifier)
            );
            const grant = Option.fromNullishOr(found).pipe(
              Option.filter(({ expiresAt }) => expiresAt > new Date()),
              Option.flatMap(({ value }) => decodeHandoffGrant(value))
            );
            if (Option.isNone(grant))
              return yield* reject("unknown-or-expired");
            const bound = grant.value;
            if (return_uri !== bound.returnURI) {
              return yield* reject("return-uri-mismatch");
            }
            if (!isMatchingSecret(s256(code_verifier), bound.codeChallenge)) {
              return yield* reject("verifier-mismatch");
            }
            const consumed = yield* Effect.promise(() =>
              internalAdapter.consumeVerificationValue(identifier)
            );
            if (consumed?.value !== found?.value)
              return yield* reject("replayed");
            const source = yield* Effect.promise(() =>
              internalAdapter.findSession(bound.sessionToken)
            );
            if (!source || source.session.expiresAt <= new Date()) {
              return yield* reject("session-ended");
            }
            // The app's session keeps the browser sign-in time, so handing
            // off from it can never make a stale sign-in fresh again.
            const session = yield* Effect.promise(() =>
              internalAdapter.createSession(
                source.user.id,
                false,
                { createdAt: source.session.createdAt },
                true
              )
            );
            return { session, user: source.user };
          }).pipe(
            Effect.tapError(({ reason }) =>
              Effect.logWarning("Native sign-in handoff refused.", {
                code: "account.native-handoff.rejected",
                reason,
              })
            ),
            Effect.mapError(invalidHandoffCode)
          );

          const signedIn = await runWorkspaceEffect(
            "account.native-handoff.exchange",
            { boundary: "route" }
          )(redeem);
          await setSessionCookie(ctx, signedIn);
          return ctx.json({ status: true });
        }
      ),
    },
    hooks: {
      after: [
        {
          matcher: (ctx) =>
            ctx.request !== undefined &&
            ctx.path === "/magic-link/verify" &&
            namesNoCallback(ctx.query),
          handler: answerCallbacklessVerifyFailure,
        },
      ],
    },
  } satisfies BetterAuthPlugin;
};
