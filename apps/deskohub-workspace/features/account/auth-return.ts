"use client";

import { Option, Predicate, Schema } from "effect";
import type { Locale } from "@/features/i18n";
import type { ReferralCode } from "@/features/referrals/client";
import { listenForReturn } from "@/shared/browser/return-window";
import { authClient } from "./auth.client";

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
  readonly referralCode?: ReferralCode;
};

export type AuthReturnLifecycle = {
  readonly cancel: () => void;
  readonly sendMagicLink: (
    email: string
  ) => Promise<Awaited<ReturnType<typeof authClient.signIn.magicLink>>>;
};

const noop = () => undefined;

const hasReturnWindowSupport = () => {
  try {
    return (
      Predicate.isFunction(globalThis.crypto?.randomUUID) &&
      Predicate.isFunction(globalThis.BroadcastChannel) &&
      Predicate.isFunction(globalThis.navigator?.locks?.request)
    );
  } catch {
    return false;
  }
};

const createAttemptId = (): string | undefined => {
  try {
    const randomUUID = globalThis.crypto?.randomUUID;
    if (!Predicate.isFunction(randomUUID)) return undefined;
    const attemptId = randomUUID.call(globalThis.crypto);
    return Predicate.isString(attemptId) ? attemptId : undefined;
  } catch {
    return undefined;
  }
};

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

const focusWindow = () => {
  try {
    globalThis.window?.focus?.();
  } catch {
    // Refocusing is best effort and must not change the navigation result.
  }
};

const accountPath = (locale: Locale, referralCode?: ReferralCode) => {
  if (referralCode === undefined) return `/${locale}/account`;
  const searchParams = new URLSearchParams({ ref: referralCode });
  return `/${locale}/account?${searchParams.toString()}`;
};

const navigateToAccount = (locale: Locale, referralCode?: ReferralCode) => {
  try {
    const replace = globalThis.window?.location?.replace;
    if (!Predicate.isFunction(replace)) return false;
    replace.call(globalThis.window.location, accountPath(locale, referralCode));
  } catch {
    return false;
  }
  focusWindow();
  return true;
};

export const createAuthReturnLifecycle = ({
  locale,
  referralCode,
  requireFreshSession = false,
}: AuthReturnLifecycleOptions): AuthReturnLifecycle => {
  let currentCleanup: () => void = noop;
  let requestEpoch = 0;

  const dispose = () => {
    const cleanup = currentCleanup;
    currentCleanup = noop;
    try {
      cleanup();
    } catch {
      // Return-window cleanup is best effort.
    }
  };

  const cancel = () => {
    requestEpoch += 1;
    dispose();
  };

  const sendMagicLink = async (email: string) => {
    const requestId = requestEpoch + 1;
    requestEpoch = requestId;
    dispose();

    const callbackPath = `/${locale}/auth/callback`;
    const makeCallbackURL = (attemptId?: string) => {
      const searchParams = new URLSearchParams();
      if (attemptId !== undefined) searchParams.set("attempt", attemptId);
      if (referralCode !== undefined) searchParams.set("ref", referralCode);
      const query = searchParams.toString();
      return query.length === 0 ? callbackPath : `${callbackPath}?${query}`;
    };
    let callbackURL = makeCallbackURL();

    if (hasReturnWindowSupport()) {
      const attemptId = createAttemptId();
      if (attemptId !== undefined) {
        try {
          const cleanup = listenForReturn({
            attemptId,
            onReturn: async (signal) => {
              if (signal.aborted || requestEpoch !== requestId) return false;

              let sessionResponse: SessionResponse | undefined;
              try {
                sessionResponse = await readSessionResponse();
              } catch {
                return false;
              }
              if (
                signal.aborted ||
                requestEpoch !== requestId ||
                !hasAuthenticatedSession(sessionResponse, requireFreshSession)
              ) {
                return false;
              }
              if (signal.aborted || requestEpoch !== requestId) return false;
              return navigateToAccount(locale, referralCode);
            },
            ttlMs: RETURN_LISTENER_TTL_MS,
          });
          if (cleanup) {
            currentCleanup = cleanup;
            callbackURL = makeCallbackURL(attemptId);
          }
        } catch {
          // A coordination failure falls back to the ordinary callback.
        }
      }
    }

    try {
      const result = await authClient.signIn.magicLink({
        email,
        callbackURL,
        metadata: { locale },
      });
      if (requestEpoch === requestId && result.error) dispose();
      return result;
    } catch (cause) {
      if (requestEpoch === requestId) dispose();
      throw cause;
    }
  };

  return { cancel, sendMagicLink };
};
