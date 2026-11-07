import { Effect, Match, Option } from "effect";
import type { AppLocale } from "../i18n/app-locale";
import { webCallbackPath } from "./auth-callback";
import { authClient } from "./auth-client.web";
import type { NativeHandoffRequest } from "./native-handoff-request";
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
