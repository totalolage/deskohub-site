"use client";

import { Option, Predicate, Schema } from "effect";
import {
  authCallbackReturnParam,
  encodeAuthCallbackReturnPath,
} from "@/features/account/auth-return-path";
import { getAccountPath } from "@/features/account/routes";
import type { Locale } from "@/features/i18n";
import { listenForReturn } from "@/shared/browser/return-window";
import { authClient } from "./auth.client";
import { noteEmailSignInForPasskeyPrompt } from "./passkey-prompt";
import {
  captureSignInCodeRejection,
  recordSignInCompletion,
  type SignInCodeRejectionReason,
} from "./sign-in-analytics";
import {
  forgetEmailSignInRequest,
  rememberEmailSignInRequest,
} from "./email-sign-in-request";

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
   * Where the sign-in lands instead of the account, already validated with
   * `parseAuthReturnPath`. Every continuation, the link's callback included,
   * goes there.
   */
  readonly returnPath?: string;
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
      /**
       * Correlates this tab with the link's callback tab; keep it with the
       * request so another page can resume the hand-off.
       */
      readonly attemptId?: string;
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
   * Continues to the return path, or the account, when this browser already
   * holds a usable session, such as after the link was opened in another
   * tab.
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
  returnPath,
}: AuthReturnLifecycleOptions): AuthReturnLifecycle => {
  const destination = returnPath ?? getAccountPath(locale);
  const callbackURLFor = (attemptId: string | undefined) => {
    const query = new URLSearchParams();
    if (attemptId !== undefined) query.set("attempt", attemptId);
    const encodedReturnPath =
      returnPath === undefined
        ? undefined
        : encodeAuthCallbackReturnPath(returnPath);
    if (encodedReturnPath !== undefined) {
      query.set(authCallbackReturnParam, encodedReturnPath);
    }
    const search = query.toString();
    return `/${locale}/auth/callback${search && `?${search}`}`;
  };
  let currentCleanup: () => void = noop;
  let requestEpoch = 0;
  // The callback URL of the latest sign-in email, reused by code sign-in.
  let currentCallbackURL = callbackURLFor(undefined);
  let verifiedCallbackURL: string | undefined;
  // Every continuation (link hand-off, typed code, session check) leaves the
  // page at most once.
  let leaving = false;

  const leaveFor = (path: string, { focus }: { readonly focus: boolean }) => {
    if (leaving) return true;
    leaving = Option.getOrElse(requestNavigation(path), () => false);
    if (!leaving) return false;
    // A signed-in tab must not show this code step again after a sign-out.
    forgetEmailSignInRequest();
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

  const sendSignInEmail = async (email: string): Promise<SignInEmailResult> => {
    const requestId = requestEpoch + 1;
    requestEpoch = requestId;
    dispose();

    let attemptId: string | undefined;
    if (hasReturnWindowSupport()) {
      const candidate = createAttemptId();
      if (
        candidate !== undefined &&
        listenForLinkReturn(candidate, requestId)
      ) {
        attemptId = candidate;
      }
    }
    const callbackURL = callbackURLFor(attemptId);
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
        ...(attemptId !== undefined && { attemptId }),
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
    resumeSignInEmail,
    continueIfSignedIn,
    continueWithVerifiedCode,
    sendSignInEmail,
    verifySignInCode,
  };
};

/**
 * Sends the sign-in email for a page that continues on the verify page
 * (`getAuthVerifyPath`), such as a checkout form: the sign-in lands on the
 * validated `returnPath`, and the request is stored for this tab so the
 * verify page takes over the link's hand-off and the code entry. Navigate
 * there once the result is `sent`.
 */
export const startEmailSignIn = async ({
  locale,
  email,
  returnPath,
}: {
  readonly locale: Locale;
  readonly email: string;
  readonly returnPath?: string;
}): Promise<SignInEmailResult> => {
  const lifecycle = createAuthReturnLifecycle({ locale, returnPath });
  const result = await lifecycle.sendSignInEmail(email);
  // The verify page listens for the hand-off from here on.
  lifecycle.cancel();
  if (result.status === "sent") {
    rememberEmailSignInRequest({
      email,
      requestedAt: Date.now(),
      signInCode: result.signInCode,
      attemptId: result.attemptId,
      returnPath,
    });
  }
  return result;
};
