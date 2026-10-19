"use client";

import { useEffect } from "react";
import { forgetEmailSignInRequest } from "@/features/account/email-sign-in-request";
import { noteEmailSignInForPasskeyPrompt } from "@/features/account/passkey-prompt";
import {
  getSignInDestination,
  readAuthCallbackReturnTo,
  signInAttemptParam,
  signInCallbackReturnParam,
} from "@/features/account/routes";
import { recordSignInCompletion } from "@/features/account/sign-in-analytics";
import type { Locale } from "@/features/i18n";
import { handOffReturn } from "@/shared/browser/return-window";
import { AuthCallbackLoading } from "./auth-callback-loading";

/**
 * Finishes a signed-in callback: hands the return over to the tab that sent
 * the email when one in this browser answers, otherwise continues here.
 * `returning` says whether the callback carries a valid return target.
 */
export function AuthCallbackRedirect({
  locale,
  returning,
}: {
  readonly locale: Locale;
  readonly returning: boolean;
}) {
  useEffect(() => {
    let active = true;
    let attemptId = "";
    let hasError = false;
    let returnTo: string | undefined;
    try {
      const searchParams = new URLSearchParams(window.location.search);
      attemptId = searchParams.get(signInAttemptParam) ?? "";
      hasError = searchParams.has("error");
      returnTo = readAuthCallbackReturnTo(
        searchParams.get(signInCallbackReturnParam)
      );
    } catch {
      // A missing query is handled by the shared handoff validator.
    }
    // Anyone can craft this URL, so the return target is validated again.
    const destination = getSignInDestination(locale, returnTo);
    const leaveForDestination = () => {
      if (!active) return;
      try {
        window.location.replace(destination);
      } catch {
        // The document is already leaving or the browser blocked navigation.
      }
    };
    // No other tab took the hand-off, so this tab finishes the sign-in. A
    // typed code passes through here too and has already recorded itself.
    const completeSignIn = () => {
      if (!active) return;
      recordSignInCompletion("link", { keepRecorded: true });
      noteEmailSignInForPasskeyPrompt();
      forgetEmailSignInRequest();
      leaveForDestination();
    };

    if (hasError) {
      leaveForDestination();
      return () => {
        active = false;
      };
    }

    let handoff: Promise<boolean>;
    try {
      handoff = handOffReturn({ attemptId });
    } catch {
      completeSignIn();
      return () => {
        active = false;
      };
    }

    void handoff
      .then((handled) => {
        if (!active) return;
        if (!handled) {
          completeSignIn();
          return;
        }

        let closed = false;
        try {
          window.close();
          closed = window.closed === true;
        } catch {
          // Fall back to navigation when closing is unavailable or blocked.
        }
        // The tab that took the hand-off recorded the sign-in.
        if (!closed) leaveForDestination();
      })
      .catch(completeSignIn);

    return () => {
      active = false;
    };
  }, [locale]);

  return <AuthCallbackLoading locale={locale} signedIn={{ returning }} />;
}
