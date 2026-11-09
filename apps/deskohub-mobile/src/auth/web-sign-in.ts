import { Effect, Match, Option } from "effect";
import { type SignInMethod, trackSignInCompleted } from "../analytics/events";
import type { AppLocale } from "../i18n/app-locale";
import { webCallbackPath, withSignInMethod } from "./auth-callback";
import { authClient } from "./auth-client.web";
import type { AuthUser } from "./auth-session-state";
import type { NativeHandoffRequest } from "./native-handoff-request";
import { withSessionWriteLock } from "./session-write-lock";
import { signInLocaleHeaders } from "./sign-in-locale";
import { signOutOf } from "./sign-out-request";
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

/** A sent sign-in email, and whether it carries a sign-in code. */
export interface SentSignInEmail {
  readonly email: string;
  readonly signInCode: boolean;
}

/**
 * Sends the sign-in email. The relative `/app/auth/callback` (and no other
 * callback) makes the server send the App Link with the bare token. The
 * server answers whether the email also carries a sign-in code; anything but
 * a clear yes means the link alone.
 */
export const sendSignInEmail = (email: string, locale: AppLocale) =>
  call<{ readonly status: boolean; readonly signInCode?: unknown }>(
    "send-email",
    (signal) =>
      authClient.signIn.magicLink({
        email,
        callbackURL: webCallbackPath,
        metadata: { locale },
        fetchOptions: { signal },
      })
  ).pipe(
    Effect.map(
      (data): SentSignInEmail => ({
        email,
        signInCode: data?.signInCode === true,
      })
    ),
    Effect.withSpan("WebSignIn.sendSignInEmail")
  );

/**
 * Signs in with the email's code. The request names the app's locale, which
 * an account it creates takes as its language. It waits for a sign-out in
 * flight, whose answer would otherwise expire the new session's cookie.
 */
export const verifySignInCode = (
  email: string,
  code: string,
  locale: AppLocale
) =>
  withSessionWriteLock(
    call("verify-code", (signal) =>
      authClient.signIn.emailOtp({
        email,
        otp: code,
        fetchOptions: { signal, headers: signInLocaleHeaders(locale) },
      })
    )
  ).pipe(Effect.asVoid, Effect.withSpan("WebSignIn.verifySignInCode"));

/**
 * Claims a magic-link token without a callback, for a JSON answer. The
 * request names the app's locale, and waits for a sign-out in flight, as
 * the sign-in code does.
 */
export const verifyMagicLinkToken = (token: string, locale: AppLocale) =>
  withSessionWriteLock(
    call("verify-link", (signal) =>
      authClient.magicLink.verify({
        query: { token },
        fetchOptions: { signal, headers: signInLocaleHeaders(locale) },
      })
    )
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

/** Where a finished sign-in goes: back into the app, or a web route. */
export type SignInDestination =
  | { readonly kind: "app"; readonly url: string }
  | { readonly kind: "web" };

/**
 * Finishes a sign-in on this page. For a native request it mints the handoff
 * and names `method` on it, so the app records the completion; `continue`
 * means the page continued its existing session. Without a native request
 * the browser itself completed the sign-in and records it here.
 */
export const finishSignIn = (
  request: Option.Option<NativeHandoffRequest>,
  method: SignInMethod
) =>
  Option.match(request, {
    onNone: () =>
      Effect.sync((): SignInDestination => {
        trackSignInCompleted(method);
        return { kind: "web" };
      }),
    onSome: (found) =>
      mintNativeHandoff(found).pipe(
        Effect.map(
          (url): SignInDestination => ({
            kind: "app",
            url: withSignInMethod(url, method),
          })
        )
      ),
  });

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

/**
 * The sign-in page's email field. A web reauthentication's email goes only to
 * the account this page's browser session had when the page first read it:
 * a code or link for any other address would sign in to that account and
 * replace the browser's session cookie, which the page can't restore. Until
 * that first read nothing is sent, so an address entered early can't slip
 * past the lock. Without a session there is nothing to keep, and the account
 * check still refuses a switch.
 */
export type SignInEmailField =
  | { readonly kind: "waiting" }
  | { readonly kind: "locked"; readonly email: string }
  | { readonly kind: "free" };

export const signInEmailField = ({
  reauthenticating,
  pageSession,
}: {
  readonly reauthenticating: boolean;
  readonly pageSession: { readonly user: AuthUser | undefined } | undefined;
}): SignInEmailField => {
  if (pageSession === undefined) return { kind: "waiting" };
  return reauthenticating && pageSession.user !== undefined
    ? { kind: "locked", email: pageSession.user.email }
    : { kind: "free" };
};

const refuseAccount = (
  reason: "account-switch" | "reauthentication-unconfirmed"
) =>
  signOutOf(authClient).pipe(
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
 * come back as and the screen it returns to, so the email's link can be
 * checked, and finish, in any tab. An account that can't be recovered or
 * stored stops the email.
 */
export const prepareReauthenticationEmail = (
  expectation: WebAccountExpectation,
  returnPath: string
) =>
  Match.value(expectation).pipe(
    Match.discriminatorsExhaustive("kind")({
      none: () => Effect.void,
      unrecoverable: () => Effect.fail(reauthenticationUnavailable()),
      account: ({ userId }) =>
        Effect.sync(() =>
          saveReauthenticatingUser({ userId, returnPath }, Date.now())
        ).pipe(
          Effect.filterOrFail(
            (saved) => saved,
            () => reauthenticationUnavailable()
          ),
          Effect.asVoid
        ),
    })
  );

/**
 * A page the app opened sends sign-in emails only while the app's request is
 * live (ten minutes from when the page took it). Its links then expire well
 * inside the app's guard on a reauthentication's account.
 */
export const prepareNativeHandoffEmail = ({
  openedByApp,
  currentRequest,
}: {
  readonly openedByApp: boolean;
  readonly currentRequest: Option.Option<NativeHandoffRequest>;
}) =>
  Effect.void.pipe(
    Effect.filterOrFail(
      () => !openedByApp || Option.isSome(currentRequest),
      () =>
        new WebSignInFailure({
          operation: "send-email",
          reason: "native-request-expired",
        })
    )
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

/**
 * Signs the browser in with a magic link, refusing an account switch. The
 * server refuses another account's link while the browser is signed in
 * (`403 ACCOUNT_SWITCH_REFUSED`) and keeps its session, so that refusal
 * signs nothing out; a link that still signs in as another account is
 * signed out again by the account check.
 */
export const completeWebMagicLink = (
  token: string,
  context: Parameters<typeof magicLinkExpectation>[0],
  locale: AppLocale
) =>
  magicLinkExpectation(context).pipe(
    Effect.flatMap((expectation) =>
      verifyMagicLinkToken(token, locale).pipe(
        Effect.andThen(confirmWebAccount(expectation))
      )
    ),
    Effect.tap(() => clearOnceConfirmed),
    Effect.withSpan("WebSignIn.completeWebMagicLink")
  );

/**
 * Confirms the account a passkey just signed the browser in to, refusing an
 * account switch. The passkey ceremony has already signed in, so a refusal
 * signs the browser out again.
 */
export const completeWebPasskeySignIn = (expectation: WebAccountExpectation) =>
  confirmWebAccount(expectation).pipe(
    Effect.tap(() => clearOnceConfirmed),
    Effect.withSpan("WebSignIn.completeWebPasskeySignIn")
  );

/** Signs the browser in with the email's code, refusing an account switch. */
export const completeWebCodeSignIn = (
  email: string,
  code: string,
  expectation: WebAccountExpectation,
  locale: AppLocale
) =>
  verifySignInCode(email, code, locale).pipe(
    Effect.andThen(confirmWebAccount(expectation)),
    Effect.tap(() => clearOnceConfirmed),
    Effect.withSpan("WebSignIn.completeWebCodeSignIn")
  );
