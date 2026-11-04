"use client";

import { leaveDocument } from "@/shared/browser/document-navigation";
import { forgetEmailSignInRequest } from "./email-sign-in-request";
import {
  noteEmailSignInForPasskeyPrompt,
  rememberPasskeyOnThisBrowser,
} from "./passkey-prompt";
import { recordSignInCompletion } from "./sign-in-analytics";

/**
 * How a sign-in finished in this tab.
 *
 * - `passkey`: a passkey ceremony signed the tab in, as `accountId` when the
 *   server named the account.
 * - `link` through the `callback`: the link's callback page finished the
 *   sign-in in its own tab because no other tab took the hand-off. A typed
 *   code also passes through the callback and has already recorded itself.
 * - `link` through a `hand-off`: the link's callback tab handed the sign-in
 *   back to the tab that sent the email.
 * - `code`: a typed sign-in code signed the tab in.
 *
 * A reauthentication confirms a customer who is already signed in, so it is
 * not a completion.
 */
export type BrowserSignInCompletion =
  | { readonly method: "passkey"; readonly accountId?: string }
  | { readonly method: "link"; readonly via: "callback" | "hand-off" }
  | { readonly method: "code" };

/**
 * Does the bookkeeping for a sign-in that finished in this tab. Call it once
 * per sign-in, before `leaveForSignInDestination`.
 *
 * - Records the completion for `captureRecordedSignInCompletion` on the next
 *   page, and only with analytics consent. The callback keeps an earlier
 *   fresh record, so a code passing through it isn't counted as a link.
 * - An email sign-in (link or code) lets the account page offer a passkey
 *   once; a passkey sign-in remembers that this browser holds a passkey for
 *   the account.
 * - A passkey or callback completion forgets this tab's pending sign-in email
 *   request at once, because the tab is signed in even if it then stays: a
 *   cancelled passkey attempt keeps the session on the page that cancelled
 *   it. A code or hand-off completion leaves that to
 *   `leaveForSignInDestination`, so a blocked navigation keeps the step.
 */
export const completeBrowserSignIn = (
  completion: BrowserSignInCompletion
): void => {
  switch (completion.method) {
    case "passkey":
      if (completion.accountId !== undefined) {
        rememberPasskeyOnThisBrowser(completion.accountId);
      }
      recordSignInCompletion("passkey");
      forgetEmailSignInRequest();
      return;
    case "link":
      if (completion.via === "callback") {
        recordSignInCompletion("link", { keepRecorded: true });
        noteEmailSignInForPasskeyPrompt();
        forgetEmailSignInRequest();
        return;
      }
      recordSignInCompletion("link");
      noteEmailSignInForPasskeyPrompt();
      return;
    case "code":
      recordSignInCompletion("code");
      noteEmailSignInForPasskeyPrompt();
      return;
  }
};

/**
 * Replaces this signed-in document with `destination`, a sign-in destination
 * or the sign-in callback, and reports whether the browser accepted the
 * navigation. Only then does it forget this tab's pending sign-in email
 * request, so a signed-in tab doesn't show that code step again after a
 * sign-out. Callers that may continue more than once keep their own
 * one-navigation guard.
 */
export const leaveForSignInDestination = (destination: string): boolean => {
  if (!leaveDocument(destination, { replace: true })) return false;
  forgetEmailSignInRequest();
  return true;
};
