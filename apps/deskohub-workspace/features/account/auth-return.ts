"use client";

import { Option, Predicate, Schema } from "effect";
import {
  getAuthCallbackPath,
  getSignInDestination,
} from "@/features/account/routes";
import type { Locale } from "@/features/i18n";
import { listenForReturn } from "@/shared/browser/return-window";
import { parseSameOriginPath } from "@/shared/utils/same-origin-path";
import { authClient } from "./auth.client";
import {
  type BrowserSignInCompletion,
  completeBrowserSignIn,
  leaveForSignInDestination,
} from "./browser-sign-in-completion";
import { rememberEmailSignInRequest } from "./email-sign-in-request";
import {
  captureSignInCodeRejection,
  type SignInCodeRejectionReason,
} from "./sign-in-analytics";

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
  /** BotID judged the request automated; continue in your own browser. */
  | "automated"
  /**
   * The given return path is not a same-origin path within
   * `maxSameOriginPathLength`, so no email was sent to land elsewhere.
   */
  | "invalid-return-path"
  | "failed";

export type SignInEmailResult =
  | {
      readonly status: "sent";
      /** True when the email also carries a sign-in code. */
      readonly signInCode: boolean;
      /**
       * Correlates this tab with the link's callback tab; keep it with the
       * request so another page can resume the hand-off.
       */
      readonly attemptId?: string;
    }
  /**
   * The address is an app-directory review login, which signs in with its
   * password instead; no email was sent.
   */
  | { readonly status: "password" }
  | { readonly status: "failed"; readonly reason: SignInEmailFailure }
  /** A later send or a cancel replaced this request before it settled. */
  | { readonly status: "cancelled" };

export type SignInCodeVerification =
  | "verified"
  | "wrong"
  | "expired"
  | "too-many-attempts"
  /** BotID judged the request automated; continue in your own browser. */
  | "automated"
  | "failed";

export type PasswordSignIn =
  | "signed-in"
  /** The email and password don't match. */
  | "wrong"
  /** The browser sent too many auth requests; try again shortly. */
  | "rate-limited"
  /** BotID judged the request automated; continue in your own browser. */
  | "automated"
  | "failed";

export type AuthReturnLifecycle = {
  /** Stops the link hand-off and forgets the pending request. */
  readonly cancel: () => void;
  readonly sendSignInEmail: (email: string) => Promise<SignInEmailResult>;
  /**
   * Takes over a sign-in email sent from another page of this tab: waits for
   * its link's hand-off and verifies its code against the same callback.
   */
  readonly resumeSignInEmail: (request: {
    readonly attemptId?: string;
  }) => void;
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
   * Signs this tab in with a review login's password, against the callback
   * of the latest sign-in email request. It stays on the page.
   */
  readonly signInWithPassword: (
    email: string,
    password: string
  ) => Promise<PasswordSignIn>;
  /** Hard-navigates through the sign-in callback after a password sign-in. */
  readonly continueWithPassword: () => boolean;
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
      Schema.Struct({
        signInCode: Schema.optional(Schema.Boolean),
        method: Schema.optional(Schema.Literal("password")),
      })
    )
  ),
  error: Schema.NullOr(authErrorSchema),
});
const decodeSignInEmailResponse = Schema.decodeUnknownOption(
  signInEmailResponseSchema
);
const signInResponseSchema = Schema.Struct({
  error: Schema.NullOr(authErrorSchema),
});
const decodeSignInResponse = Schema.decodeUnknownOption(signInResponseSchema);

const toPasswordSignIn = ({ status, code }: AuthError): PasswordSignIn => {
  if (code === "BOT_DETECTED") return "automated";
  if (status === 429) return "rate-limited";
  return code === "INVALID_EMAIL_OR_PASSWORD" ? "wrong" : "failed";
};

const toSignInEmailFailure = ({
  status,
  code,
}: AuthError): SignInEmailFailure => {
  if (code === "BOT_DETECTED") return "automated";
  if (status !== 429) return "failed";
  return code === "SIGN_IN_EMAIL_LIMIT_REACHED"
    ? "address-limit"
    : "rate-limited";
};

type SignInEmailResponse = typeof signInEmailResponseSchema.Type;

/** A thrown or undecodable response reads as none. */
const requestSignInEmail = async ({
  email,
  callbackURL,
  locale,
}: {
  readonly email: string;
  readonly callbackURL: string;
  readonly locale: Locale;
}): Promise<Option.Option<SignInEmailResponse>> => {
  try {
    return decodeSignInEmailResponse(
      await authClient.signIn.magicLink({
        email,
        callbackURL,
        metadata: { locale },
      })
    );
  } catch {
    return Option.none();
  }
};

const toSignInEmailResult = (
  response: Option.Option<SignInEmailResponse>,
  attemptId: string | undefined
): SignInEmailResult => {
  if (Option.isNone(response)) return { status: "failed", reason: "failed" };
  const { data, error } = response.value;
  if (error !== null) {
    return { status: "failed", reason: toSignInEmailFailure(error) };
  }
  if (data?.method === "password") return { status: "password" };
  return {
    status: "sent",
    signInCode: data?.signInCode === true,
    ...(attemptId !== undefined && { attemptId }),
  };
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
  const callbackURLFor = (attemptId: string | undefined) =>
    getAuthCallbackPath(locale, { attemptId, returnTo });
  let currentCleanup: () => void = noop;
  let requestEpoch = 0;
  // The callback URL of the latest sign-in email, reused by code sign-in.
  let currentCallbackURL = callbackURLFor(undefined);
  let verifiedCallbackURL: string | undefined;
  let passwordCallbackURL: string | undefined;
  // Every continuation (link hand-off, typed code, password, session check)
  // leaves the page at most once, and only the first one that leaves
  // completes the sign-in.
  let leaving = false;

  const leaveFor = (
    path: string,
    {
      completion,
      focus,
    }: {
      readonly completion?: BrowserSignInCompletion;
      readonly focus: boolean;
    }
  ) => {
    if (leaving) return true;
    if (completion !== undefined) completeBrowserSignIn(completion);
    leaving = leaveForSignInDestination(path);
    if (leaving && focus) focusWindow();
    return leaving;
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

  // Waits for the link's callback tab to hand off; reports whether the
  // listener started.
  const listenForLinkReturn = (attemptId: string, requestId: number) => {
    const cleanup = Option.getOrUndefined(
      listenForReturnSafely({
        attemptId,
        onReturn: async (signal) => {
          if (signal.aborted || requestEpoch !== requestId) return false;
          const signedIn = await readUsableSession(requireFreshSession);
          if (signal.aborted || requestEpoch !== requestId || !signedIn) {
            return false;
          }
          // The link tab hands off and closes, so this tab completes the
          // sign-in; a reauthentication only continues.
          return leaveFor(destination, {
            completion: requireFreshSession
              ? undefined
              : { method: "link", via: "hand-off" },
            focus: true,
          });
        },
        ttlMs: RETURN_LISTENER_TTL_MS,
      })
    );
    if (!cleanup) return false;
    currentCleanup = cleanup;
    return true;
  };

  const resumeSignInEmail = ({
    attemptId,
  }: {
    readonly attemptId?: string;
  }) => {
    const requestId = requestEpoch + 1;
    requestEpoch = requestId;
    dispose();
    const listening =
      attemptId !== undefined &&
      hasReturnWindowSupport() &&
      listenForLinkReturn(attemptId, requestId);
    currentCallbackURL = callbackURLFor(listening ? attemptId : undefined);
  };

  // Starts the link-return listener for a fresh attempt; the attempt ID is
  // undefined when this browser cannot hand off between tabs.
  const listenForNewLinkReturn = (requestId: number): string | undefined => {
    if (!hasReturnWindowSupport()) return undefined;
    const candidate = createAttemptId();
    return candidate !== undefined && listenForLinkReturn(candidate, requestId)
      ? candidate
      : undefined;
  };

  const sendSignInEmail = async (email: string): Promise<SignInEmailResult> => {
    const requestId = requestEpoch + 1;
    requestEpoch = requestId;
    dispose();

    const attemptId = listenForNewLinkReturn(requestId);
    const callbackURL = callbackURLFor(attemptId);
    currentCallbackURL = callbackURL;

    const response = await requestSignInEmail({
      email,
      callbackURL,
      locale,
    });
    if (requestEpoch !== requestId) return { status: "cancelled" };
    const result = toSignInEmailResult(response, attemptId);
    if (result.status === "password") {
      // No link is on its way, so nothing hands off from another tab.
      dispose();
      currentCallbackURL = callbackURLFor(undefined);
    } else if (result.status === "failed") {
      dispose();
    }
    return result;
  };

  const verifySignInCode = async (
    email: string,
    code: string
  ): Promise<SignInCodeVerification> => {
    const callbackURL = currentCallbackURL;
    let response: Option.Option<typeof signInResponseSchema.Type>;
    try {
      response = decodeSignInResponse(
        await authClient.signIn.emailOtp({ email, otp: code, callbackURL })
      );
    } catch {
      return "failed";
    }
    if (Option.isNone(response)) return "failed";
    const { error } = response.value;
    if (error !== null) {
      if (error.code === "BOT_DETECTED") return "automated";
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

  const continueWithVerifiedCode = () =>
    verifiedCallbackURL !== undefined &&
    leaveFor(verifiedCallbackURL, {
      completion: { method: "code" },
      focus: false,
    });

  const signInWithPassword = async (
    email: string,
    password: string
  ): Promise<PasswordSignIn> => {
    const callbackURL = currentCallbackURL;
    let response: Option.Option<typeof signInResponseSchema.Type>;
    try {
      response = decodeSignInResponse(
        await authClient.signIn.email({ email, password, callbackURL })
      );
    } catch {
      return "failed";
    }
    if (Option.isNone(response)) return "failed";
    const { error } = response.value;
    if (error !== null) return toPasswordSignIn(error);
    cancel();
    passwordCallbackURL = callbackURL;
    return "signed-in";
  };

  const continueWithPassword = () =>
    passwordCallbackURL !== undefined &&
    leaveFor(passwordCallbackURL, { focus: false });

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
    resumeSignInEmail,
    continueIfSignedIn,
    continueWithVerifiedCode,
    continueWithPassword,
    sendSignInEmail,
    signInWithPassword,
    verifySignInCode,
  };
};

/**
 * Sends the sign-in email for a page that continues on the verify page
 * (`getAuthVerifyPath`), such as a checkout form: the sign-in lands on the
 * same-origin `returnTo`, and the request is stored for this tab so the
 * verify page takes over the link's hand-off and the code entry, or the
 * password entry of a review login. Navigate there once the result is `sent`
 * or `password`. A `returnTo` that isn't a valid return path fails with
 * `invalid-return-path` before anything is sent.
 */
export const startEmailSignIn = async ({
  locale,
  email,
  returnTo,
}: {
  readonly locale: Locale;
  readonly email: string;
  readonly returnTo?: string;
}): Promise<SignInEmailResult> => {
  const returnPath = parseSameOriginPath(returnTo);
  if (returnTo !== undefined && returnPath === undefined) {
    return { status: "failed", reason: "invalid-return-path" };
  }
  const lifecycle = createAuthReturnLifecycle({
    locale,
    returnTo: returnPath,
  });
  const result = await lifecycle.sendSignInEmail(email);
  // The verify page listens for the hand-off from here on.
  lifecycle.cancel();
  if (result.status === "sent") {
    rememberEmailSignInRequest({
      email,
      requestedAt: Date.now(),
      signInCode: result.signInCode,
      attemptId: result.attemptId,
      returnTo: returnPath,
    });
  }
  if (result.status === "password") {
    rememberEmailSignInRequest({
      email,
      requestedAt: Date.now(),
      method: "password",
      returnTo: returnPath,
    });
  }
  return result;
};
