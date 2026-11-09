"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { createAuthReturnLifecycle } from "@/features/account/auth-return";
import { AuthCard } from "@/features/account/components/auth-card";
import { SignInEmailSentStep } from "@/features/account/components/sign-in-email-sent-step";
import { SignInPasswordStep } from "@/features/account/components/sign-in-password-step";
import {
  forgetEmailSignInRequest,
  rememberEmailSignInRequest,
  signsInWithPassword,
  useEmailSignInRequest,
} from "@/features/account/email-sign-in-request";
import {
  getAccountSignInPath,
  getNoLongerWaitingSignInPath,
} from "@/features/account/routes";
import { type Locale, m } from "@/features/i18n";
import { leaveDocument } from "@/shared/browser/document-navigation";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { parseSameOriginPath } from "@/shared/utils/same-origin-path";

type SignInVerifyCardProps = {
  readonly locale: Locale;
  /**
   * In a modal, "use a different email" closes it and returns to the form
   * underneath; on the page, it opens the form the sign-in returns to.
   */
  readonly presentation: "modal" | "page";
};

/**
 * Continues the sign-in email this tab requested last, such as one sent by a
 * checkout form through `startEmailSignIn`: it takes over the link's
 * hand-off and, while sign-in codes are on, the code entry, or a review
 * login's password entry, and lands on the request's return path. With nothing waiting, a signed-in tab continues to
 * the account and a signed-out one goes back to sign-in with a notice.
 */
export function SignInVerifyCard({
  locale,
  presentation,
}: SignInVerifyCardProps) {
  const router = useRouter();
  const [request, setRequest, restored] = useEmailSignInRequest();
  // Storage belongs to this origin, but its return path is checked again.
  const returnTo = parseSameOriginPath(request?.returnTo);
  const attemptId = request?.attemptId;
  const waiting = request !== null;
  const authReturn = useMemo(
    () => createAuthReturnLifecycle({ locale, returnTo }),
    [locale, returnTo]
  );

  // "Use a different email" drops the request once this card is gone, so the
  // step stays on screen while the page leaves.
  const discardWhenGone = useRef(false);
  useEffect(
    () => () => {
      if (!discardWhenGone.current) return;
      discardWhenGone.current = false;
      rememberEmailSignInRequest(null);
    },
    []
  );

  useEffect(() => {
    if (!restored) return;
    let active = true;
    authReturn.resumeSignInEmail({ attemptId });
    // The link may already have signed this browser in from another tab, or
    // a finished sign-in came back here; either continues on.
    void authReturn.continueIfSignedIn().then((signedIn) => {
      if (!active || signedIn || waiting) return;
      // The modal hands over to the sign-in modal; the page reloads as the
      // sign-in page rather than open that modal over this one.
      const signInPath = getNoLongerWaitingSignInPath(locale);
      if (presentation === "modal") router.replace(signInPath);
      else leaveDocument(signInPath, { replace: true });
    });
    return () => {
      active = false;
      authReturn.cancel();
    };
  }, [authReturn, attemptId, locale, presentation, restored, router, waiting]);

  // With nothing waiting, the card stays loading until it has left.
  if (!restored || request === null) {
    return (
      <AuthCard>
        <div
          aria-busy="true"
          aria-label={m.accountSignInLoading({}, { locale })}
          className="space-y-5"
          role="status"
        >
          <Skeleton className="h-10 w-4/5 rounded-2xl" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-13 w-full rounded-xl" />
        </div>
      </AuthCard>
    );
  }

  const changeEmail = () => {
    authReturn.cancel();
    discardWhenGone.current = true;
    forgetEmailSignInRequest();
    if (presentation === "modal") router.back();
    else router.replace(returnTo ?? getAccountSignInPath(locale));
  };

  return (
    <AuthCard>
      {signsInWithPassword(request) ? (
        <SignInPasswordStep
          locale={locale}
          authReturn={authReturn}
          request={request}
          onUseDifferentEmail={changeEmail}
        />
      ) : (
        <SignInEmailSentStep
          locale={locale}
          authReturn={authReturn}
          request={request}
          onRequestChange={setRequest}
          onUseDifferentEmail={changeEmail}
        />
      )}
    </AuthCard>
  );
}
