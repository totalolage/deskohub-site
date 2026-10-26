"use client";

import { Option, Schema } from "effect";
import { captureAnalyticsEvent } from "@/features/cookie-consent/analytics-events";
import {
  readSessionStorageItem,
  writeSessionStorageItem,
} from "@/shared/browser/session-storage";
import { isConsentCategoryAcceptedInCookie } from "@/shared/utils/consent-cookie";

/** A customer finished signing in; `method` says how. */
export const SIGN_IN_COMPLETED_EVENT = "sign-in completed";
/** The server refused a typed sign-in code; `reason` says why. */
export const SIGN_IN_CODE_REJECTED_EVENT = "sign-in code rejected";
/** A customer created a passkey; `source` says where they started. */
export const PASSKEY_ADDED_EVENT = "passkey added";
/** A customer deleted one of their passkeys. */
export const PASSKEY_REMOVED_EVENT = "passkey removed";
/** A customer declined the post-sign-in passkey prompt on this device. */
export const PASSKEY_PROMPT_DISMISSED_EVENT = "passkey prompt dismissed";

export type SignInMethod = "link" | "code" | "passkey";
/** The post-sign-in prompt or the Sign-in & security section. */
export type PasskeyAddedSource = "prompt" | "settings";
export type SignInCodeRejectionReason =
  | "wrong"
  | "expired"
  | "too_many_attempts";

const completionStorageKey = "deskohub:account-sign-in-completion";
// Long enough for the callback and account page to load and settle identity.
const COMPLETION_TTL_MS = 5 * 60 * 1000;

const recordedCompletionSchema = Schema.Struct({
  method: Schema.Literals(["link", "code", "passkey"]),
  recordedAt: Schema.Finite,
});
const decodeRecordedCompletion = Schema.decodeUnknownOption(
  Schema.fromJsonString(recordedCompletionSchema)
);

const hasAnalyticsConsent = () =>
  globalThis.document !== undefined &&
  isConsentCategoryAcceptedInCookie(globalThis.document.cookie, "analytics");

const readRecordedMethod = (): SignInMethod | undefined => {
  const raw = readSessionStorageItem(completionStorageKey);
  if (raw === null) return undefined;
  return Option.match(decodeRecordedCompletion(raw), {
    onNone: () => undefined,
    onSome: ({ method, recordedAt }) =>
      Date.now() - recordedAt < COMPLETION_TTL_MS ? method : undefined,
  });
};

/**
 * Notes a finished sign-in in this tab. The new account identity settles only
 * after the next page load, and an event captured now would go out under the
 * identity analytics settles on first, so the completion event is captured
 * later by
 * `captureRecordedSignInCompletion`. Without analytics consent nothing is
 * stored. `keepRecorded` leaves an earlier fresh record (a code sign-in that
 * passes through the link callback) in place.
 */
export const recordSignInCompletion = (
  method: SignInMethod,
  { keepRecorded = false }: { readonly keepRecorded?: boolean } = {}
): void => {
  if (!hasAnalyticsConsent()) return;
  if (keepRecorded && readRecordedMethod() !== undefined) return;
  writeSessionStorageItem(
    completionStorageKey,
    JSON.stringify({ method, recordedAt: Date.now() })
  );
};

/**
 * Captures and forgets this tab's recorded sign-in completion. Call it once
 * PostHog is ready for the signed-in account identity.
 */
export const captureRecordedSignInCompletion = (): void => {
  const method = readRecordedMethod();
  writeSessionStorageItem(completionStorageKey, null);
  if (method === undefined) return;
  captureAnalyticsEvent(SIGN_IN_COMPLETED_EVENT, { method });
};

export const captureSignInCodeRejection = (
  reason: SignInCodeRejectionReason
): void => captureAnalyticsEvent(SIGN_IN_CODE_REJECTED_EVENT, { reason });

export const capturePasskeyAdded = (source: PasskeyAddedSource): void =>
  captureAnalyticsEvent(PASSKEY_ADDED_EVENT, { source });

export const capturePasskeyRemoved = (): void =>
  captureAnalyticsEvent(PASSKEY_REMOVED_EVENT);

export const capturePasskeyPromptDismissed = (): void =>
  captureAnalyticsEvent(PASSKEY_PROMPT_DISMISSED_EVENT);
