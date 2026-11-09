import { Clock, Effect, Exit, Match, Option } from "effect";
import {
  type SignInMethod,
  trackSignInCompleted,
  trackSignInStarted,
} from "../analytics/events";
import {
  type AuthCallback,
  nativeReturnUri,
  parseAuthCallbackUrl,
} from "./auth-callback";
import { AuthCallbackCompletions } from "./auth-callback-completions.service";
import { AuthCrypto } from "./auth-crypto.service";
import { AuthSessionBrowser } from "./auth-session-browser.service";
import {
  type AuthUser,
  NativeAuth,
  type NativeAuthFailure,
  type SignInSession,
} from "./native-auth.service";
import {
  type NativeHandoffRequest,
  nativeHandoffRequestTtlMs,
  nativeSignInUrl,
} from "./native-handoff-request";
import {
  AccountSwitchRefused,
  type NativeSignInFailure,
  NotSignedIn,
  SignInCancelled,
  SignInLinkRefused,
  SignInRejected,
  SignInUnavailable,
} from "./native-sign-in-errors";
import { type PendingSignIn, PendingSignIns } from "./pending-sign-in.service";
import {
  encodeBase64Url,
  pkceChallengeFromDigest,
  pkceRandomByteCount,
  pkceVerifierFromBytes,
} from "./pkce";
import { SignInLocale } from "./sign-in-locale";

/**
 * Native email sign-in. Production screens the email send and the sign-in
 * code with BotID, which only a browser can pass, so the app opens the web
 * bundle's `/app/sign-in?native=1` page in an in-app auth session. After the
 * customer signs in there, the page mints a handoff code bound to this
 * attempt's PKCE challenge and returns to `deskohub://auth/callback`; the
 * app redeems it with the verifier for its own session. A magic link opened
 * from a mail app lands on the `/app/auth/callback` App Link instead and is
 * verified directly. Either way the new session's cookie is stored in
 * SecureStore once the app accepts it. The verification names the app's
 * locale (`SignInLocale`), which an account it creates takes as its language;
 * the sign-in request passes it to the web page, which shows it and names it
 * for the accounts it creates.
 */

export type NativeSignInServices =
  | NativeAuth
  | PendingSignIns
  | AuthSessionBrowser
  | AuthCrypto
  | AuthCallbackCompletions
  | SignInLocale;

/**
 * How long a `Closed` auth session waits for a callback to arrive. Android
 * resolves the session as soon as the app is in front again, which can be
 * just before the callback link reaches the router.
 */
const closedSessionGrace = "3 seconds";

const attemptKey = (state: string) => `attempt:${state}`;
const tokenKey = (token: string) => `token:${token}`;

/**
 * The Workspace refuses a link verified with another account's session
 * (403 `ACCOUNT_SWITCH_REFUSED`) and keeps the link, so the refusal is an
 * account switch, not a used link.
 */
const fromAuthFailure = (failure: NativeAuthFailure): NativeSignInFailure =>
  Match.value(failure).pipe(
    Match.tagsExhaustive({
      NativeAuthUnavailable: ({ cause }) => new SignInUnavailable({ cause }),
      NativeAuthRejected: ({ code }) =>
        code === "ACCOUNT_SWITCH_REFUSED"
          ? new AccountSwitchRefused()
          : new SignInRejected({ code }),
    })
  );

const unavailable = (failure: { readonly cause: unknown }) =>
  new SignInUnavailable({ cause: failure.cause });

/** Starts an attempt: fresh PKCE values, persisted before the page opens. */
export const startPendingSignIn = Effect.fn("NativeSignIn.startPendingSignIn")(
  function* (expectedUserId: Option.Option<string>) {
    const crypto = yield* AuthCrypto;
    const pendingSignIns = yield* PendingSignIns;
    const verifier = pkceVerifierFromBytes(
      yield* crypto.randomBytes(pkceRandomByteCount)
    );
    const state = encodeBase64Url(
      yield* crypto.randomBytes(pkceRandomByteCount)
    );
    const codeChallenge = pkceChallengeFromDigest(
      yield* crypto.sha256(verifier)
    );
    const pending: PendingSignIn = {
      verifier,
      state,
      returnUri: nativeReturnUri,
      startedAt: yield* Clock.currentTimeMillis,
      ...Option.match(expectedUserId, {
        onNone: () => ({}),
        onSome: (id) => ({ expectedUserId: id }),
      }),
    };
    yield* pendingSignIns.save(pending);
    const request: NativeHandoffRequest = {
      codeChallenge,
      state,
      returnUri: nativeReturnUri,
      reauthenticate: Option.isSome(expectedUserId),
      locale: yield* SignInLocale,
    };
    return request;
  },
  Effect.catchTags({
    AuthCryptoFailure: (failure) => Effect.fail(unavailable(failure)),
    PendingSignInStorageFailure: (failure) => Effect.fail(unavailable(failure)),
  })
);

/** A session without a user is a refused sign-in. */
const requireUser = Option.match({
  onNone: () => Effect.fail(new SignInRejected({})),
  onSome: (user: AuthUser) => Effect.succeed(user),
});

const signedInUser = Effect.service(NativeAuth).pipe(
  Effect.flatMap((auth) => auth.currentUser),
  Effect.mapError(fromAuthFailure),
  Effect.flatMap(requireUser)
);

/**
 * Accepts the session a completion opened and returns its user. A
 * reauthentication must land on the account it started from: another
 * account's session, or one whose account can't be confirmed, is ended on
 * the server and never replaces the app's own, which stays signed in. Any
 * other sign-in accepts its session even when its user can't be read yet.
 */
const confirmSignedInUser =
  (expectedUserId: string | undefined) => (session: SignInSession) =>
    (expectedUserId === undefined
      ? session.accept.pipe(Effect.andThen(signedInUser))
      : session.user.pipe(
          Effect.mapError(fromAuthFailure),
          Effect.flatMap(requireUser),
          Effect.filterOrFail(
            (user) => user.id === expectedUserId,
            () => new AccountSwitchRefused()
          ),
          Effect.catch((failure) =>
            session.revoke.pipe(
              Effect.ignore,
              Effect.andThen(Effect.fail(failure))
            )
          ),
          Effect.tap(() => session.accept)
        )
    ).pipe(Effect.withSpan("NativeSignIn.confirmSignedInUser"));

const loadPendingSignIn = Effect.service(PendingSignIns).pipe(
  Effect.flatMap((pendingSignIns) => pendingSignIns.load),
  Effect.mapError(unavailable)
);

const clearPendingSignIn = Effect.service(PendingSignIns).pipe(
  Effect.flatMap((pendingSignIns) => pendingSignIns.clear),
  Effect.ignore
);

const isExpired = (pending: PendingSignIn, now: number) =>
  now - pending.startedAt >= nativeHandoffRequestTtlMs;

/**
 * The stored attempt a handoff callback belongs to. A stray link must not
 * cancel the attempt in progress, so a mismatch leaves it stored and never
 * reaches the server; an expired attempt is refused.
 */
const pendingSignInFor = (state: string) =>
  loadPendingSignIn.pipe(
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(new SignInLinkRefused({ reason: "no-pending-sign-in" })),
        onSome: Effect.succeed,
      })
    ),
    Effect.filterOrFail(
      (pending) => pending.state === state,
      () => new SignInLinkRefused({ reason: "state-mismatch" })
    ),
    Effect.flatMap((pending) =>
      Clock.currentTimeMillis.pipe(
        // The expired attempt stays stored: a reauthentication's account
        // keeps guarding links until a new sign-in replaces it.
        Effect.filterOrFail(
          (now) => !isExpired(pending, now),
          () => new SignInLinkRefused({ reason: "expired" })
        ),
        Effect.as(pending)
      )
    )
  );

/** Redeems a handoff code for the attempt whose state it echoes. */
const completeHandoff = (code: string, state: string) =>
  Effect.Do.pipe(
    Effect.bind("pending", () => pendingSignInFor(state)),
    Effect.bind("auth", () => Effect.service(NativeAuth)),
    Effect.flatMap(({ auth, pending }) =>
      auth
        .exchangeHandoff({
          code,
          codeVerifier: pending.verifier,
          returnUri: pending.returnUri,
        })
        .pipe(
          Effect.mapError(fromAuthFailure),
          Effect.flatMap(confirmSignedInUser(pending.expectedUserId))
        )
    ),
    // Only a confirmed sign-in ends the attempt: a refused one keeps its
    // expected account for the email's other links until it expires.
    Effect.tap(() => clearPendingSignIn),
    Effect.withSpan("NativeSignIn.completeHandoff")
  );

/**
 * The account a magic link must sign in to. A stored reauthentication guards
 * its email's links for as long as any can be used: until a sign-in is
 * confirmed, or the customer starts a new sign-in, which replaces it. Without
 * one, a signed-in app expects its current account (it only gets a sign-in
 * link through a reauthentication), and a signed-out app has none to switch
 * from. A session that can't be read stops before the token is spent.
 */
const magicLinkExpectedUserId = (stored: Option.Option<PendingSignIn>) =>
  Option.match(
    Option.flatMapNullishOr(stored, (found) => found.expectedUserId),
    {
      onSome: (userId) => Effect.succeed<string | undefined>(userId),
      onNone: () =>
        Effect.service(NativeAuth).pipe(
          Effect.flatMap((auth) => auth.currentUser),
          Effect.mapError(fromAuthFailure),
          Effect.map((user) => Option.getOrUndefined(user)?.id)
        ),
    }
  );

/**
 * Claims a magic-link token. A link opened from the mail app finishes the
 * attempt in progress too, so its auth session stops waiting.
 */
const completeToken = Effect.fn("NativeSignIn.completeToken")(function* (
  token: string
) {
  const auth = yield* NativeAuth;
  const completions = yield* AuthCallbackCompletions;
  const locale = yield* SignInLocale;
  const now = yield* Clock.currentTimeMillis;
  const stored = yield* loadPendingSignIn;
  const pending = Option.filter(stored, (found) => !isExpired(found, now));
  yield* Option.match(pending, {
    onNone: () => Effect.void,
    onSome: ({ state }) => completions.claim(attemptKey(state)),
  });
  return yield* magicLinkExpectedUserId(stored).pipe(
    Effect.flatMap((expectedUserId) =>
      auth
        .verifyMagicLink(token, locale)
        .pipe(
          Effect.mapError(fromAuthFailure),
          Effect.flatMap(confirmSignedInUser(expectedUserId))
        )
    ),
    // Only a confirmed sign-in ends the attempt (and any expired one).
    Effect.tap(() =>
      Effect.when(clearPendingSignIn, Effect.succeed(Option.isSome(stored)))
    ),
    Effect.onExit((exit) =>
      Option.match(pending, {
        onNone: () => Effect.void,
        onSome: ({ state }) => completions.settle(attemptKey(state), exit),
      })
    )
  );
});

/**
 * Finishes a sign-in from its callback, once per token or attempt however
 * many times the URL arrives.
 */
export const completeAuthCallback = Effect.fn(
  "NativeSignIn.completeAuthCallback"
)(function* (callback: AuthCallback) {
  const completions = yield* AuthCallbackCompletions;
  const browser = yield* AuthSessionBrowser;
  const user = yield* Match.value(callback).pipe(
    Match.discriminatorsExhaustive("kind")({
      invalid: () => Effect.fail(new SignInLinkRefused({ reason: "invalid" })),
      error: () =>
        Effect.fail(new SignInLinkRefused({ reason: "provider-error" })),
      token: ({ token }) =>
        completions.once(
          tokenKey(token),
          completeToken(token).pipe(Effect.tap(recordCompletion("link")))
        ),
      handoff: ({ code, state, method }) =>
        completions.once(
          attemptKey(state),
          completeHandoff(code, state).pipe(
            Effect.tap(recordCompletion(method))
          )
        ),
    })
  );
  yield* browser.dismiss;
  return user;
});

/**
 * Records the completed sign-in once per completion. A handoff carries the
 * method the web page signed in with; without one nothing is recorded.
 */
const recordCompletion = (method: SignInMethod | undefined) => () =>
  Effect.sync(() => {
    if (method !== undefined) trackSignInCompleted(method);
  });

/**
 * Runs the email sign-in in the in-app auth session and returns the signed-in
 * user. A reauthentication passes the current user's id: the page then signs
 * in again instead of continuing its browser session, and only that account
 * is accepted back.
 */
export const signInWithEmail = Effect.fn("NativeSignIn.signInWithEmail")(
  function* (expectedUserId: Option.Option<string>) {
    const auth = yield* NativeAuth;
    const browser = yield* AuthSessionBrowser;
    const completions = yield* AuthCallbackCompletions;
    const request = yield* startPendingSignIn(expectedUserId);
    // The email and its code or link are handled by the web page, so the
    // app records the start as the page would: an email sign-in, by link.
    yield* Effect.sync(() => trackSignInStarted("link"));
    const result = yield* browser
      .open(nativeSignInUrl(auth.origin, request), nativeReturnUri)
      .pipe(Effect.mapError(unavailable));
    return yield* Match.value(result).pipe(
      Match.tagsExhaustive({
        Returned: ({ url }) => completeAuthCallback(parseAuthCallbackUrl(url)),
        // Only the callback's arrival is bounded; once it is being
        // finished, its outcome is awaited however long the server takes.
        Closed: () =>
          completions.claimed(attemptKey(request.state)).pipe(
            Effect.timeoutOrElse({
              duration: closedSessionGrace,
              orElse: () => Effect.fail(new SignInCancelled()),
            }),
            Effect.andThen(completions.outcome(attemptKey(request.state)))
          ),
      })
    );
  }
);

/**
 * Proves the customer is still there before a sensitive action the server
 * refused with `SESSION_NOT_FRESH` or `SESSION_EXPIRED`. Runs a new email
 * sign-in through the auth session; the handoff session inherits the browser
 * sign-in's age, so the page always signs in again. Signing in to another
 * account is refused: that session is ended and the app stays signed in.
 */
export const reauthenticate: Effect.Effect<
  AuthUser,
  NativeSignInFailure,
  NativeSignInServices
> = Effect.service(NativeAuth).pipe(
  Effect.flatMap((auth) => auth.currentUser),
  Effect.mapError(fromAuthFailure),
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.fail(new NotSignedIn()),
      onSome: (user) => signInWithEmail(Option.some(user.id)),
    })
  ),
  Effect.withSpan("NativeSignIn.reauthenticate")
);

/** The exit's expected failure, with a defect read as unavailable. */
export const signInFailureOf = (
  exit: Exit.Exit<unknown, NativeSignInFailure>
): Option.Option<NativeSignInFailure> =>
  Exit.isSuccess(exit)
    ? Option.none()
    : Option.some(
        Option.getOrElse(
          Exit.findErrorOption(exit),
          () => new SignInUnavailable({})
        )
      );
