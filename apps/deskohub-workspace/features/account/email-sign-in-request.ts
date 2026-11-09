"use client";

import { Option, Schema } from "effect";
import { useSyncExternalStore } from "react";
import {
  readSessionStorageItem,
  writeSessionStorageItem,
} from "@/shared/browser/session-storage";

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
  /**
   * The address is a review login that signs in with its password; no email
   * was sent.
   */
  method: Schema.optional(Schema.Literal("password")),
  /** The validated path the sign-in lands on instead of the account. */
  returnTo: Schema.optional(Schema.String),
});
const decodeEmailSignInRequest = Schema.decodeUnknownOption(
  Schema.fromJsonString(emailSignInRequestSchema)
);

export type EmailSignInRequest = typeof emailSignInRequestSchema.Type;

/** Whether the request's email carries a sign-in code to type. */
export const hasSignInCode = (request: EmailSignInRequest) =>
  request.method !== "password" && request.signInCode !== false;

/** Whether the request's address signs in with a password instead. */
export const signsInWithPassword = (request: EmailSignInRequest) =>
  request.method === "password";

// The request this document set: it outlives a forgotten stored copy and
// covers a tab without storage. Without one, the stored request counts, such
// as one a reload or another page left.
let currentRaw: string | null = null;
let decodedRaw: string | null = null;
let decodedRequest: EmailSignInRequest | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => {
  const raw = currentRaw ?? readSessionStorageItem(storageKey);
  if (raw !== decodedRaw) {
    decodedRaw = raw;
    decodedRequest =
      raw === null ? null : Option.getOrNull(decodeEmailSignInRequest(raw));
  }
  return decodedRequest;
};

// Absent during server rendering and hydration.
const getServerSnapshot = () => undefined;

const isUsable = (request: EmailSignInRequest) =>
  Date.now() - request.requestedAt < EMAIL_SIGN_IN_REQUEST_TTL_MS;

/**
 * The pending sign-in email request of this tab, shared by every page that
 * shows it, such as the sign-in card and the verify page. It never enters
 * the URL and reads as absent during server rendering and hydration;
 * `restored` tells that apart from no request.
 */
export const useEmailSignInRequest = () => {
  const stored = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );
  const request = stored && isUsable(stored) ? stored : null;
  return [request, rememberEmailSignInRequest, stored !== undefined] as const;
};

/**
 * Replaces this tab's pending request, such as after a page sent the email
 * and before it moves to the verify page; null drops it.
 */
export const rememberEmailSignInRequest = (
  request: EmailSignInRequest | null
) => {
  const raw = request === null ? null : JSON.stringify(request);
  currentRaw = raw;
  writeSessionStorageItem(storageKey, raw);
  for (const listener of listeners) listener();
};

/**
 * Drops the stored request so a reload no longer restores it, for a tab that
 * is signed in and leaving the page; the step on screen stays.
 */
export const forgetEmailSignInRequest = () => {
  writeSessionStorageItem(storageKey, null);
};
