"use client";

import { Option, Predicate, Schema } from "effect";
import {
  getAuthCallbackPath,
  getSignInDestination,
} from "@/features/account/routes";
import type { Locale } from "@/features/i18n";
import { listenForReturn } from "@/shared/browser/return-window";
import { authClient } from "./auth.client";
import { noteEmailSignInForPasskeyPrompt } from "./passkey-prompt";
import {
  captureSignInCodeRejection,
  recordSignInCompletion,
  type SignInCodeRejectionReason,
} from "./sign-in-analytics";
import { forgetSignInCodeRequest } from "./sign-in-code-request";

const RETURN_LISTENER_TTL_MS = 10 * 60 * 1000;
const FRESH_SESSION_WINDOW_MS = 10 * 60 * 1000;

const sessionCreatedAtSchema = Schema.Union([
  Schema.Date,
  Schema.String,
  Schema.Finite,
]);
const sessionResponseSchema = Schema.Struct({
  data: Schema.NullOr(
    Schema.Struct({
      session: Schema.Struct({
        createdAt: Schema.optional(sessionCreatedAtSchema),
      }),
      user: Schema.Struct({
        emailVerified: Schema.Boolean,
      }),
    })
  ),
  error: Schema.NullOr(Schema.Unknown),
});
const decodeSessionResponse = Schema.decodeUnknownOption(sessionResponseSchema);
type SessionResponse = typeof sessionResponseSchema.Type;
type SessionData = NonNullable<SessionResponse["data"]>;
type SessionCreatedAt = typeof sessionCreatedAtSchema.Type;

type AuthReturnLifecycleOptions = {
  readonly locale: Locale;
  readonly requireFreshSession?: boolean;
  /**
   * Where to continue after sign-in instead of the account. Anything but a
   * same-origin path is ignored.
   */
  readonly returnTo?: string;
};

export type SignInEmailFailure =
  /** The per-address cap on sign-in emails is reached. */
  | "address-limit"
  /** The browser sent too many auth requests; try again shortly. */
  | "rate-limited"
  | "failed";

export type SignInEmailResult =
  | {
      readonly status: "sent";
      /** True when the email also carries a sign-in code. */
      readonly signInCode: boolean;
    }
  | { readonly status: "failed"; readonly reason: SignInEmailFailure }
  /** A later send or a cancel replaced this request before it settled. */
  | { readonly status: "cancelled" };

export type SignInCodeVerification =
  | "verified"
  | "wrong"
  | "expired"
  | "too-many-attempts"
  | "failed";

export type AuthReturnLifecycle = {
  /** Stops the link hand-off and forgets the pending request. */
  readonly cancel: () => void;
  readonly sendSignInEmail: (email: string) => Promise<SignInEmailResult>;
  /**
   * Signs this tab in with a typed code. A verified code stops the link
   * hand-off, so a late link tab can't trigger a second navigation.
   */
  readonly verifySignInCode: (
    email: string,
    code: string
  ) => Promise<SignInCodeVerification>;
  /** Hard-navigates through the sign-in callback after a verified code. */
  readonly continueWithVerifiedCode: () => boolean;
  /**
   * Continues to the sign-in destination when this browser already holds a
   * usable session, such as after the link was opened in another tab.
   */
  readonly continueIfSignedIn: () => Promise<boolean>;
};

const authErrorSchema = Schema.Struct({
  status: Schema.optional(Schema.Finite),
  code: Schema.optional(Schema.String),
});
type AuthError = typeof authErrorSchema.Type;

const signInEmailResponseSchema = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({ signInCode: Schema.optional(Schema.Boolean) })
    )
  ),
  error: Schema.NullOr(authErrorSchema),
});
const decodeSignInEmailResponse = Schema.decodeUnknownOption(
  signInEmailResponseSchema
);
const codeSignInResponseSchema = Schema.Struct({
  error: Schema.NullOr(authErrorSchema),
});
const decodeCodeSignInResponse = Schema.decodeUnknownOption(
  codeSignInResponseSchema
);

const toSignInEmailFailure = ({
  status,
  code,
}: AuthError): SignInEmailFailure => {
  if (status !== 429) return "failed";
  return code === "SIGN_IN_EMAIL_LIMIT_REACHED"
    ? "address-limit"
    : "rate-limited";
};

const signInCodeRejections: Readonly<
  Record<
    string,
    {
      readonly verification: SignInCodeVerification;
      readonly reason: SignInCodeRejectionReason;
    }
  >
> = {
  INVALID_OTP: { verification: "wrong", reason: "wrong" },
  OTP_EXPIRED: { verification: "expired", reason: "expired" },
  TOO_MANY_ATTEMPTS: {
    verification: "too-many-attempts",
    reason: "too_many_attempts",
  },
};

const noop = () => undefined;

// Browser coordination APIs are best effort: a throwing API reads as absent.
const detectReturnWindowSupport = Option.liftThrowable(
  (): boolean =>
    Predicate.isFunction(globalThis.crypto?.randomUUID) &&
    Predicate.isFunction(globalThis.BroadcastChannel) &&
    Predicate.isFunction(globalThis.navigator?.locks?.request)
);

const generateAttemptId = Option.liftThrowable((): string | undefined => {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (!Predicate.isFunction(randomUUID)) return undefined;
  const attemptId = randomUUID.call(globalThis.crypto);
  return Predicate.isString(attemptId) ? attemptId : undefined;
});

const hasReturnWindowSupport = (): boolean =>
  Option.getOrElse(detectReturnWindowSupport(), () => false);

const createAttemptId = (): string | undefined =>
  Option.getOrUndefined(generateAttemptId());

const readSessionResponse = async (): Promise<SessionResponse | undefined> =>
  Option.getOrUndefined(
    decodeSessionResponse(
      await authClient.getSession({
        fetchOptions: { cache: "no-store" },
        query: { disableCookieCache: true },
      })
    )
  );

const toCreatedAtMillis = (value: SessionCreatedAt | undefined): number => {
  if (value instanceof Date) return value.getTime();
  return value === undefined ? Number.NaN : new Date(value).getTime();
};

const isFreshSession = (createdAt: SessionCreatedAt | undefined) => {
  const createdAtMillis = toCreatedAtMillis(createdAt);
  return (
    Number.isFinite(createdAtMillis) &&
    Date.now() - createdAtMillis < FRESH_SESSION_WINDOW_MS
  );
};

const isUsableSession = (
  value: SessionData | null,
  requireFreshSession: boolean
): boolean =>
  value !== null &&
  value.user.emailVerified === true &&
  (!requireFreshSession || isFreshSession(value.session.createdAt));

const hasAuthenticatedSession = (
  value: SessionResponse | undefined,
  requireFreshSession: boolean
) =>
  value !== undefined &&
  value.error === null &&
  isUsableSession(value.data, requireFreshSession);

// Refocusing is best effort and must not change the navigation result.
const focusWindow = Option.liftThrowable(() => globalThis.window?.focus?.());

const requestNavigation = Option.liftThrowable((path: string): boolean => {
  const replace = globalThis.window?.location?.replace;
  if (!Predicate.isFunction(replace)) return false;
  replace.call(globalThis.window.location, path);
  return true;
});

// Return-window cleanup is best effort.
const runCleanup = Option.liftThrowable((cleanup: () => void) => cleanup());

// A coordination failure falls back to the ordinary callback.
const listenForReturnSafely = Option.liftThrowable(listenForReturn);

const readUsableSession = async (requireFreshSession: boolean) => {
  try {
    return hasAuthenticatedSession(
      await readSessionResponse(),
      requireFreshSession
    );
  } catch {
    return false;
  }
};

export const createAuthReturnLifecycle = ({
  locale,
  requireFreshSession = false,
  returnTo,
}: AuthReturnLifecycleOptions): AuthReturnLifecycle => {
  const destination = getSignInDestination(locale, returnTo);
  const callbackPath = getAuthCallbackPath(locale, { returnTo });
  let currentCleanup: () => void = noop;
  let requestEpoch = 0;
  // The callback URL of the latest sign-in email, reused by code sign-in.
  let currentCallbackURL = callbackPath;
  let verifiedCallbackURL: string | undefined;
  // Every continuation (link hand-off, typed code, session check) leaves the
  // page at most once.
  let leaving = false;

  const leaveFor = (path: string, { focus }: { readonly focus: boolean }) => {
    if (leaving) return true;
    leaving = Option.getOrElse(requestNavigation(path), () => false);
    if (!leaving) return false;
    // A signed-in tab must not show this code step again after a sign-out.
    forgetSignInCodeRequest();
    if (focus) focusWindow();
    return true;
  };

  const dispose = () => {
    const cleanup = currentCleanup;
    currentCleanup = noop;
    runCleanup(cleanup);
  };

  const cancel = () => {
    requestEpoch += 1;
    dispose();
  };

  const sendSignInEmail = async (email: string): Promise<SignInEmailResult> => {
    const requestId = requestEpoch + 1;
    requestEpoch = requestId;
    dispose();

    let callbackURL = callbackPath;

    if (hasReturnWindowSupport()) {
      const attemptId = createAttemptId();
      if (attemptId !== undefined) {
        const cleanup = Option.getOrUndefined(
          listenForReturnSafely({
            attemptId,
            onReturn: async (signal) => {
              if (signal.aborted || requestEpoch !== requestId) return false;
              const signedIn = await readUsableSession(requireFreshSession);
              if (signal.aborted || requestEpoch !== requestId || !signedIn) {
                return false;
              }
              // The link tab hands off and closes, so this tab records it.
              if (!requireFreshSession) {
                recordSignInCompletion("link");
                noteEmailSignInForPasskeyPrompt();
              }
              return leaveFor(destination, { focus: true });
            },
            ttlMs: RETURN_LISTENER_TTL_MS,
          })
        );
        if (cleanup) {
          currentCleanup = cleanup;
          callbackURL = getAuthCallbackPath(locale, { attemptId, returnTo });
        }
      }
    }
    currentCallbackURL = callbackURL;

    let response: Option.Option<typeof signInEmailResponseSchema.Type>;
    try {
      response = decodeSignInEmailResponse(
        await authClient.signIn.magicLink({
          email,
          callbackURL,
          metadata: { locale },
        })
      );
    } catch {
      response = Option.none();
    }
    if (requestEpoch !== requestId) return { status: "cancelled" };
    if (Option.isSome(response) && response.value.error === null) {
      return {
        status: "sent",
        signInCode: response.value.data?.signInCode === true,
      };
    }
    dispose();
    return {
      status: "failed",
      reason: Option.match(response, {
        onNone: () => "failed",
        onSome: ({ error }) =>
          error === null ? "failed" : toSignInEmailFailure(error),
      }),
    };
  };

  const verifySignInCode = async (
    email: string,
    code: string
  ): Promise<SignInCodeVerification> => {
    const callbackURL = currentCallbackURL;
    let response: Option.Option<typeof codeSignInResponseSchema.Type>;
    try {
      response = decodeCodeSignInResponse(
        await authClient.signIn.emailOtp({ email, otp: code, callbackURL })
      );
    } catch {
      return "failed";
    }
    if (Option.isNone(response)) return "failed";
    const { error } = response.value;
    if (error !== null) {
      const rejection =
        error.code !== undefined &&
        Object.hasOwn(signInCodeRejections, error.code)
          ? signInCodeRejections[error.code]
          : undefined;
      if (rejection === undefined) return "failed";
      captureSignInCodeRejection(rejection.reason);
      return rejection.verification;
    }
    cancel();
    verifiedCallbackURL = callbackURL;
    return "verified";
  };

  const continueWithVerifiedCode = () => {
    if (verifiedCallbackURL === undefined) return false;
    if (!leaving) {
      recordSignInCompletion("code");
      noteEmailSignInForPasskeyPrompt();
    }
    return leaveFor(verifiedCallbackURL, { focus: false });
  };

  const continueIfSignedIn = async () => {
    if (leaving) return true;
    const requestId = requestEpoch;
    const signedIn = await readUsableSession(requireFreshSession);
    if (leaving) return true;
    // A cancel or a newer email while the session was read wins.
    if (requestEpoch !== requestId || !signedIn) return false;
    // The tab that opened the link records its own completion.
    cancel();
    return leaveFor(destination, { focus: false });
  };

  return {
    cancel,
    continueIfSignedIn,
    continueWithVerifiedCode,
    sendSignInEmail,
    verifySignInCode,
  };
};
