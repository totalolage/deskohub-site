"use client";

import { useEffect } from "react";
import type { AuthReturnLifecycle } from "@/features/account/auth-return";
import { SignInCodeStep } from "@/features/account/components/sign-in-code-step";
import {
  type EmailSignInRequest,
  hasSignInCode,
} from "@/features/account/email-sign-in-request";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { maskEmailAddress } from "@/shared/utils";

type SignInEmailSentStepProps = {
  readonly locale: Locale;
  readonly authReturn: AuthReturnLifecycle;
  readonly request: EmailSignInRequest;
  /** Replaces the request after a new email, or drops it. */
  readonly onRequestChange: (request: EmailSignInRequest) => void;
  readonly onUseDifferentEmail: () => void;
  /** Receives the step's heading, which takes focus after a view change. */
  readonly headingRef?: (element: HTMLElement | null) => void;
};

/**
 * What a tab shows once its sign-in email is on the way: the code entry
 * while the email carries a code (`login_email_code`), otherwise the
 * link-only inbox instructions. Both say which browser the sign-in continues
 * in, because a link signs in only the browser that opens it: an assistant
 * booking in its own browser isn't signed in by a link opened elsewhere.
 */
export function SignInEmailSentStep({
  locale,
  authReturn,
  request,
  onRequestChange,
  onUseDifferentEmail,
  headingRef,
}: SignInEmailSentStepProps) {
  // The link may be opened in another tab after this one reloaded and lost
  // its hand-off listener; coming back to this tab then continues.
  useEffect(() => {
    const continueIfSignedIn = () => {
      if (document.visibilityState !== "visible") return;
      void authReturn.continueIfSignedIn();
    };
    window.addEventListener("focus", continueIfSignedIn);
    document.addEventListener("visibilitychange", continueIfSignedIn);
    return () => {
      window.removeEventListener("focus", continueIfSignedIn);
      document.removeEventListener("visibilitychange", continueIfSignedIn);
    };
  }, [authReturn]);

  if (!hasSignInCode(request)) {
    return (
      <>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-3xl text-navy-blue outline-none"
        >
          {m.accountSignInAcceptedTitle({}, { locale })}
        </h2>
        <p className="mt-4 leading-7 text-navy-blue/68">
          {m.accountSignInAcceptedBody({}, { locale })}
        </p>
        <p className="mt-3 leading-7 text-navy-blue/68">
          {m.accountSignInAcceptedSameBrowser({}, { locale })}
        </p>
        <p className="mt-3 text-sm leading-6 text-navy-blue/60">
          {m.accountSignInAssistantBrowserHint({}, { locale })}
        </p>
        <Button
          type="button"
          variant="secondary"
          className="mt-8"
          onClick={onUseDifferentEmail}
        >
          {m.accountSignInAcceptedAgain({}, { locale })}
        </Button>
      </>
    );
  }

  const requestNewEmail = async () => {
    const result = await authReturn.sendSignInEmail(request.email);
    // "Use a different email" or a newer email replaced this request.
    if (result.status === "cancelled") return result.status;
    if (result.status === "failed") return result.reason;
    // An address that became a review login meanwhile moves to its password.
    if (result.status === "password") {
      onRequestChange({
        email: request.email,
        requestedAt: Date.now(),
        method: "password",
        returnTo: request.returnTo,
      });
      return "sent" as const;
    }
    // Codes switched off meanwhile fall back to the link-only state.
    onRequestChange({
      ...request,
      requestedAt: Date.now(),
      signInCode: result.signInCode,
      attemptId: result.attemptId,
    });
    return "sent" as const;
  };

  return (
    <>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-3xl text-navy-blue outline-none"
      >
        {m.accountSignInCodeTitle({}, { locale })}
      </h2>
      <p className="mt-3 text-sm leading-6 text-navy-blue/68">
        {m.accountSignInCodeBody(
          { email: maskEmailAddress(request.email) },
          { locale }
        )}
      </p>
      <SignInCodeStep
        locale={locale}
        requestedAt={request.requestedAt}
        verifiedMessage={
          request.returnTo === undefined
            ? m.accountSignInCodeVerified({}, { locale })
            : m.accountSignInCodeVerifiedReturning({}, { locale })
        }
        verifyCode={(code) => authReturn.verifySignInCode(request.email, code)}
        onVerified={authReturn.continueWithVerifiedCode}
        requestNewEmail={requestNewEmail}
        onUseDifferentEmail={onUseDifferentEmail}
      />
      <p className="mt-3 text-sm leading-6 text-navy-blue/60">
        {m.accountSignInCodeAssistantHint({}, { locale })}
      </p>
      <p className="mt-3 text-sm leading-6 text-navy-blue/60">
        {m.accountSignInAssistantBrowserHint({}, { locale })}
      </p>
    </>
  );
}
