"use client";

import { Option, Schema } from "effect";
import { useState } from "react";
import {
  readSessionStorageItem,
  writeSessionStorageItem,
} from "@/shared/browser/session-storage";
import { useClientReady } from "@/shared/browser/use-client-ready";

/** A request stays usable for as long as its link and code (10 minutes). */
const EMAIL_SIGN_IN_REQUEST_TTL_MS = 10 * 60 * 1000;
export const SIGN_IN_CODE_LENGTH = 6;

const storageKey = "deskohub:account-sign-in-code";

const emailSignInRequestSchema = Schema.Struct({
  email: Schema.String,
  requestedAt: Schema.Finite,
  /**
   * Whether the email carries a sign-in code. Requests stored before
   * link-only requests were kept always did.
   */
  signInCode: Schema.optional(Schema.Boolean),
  /** Correlates this tab with the link's callback tab. */
  attemptId: Schema.optional(Schema.String),
  /** The validated path the sign-in lands on instead of the account. */
  returnPath: Schema.optional(Schema.String),
});
const decodeEmailSignInRequest = Schema.decodeUnknownOption(
  Schema.fromJsonString(emailSignInRequestSchema)
);

export type EmailSignInRequest = typeof emailSignInRequestSchema.Type;

/** Whether the request's email carries a sign-in code to type. */
export const hasSignInCode = (request: EmailSignInRequest) =>
  request.signInCode !== false;

const readStoredEmailSignInRequest = (): EmailSignInRequest | null => {
  const raw = readSessionStorageItem(storageKey);
  const request =
    raw === null ? null : Option.getOrNull(decodeEmailSignInRequest(raw));
  return request !== null &&
    Date.now() - request.requestedAt < EMAIL_SIGN_IN_REQUEST_TTL_MS
    ? request
    : null;
};

/**
 * The pending sign-in email request of this tab. It lives in React state and
 * is mirrored to sessionStorage on a best-effort basis, so only restoring the
 * request after a reload or on another page, such as the verify page,
 * depends on storage. It never enters the URL and reads as absent during
 * server rendering and hydration; `restored` tells the two apart.
 */
export const useEmailSignInRequest = () => {
  const clientReady = useClientReady();
  const [{ restored, request }, setState] = useState<{
    readonly restored: boolean;
    readonly request: EmailSignInRequest | null;
  }>({ restored: false, request: null });

  // Restore the stored request once, in the first render after hydration.
  if (clientReady && !restored) {
    setState({ restored: true, request: readStoredEmailSignInRequest() });
  }

  const updateRequest = (next: EmailSignInRequest | null) => {
    setState({ restored: true, request: next });
    rememberEmailSignInRequest(next);
  };

  return [request, updateRequest, restored] as const;
};

/**
 * Stores this tab's pending request, for a page that sends the email and
 * then moves to the verify page; null forgets it.
 */
export const rememberEmailSignInRequest = (
  request: EmailSignInRequest | null
) => {
  writeSessionStorageItem(
    storageKey,
    request === null ? null : JSON.stringify(request)
  );
};

/**
 * Drops the stored request so a reload no longer restores it, for a tab that
 * is signed in and leaving the page; the step on screen stays.
 */
export const forgetEmailSignInRequest = () => {
  rememberEmailSignInRequest(null);
};
