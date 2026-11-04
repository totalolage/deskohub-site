"use client";

import { useEffect } from "react";
import {
  completeBrowserSignIn,
  leaveForSignInDestination,
} from "@/features/account/browser-sign-in-completion";
import {
  getSignInDestination,
  readAuthCallbackReturnTo,
  signInAttemptParam,
  signInCallbackReturnParam,
} from "@/features/account/routes";
import type { Locale } from "@/features/i18n";
import { leaveDocument } from "@/shared/browser/document-navigation";
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
    // A failed sign-in, or one another tab took over, leaves this tab's
    // pending request alone.
    const leaveForDestination = () => {
      if (active) leaveDocument(destination, { replace: true });
    };
    // No other tab took the hand-off, so this tab finishes the sign-in.
    const completeSignIn = () => {
      if (!active) return;
      completeBrowserSignIn({ method: "link", via: "callback" });
      leaveForSignInDestination(destination);
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
