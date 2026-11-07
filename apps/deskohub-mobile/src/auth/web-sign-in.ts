import { Effect, Match, Option } from "effect";
import type { AppLocale } from "../i18n/app-locale";
import { webCallbackPath } from "./auth-callback";
import { authClient } from "./auth-client.web";
import type { NativeHandoffRequest } from "./native-handoff-request";
import {
  clearReauthenticatingUser,
  saveReauthenticatingUser,
} from "./web-reauthentication-store";
import {
  WebSignInFailure,
  type WebSignInOperation,
  webSignInFailureReason,
} from "./web-sign-in-failure";

/**
 * The web bundle's sign-in steps. They run in the browser, so BotID covers
 * the email send and the sign-in code, and the session is the site's own
 * cookie. `mintNativeHandoff` hands that session to the native app that
 * opened `/app/sign-in?native=1`.
 */

interface ClientResult<A> {
  readonly data: A | null;
  readonly error: { readonly status?: number; readonly code?: string } | null;
}

const call = <A>(
  operation: WebSignInOperation,
  request: (signal: AbortSignal) => Promise<ClientResult<A>>
): Effect.Effect<A | null, WebSignInFailure> =>
  Effect.tryPromise({
    try: request,
    catch: () => new WebSignInFailure({ operation, reason: "unavailable" }),
  }).pipe(
    Effect.flatMap(({ data, error }) =>
      error === null
        ? Effect.succeed(data)
        : Effect.fail(
            new WebSignInFailure({
              operation,
              reason: webSignInFailureReason(operation, error),
            })
          )
    )
  );

/**
 * Sends the sign-in email. The relative `/app/auth/callback` (and no other
 * callback) makes the server send the App Link with the bare token.
 */
export const sendSignInEmail = (email: string, locale: AppLocale) =>
  call("send-email", (signal) =>
    authClient.signIn.magicLink({
      email,
      callbackURL: webCallbackPath,
      metadata: { locale },
      fetchOptions: { signal },
    })
  ).pipe(Effect.asVoid, Effect.withSpan("WebSignIn.sendSignInEmail"));

export const verifySignInCode = (email: string, code: string) =>
  call("verify-code", (signal) =>
    authClient.signIn.emailOtp({ email, otp: code, fetchOptions: { signal } })
  ).pipe(Effect.asVoid, Effect.withSpan("WebSignIn.verifySignInCode"));

/** Claims a magic-link token without a callback, for a JSON answer. */
export const verifyMagicLinkToken = (token: string) =>
  call("verify-link", (signal) =>
    authClient.magicLink.verify({ query: { token }, fetchOptions: { signal } })
  ).pipe(Effect.asVoid, Effect.withSpan("WebSignIn.verifyMagicLinkToken"));

/**
 * Mints a handoff code for the native request under the browser session and
 * returns the URL that opens the app with it. Call it only after a customer
 * action: a completed sign-in or the "Continue as" button.
 */
export const mintNativeHandoff = (request: NativeHandoffRequest) =>
  call<{ readonly url?: unknown }>("mint-handoff", (signal) =>
    authClient.$fetch("/native-handoff/mint", {
      method: "POST",
      body: {
        code_challenge: request.codeChallenge,
        code_challenge_method: "S256",
        state: request.state,
        return_uri: request.returnUri,
      },
      signal,
    })
  ).pipe(
    Effect.flatMap((data) =>
      typeof data?.url === "string" &&
      data.url.startsWith(`${request.returnUri}?`)
        ? Effect.succeed(data.url)
        : Effect.fail(
            new WebSignInFailure({
              operation: "mint-handoff",
              reason: "failed",
            })
          )
    ),
    Effect.withSpan("WebSignIn.mintNativeHandoff")
  );

/**
 * Which account a sign-in on this page must come back as. An ordinary
 * sign-in has no expectation; a reauthentication expects the account it
 * started from, and fails closed when that account can't be recovered.
 */
export type WebAccountExpectation =
  | { readonly kind: "none" }
  | { readonly kind: "account"; readonly userId: string }
  | { readonly kind: "unrecoverable" };

export const reauthenticationExpectation = ({
  reauthenticating,
  sessionUserId,
  storedUserId,
}: {
  readonly reauthenticating: boolean;
  /** The account this page's browser session had before signing in again. */
  readonly sessionUserId: string | undefined;
  readonly storedUserId: Option.Option<string>;
}): WebAccountExpectation => {
  if (!reauthenticating) return { kind: "none" };
  const userId = sessionUserId ?? Option.getOrUndefined(storedUserId);
  return userId === undefined
    ? { kind: "unrecoverable" }
    : { kind: "account", userId };
};

const refuseAccount = (
  reason: "account-switch" | "reauthentication-unconfirmed"
) =>
  Effect.tryPromise(() => authClient.signOut()).pipe(
    Effect.ignore,
    Effect.andThen(
      Effect.fail(
        new WebSignInFailure({ operation: "confirm-account", reason })
      )
    )
  );

/**
 * After a reauthentication's sign-in, the browser must be signed in to the
 * account it started from. Another account's session, or one whose account
 * can't be read or was never known, is signed out and refused, so the page
 * never carries on as someone else.
 */
export const confirmWebAccount = (expectation: WebAccountExpectation) =>
  Match.value(expectation).pipe(
    Match.discriminatorsExhaustive("kind")({
      none: () => Effect.void,
      unrecoverable: () => refuseAccount("reauthentication-unconfirmed"),
      account: ({ userId }) =>
        call("confirm-account", (signal) =>
          authClient.getSession({ fetchOptions: { signal } })
        ).pipe(
          Effect.catch(() => refuseAccount("reauthentication-unconfirmed")),
          Effect.filterOrElse(
            (data) => data?.user.id === userId,
            (data) =>
              refuseAccount(
                data === null || data === undefined
                  ? "reauthentication-unconfirmed"
                  : "account-switch"
              )
          ),
          Effect.asVoid
        ),
    }),
    Effect.withSpan("WebSignIn.confirmWebAccount")
  );

/**
 * Before a reauthentication's email goes out, stores the account it must
 * come back as, so the email's link can be checked in any tab. An account
 * that can't be recovered or stored stops the email.
 */
export const prepareReauthenticationEmail = (
  expectation: WebAccountExpectation
) =>
  Match.value(expectation).pipe(
    Match.discriminatorsExhaustive("kind")({
      none: () => Effect.void,
      unrecoverable: () => Effect.fail(reauthenticationUnavailable()),
      account: ({ userId }) =>
        Effect.sync(() => saveReauthenticatingUser(userId, Date.now())).pipe(
          Effect.filterOrFail(
            (saved) => saved,
            () => reauthenticationUnavailable()
          ),
          Effect.asVoid
        ),
    })
  );

const reauthenticationUnavailable = () =>
  new WebSignInFailure({
    operation: "send-email",
    reason: "reauthentication-unavailable",
  });

/**
 * The account a magic link opened in a browser must come back as. A pending
 * native request hands the session to the app, which checks the account
 * itself. Otherwise a stored reauthentication names the account: every
 * reauthentication email is sent only after it is stored, and it outlives the
 * link. Without one, a browser that is still signed in can only reach a link
 * through a reauthentication, so its current account is expected; a signed-out
 * browser without one holds no account to switch from. A session that can't
 * be read fails closed.
 */
export const magicLinkExpectation = ({
  nativePending,
  storedUserId,
}: {
  readonly nativePending: boolean;
  readonly storedUserId: Option.Option<string>;
}): Effect.Effect<WebAccountExpectation> => {
  if (nativePending) return Effect.succeed({ kind: "none" });
  return Option.match(storedUserId, {
    onSome: (userId) => Effect.succeed({ kind: "account", userId }),
    onNone: () =>
      call("confirm-account", (signal) =>
        authClient.getSession({ fetchOptions: { signal } })
      ).pipe(
        Effect.map(
          (data): WebAccountExpectation =>
            data === null || data === undefined
              ? { kind: "none" }
              : { kind: "account", userId: data.user.id }
        ),
        Effect.orElseSucceed(
          (): WebAccountExpectation => ({ kind: "unrecoverable" })
        )
      ),
  });
};

/**
 * The stored reauthentication is cleared only once a sign-in is confirmed as
 * its account. A refused or failed attempt keeps it, so the email's other
 * still-valid links are checked against it too.
 */
const clearOnceConfirmed = Effect.sync(clearReauthenticatingUser);

/** Signs the browser in with a magic link, refusing an account switch. */
export const completeWebMagicLink = (
  token: string,
  context: Parameters<typeof magicLinkExpectation>[0]
) =>
  magicLinkExpectation(context).pipe(
    Effect.flatMap((expectation) =>
      verifyMagicLinkToken(token).pipe(
        Effect.andThen(confirmWebAccount(expectation))
      )
    ),
    Effect.tap(() => clearOnceConfirmed),
    Effect.withSpan("WebSignIn.completeWebMagicLink")
  );

/** Signs the browser in with the email's code, refusing an account switch. */
export const completeWebCodeSignIn = (
  email: string,
  code: string,
  expectation: WebAccountExpectation
) =>
  verifySignInCode(email, code).pipe(
    Effect.andThen(confirmWebAccount(expectation)),
    Effect.tap(() => clearOnceConfirmed),
    Effect.withSpan("WebSignIn.completeWebCodeSignIn")
  );
