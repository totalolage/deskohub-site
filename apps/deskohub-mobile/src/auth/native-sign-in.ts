import { Clock, Effect, Exit, Match, Option } from "effect";
import {
  type AuthCallback,
  nativeReturnUri,
  parseAuthCallbackUrl,
} from "./auth-callback";
import { AuthCallbackCompletions } from "./auth-callback-completions.service";
import { AuthCrypto } from "./auth-crypto.service";
import { AuthSessionBrowser } from "./auth-session-browser.service";
import {
  type NativeHandoffRequest,
  nativeHandoffRequestTtlMs,
  nativeSignInUrl,
} from "./native-handoff-request";
import {
  type AuthUser,
  NativeAuth,
  type NativeAuthFailure,
} from "./native-auth.service";
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
import { signInCompleted, signInStarted } from "./sign-in-analytics";

/**
 * Native email sign-in. Production screens the email send and the sign-in
 * code with BotID, which only a browser can pass, so the app opens the web
 * bundle's `/app/sign-in?native=1` page in an in-app auth session. After the
 * customer signs in there, the page mints a handoff code bound to this
 * attempt's PKCE challenge and returns to `deskohub://auth/callback`; the
 * app redeems it with the verifier for its own session. A magic link opened
 * from a mail app lands on the `/app/auth/callback` App Link instead and is
 * verified directly. Either way the session cookie ends up in SecureStore.
 */

export type NativeSignInServices =
  | NativeAuth
  | PendingSignIns
  | AuthSessionBrowser
  | AuthCrypto
  | AuthCallbackCompletions;

/**
 * How long a `Closed` auth session waits for the callback route. Android
 * resolves the session as soon as the app is in front again, which can be
 * just before the callback link reaches the router.
 */
const closedSessionGrace = "3 seconds";

const attemptKey = (state: string) => `attempt:${state}`;
const tokenKey = (token: string) => `token:${token}`;

const fromAuthFailure = (failure: NativeAuthFailure): NativeSignInFailure =>
  Match.value(failure).pipe(
    Match.tagsExhaustive({
      NativeAuthUnavailable: ({ cause }) => new SignInUnavailable({ cause }),
      NativeAuthRejected: ({ code }) => new SignInRejected({ code }),
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
    };
    return request;
  },
  Effect.catchTags({
    AuthCryptoFailure: (failure) => Effect.fail(unavailable(failure)),
    PendingSignInStorageFailure: (failure) => Effect.fail(unavailable(failure)),
  })
);

/**
 * The signed-in user after a completion. A reauthentication must land on the
 * account it started from; another account's session is signed out again.
 */
const confirmSignedInUser = Effect.fn("NativeSignIn.confirmSignedInUser")(
  function* (expectedUserId: string | undefined) {
    const auth = yield* NativeAuth;
    const user = yield* auth.currentUser.pipe(
      Effect.mapError(fromAuthFailure),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new SignInRejected({})),
          onSome: Effect.succeed,
        })
      )
    );
    if (expectedUserId !== undefined && user.id !== expectedUserId) {
      // The Expo client drops the stored cookie before the request goes
      // out, so the switch is undone even if the server can't be reached.
      yield* auth.signOut.pipe(Effect.ignore);
      return yield* new AccountSwitchRefused();
    }
    return user;
  }
);

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

/** Redeems a handoff code for the attempt whose state it echoes. */
const completeHandoff = Effect.fn("NativeSignIn.completeHandoff")(function* (
  code: string,
  state: string
) {
  const auth = yield* NativeAuth;
  const found = yield* loadPendingSignIn;
  if (Option.isNone(found)) {
    return yield* new SignInLinkRefused({ reason: "no-pending-sign-in" });
  }
  const pending = found.value;
  // A stray link must not cancel the attempt in progress, so a mismatch
  // leaves it stored and never reaches the server.
  if (pending.state !== state) {
    return yield* new SignInLinkRefused({ reason: "state-mismatch" });
  }
  if (isExpired(pending, yield* Clock.currentTimeMillis)) {
    yield* clearPendingSignIn;
    return yield* new SignInLinkRefused({ reason: "expired" });
  }
  yield* auth
    .exchangeHandoff({
      code,
      codeVerifier: pending.verifier,
      returnUri: pending.returnUri,
    })
    .pipe(Effect.mapError(fromAuthFailure), Effect.ensuring(clearPendingSignIn));
  return yield* confirmSignedInUser(pending.expectedUserId);
});

/**
 * Claims a magic-link token. A link opened from the mail app finishes the
 * attempt in progress too, so its auth session stops waiting.
 */
const completeToken = Effect.fn("NativeSignIn.completeToken")(function* (
  token: string
) {
  const auth = yield* NativeAuth;
  const completions = yield* AuthCallbackCompletions;
  const now = yield* Clock.currentTimeMillis;
  const pending = Option.filter(
    yield* loadPendingSignIn,
    (candidate) => !isExpired(candidate, now)
  );
  return yield* auth.verifyMagicLink(token).pipe(
    Effect.mapError(fromAuthFailure),
    Effect.tap(() =>
      Effect.when(clearPendingSignIn, Effect.succeed(Option.isSome(pending)))
    ),
    Effect.andThen(
      confirmSignedInUser(
        Option.getOrUndefined(
          Option.flatMapNullishOr(pending, (found) => found.expectedUserId)
        )
      )
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
          completeToken(token).pipe(Effect.tap(recordCompletion))
        ),
      handoff: ({ code, state }) =>
        completions.once(
          attemptKey(state),
          completeHandoff(code, state).pipe(Effect.tap(recordCompletion))
        ),
    })
  );
  yield* browser.dismiss;
  return user;
});

const recordCompletion = () => Effect.sync(() => signInCompleted("email"));

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
    signInStarted("email");
    const result = yield* browser
      .open(nativeSignInUrl(auth.origin, request), nativeReturnUri)
      .pipe(Effect.mapError(unavailable));
    return yield* Match.value(result).pipe(
      Match.tagsExhaustive({
        Returned: ({ url }) => completeAuthCallback(parseAuthCallbackUrl(url)),
        Closed: () =>
          completions.outcome(attemptKey(request.state)).pipe(
            Effect.timeoutOrElse({
              duration: closedSessionGrace,
              orElse: () => Effect.fail(new SignInCancelled()),
            })
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
 * account is refused and that session signed out.
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
