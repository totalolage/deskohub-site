"use client";

import { Option, Schema } from "effect";
import {
  readLocalStorageItem,
  writeLocalStorageItem,
} from "@/shared/browser/local-storage";
import {
  readSessionStorageItem,
  writeSessionStorageItem,
} from "@/shared/browser/session-storage";
import { canCreatePasskeys } from "@/shared/browser/webauthn-capabilities";

/*
 * When the account page offers a passkey: right after an email sign-in in
 * this tab, on a browser that can create one, unless the customer declined
 * the offer on this device or this browser already holds a passkey for the
 * account. The device markers live in localStorage keyed by the opaque
 * account ID; they are product preferences, not analytics, so they don't
 * depend on consent.
 */

const emailSignInStorageKey = "deskohub:passkey-prompt-email-sign-in";
const dismissedStorageKey = (accountId: string) =>
  `deskohub:passkey-prompt-dismissed:${accountId}`;
const heldStorageKey = (accountId: string) =>
  `deskohub:passkey-held:${accountId}`;
const presentMarker = "1";

// Matches the server's fresh-session window for adding a passkey: a later
// offer would only lead to a re-authentication.
const EMAIL_SIGN_IN_TTL_MS = 10 * 60 * 1000;

const decodeNotedAt = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ notedAt: Schema.Finite }))
);

/** Notes an email (link or code) sign-in in this tab for the account page. */
export const noteEmailSignInForPasskeyPrompt = (): void => {
  writeSessionStorageItem(
    emailSignInStorageKey,
    JSON.stringify({ notedAt: Date.now() })
  );
};

/** Reads and forgets this tab's email sign-in note, so it offers once. */
const takeEmailSignIn = (): boolean => {
  const raw = readSessionStorageItem(emailSignInStorageKey);
  writeSessionStorageItem(emailSignInStorageKey, null);
  if (raw === null) return false;
  return Option.match(decodeNotedAt(raw), {
    onNone: () => false,
    onSome: ({ notedAt }) => Date.now() - notedAt < EMAIL_SIGN_IN_TTL_MS,
  });
};

/** "Not now", close, or Escape: never offer it on this device again. */
export const dismissPasskeyPrompt = (accountId: string): void => {
  writeLocalStorageItem(dismissedStorageKey(accountId), presentMarker);
};

/** This browser created or used a passkey for the account. */
export const rememberPasskeyOnThisBrowser = (accountId: string): void => {
  writeLocalStorageItem(heldStorageKey(accountId), presentMarker);
};

/** The account has no passkeys left, so this browser holds none for it. */
export const forgetPasskeyOnThisBrowser = (accountId: string): void => {
  writeLocalStorageItem(heldStorageKey(accountId), null);
};

/**
 * Decides once per email sign-in whether the account page offers a passkey.
 * Pass `accountHasPasskeys: false` when the account's passkey list is known
 * to be empty; a stale "holds one" marker is then forgotten.
 */
export const shouldOfferPasskeyPrompt = async ({
  accountId,
  accountHasPasskeys,
}: {
  readonly accountId: string;
  readonly accountHasPasskeys: boolean | undefined;
}): Promise<boolean> => {
  if (!takeEmailSignIn()) return false;
  if (readLocalStorageItem(dismissedStorageKey(accountId)) !== null) {
    return false;
  }
  if (accountHasPasskeys === false) forgetPasskeyOnThisBrowser(accountId);
  else if (readLocalStorageItem(heldStorageKey(accountId)) !== null) {
    return false;
  }
  return canCreatePasskeys();
};
