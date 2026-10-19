"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { createAuthReturnLifecycle } from "@/features/account/auth-return";
import { AuthCard } from "@/features/account/components/auth-card";
import { SignInEmailSentStep } from "@/features/account/components/sign-in-email-sent-step";
import {
  forgetEmailSignInRequest,
  rememberEmailSignInRequest,
  useEmailSignInRequest,
} from "@/features/account/email-sign-in-request";
import { getAccountSignInPath } from "@/features/account/routes";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
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
 * hand-off and, while sign-in codes are on, the code entry, and lands on the
 * request's return path.
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
    authReturn.resumeSignInEmail({ attemptId });
    // The link may already have signed this browser in from another tab.
    void authReturn.continueIfSignedIn();
    return authReturn.cancel;
  }, [authReturn, attemptId, restored]);

  if (!restored) {
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

  if (request === null) {
    return (
      <AuthCard>
        <h2 className="text-3xl text-navy-blue">
          {m.accountVerifyMissingTitle({}, { locale })}
        </h2>
        <p className="mt-4 leading-7 text-navy-blue/68">
          {m.accountVerifyMissingBody({}, { locale })}
        </p>
        <Button asChild className="mt-8">
          <Link href={getAccountSignInPath(locale)} replace>
            {m.accountVerifyMissingAction({}, { locale })}
          </Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <SignInEmailSentStep
        locale={locale}
        authReturn={authReturn}
        request={request}
        onRequestChange={setRequest}
        onUseDifferentEmail={() => {
          authReturn.cancel();
          discardWhenGone.current = true;
          forgetEmailSignInRequest();
          if (presentation === "modal") router.back();
          else router.replace(returnTo ?? getAccountSignInPath(locale));
        }}
      />
    </AuthCard>
  );
}
