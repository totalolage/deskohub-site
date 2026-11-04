"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createAuthReturnLifecycle,
  type SignInEmailFailure,
} from "@/features/account/auth-return";
import { AuthCard } from "@/features/account/components/auth-card";
import { SignInEmailSentStep } from "@/features/account/components/sign-in-email-sent-step";
import {
  SignInEmailStep,
  type SignInFormValues,
  useSignInEmailForm,
} from "@/features/account/components/sign-in-email-step";
import { SignInPasswordStep } from "@/features/account/components/sign-in-password-step";
import {
  hasSignInCode,
  signsInWithPassword,
  useEmailSignInRequest,
} from "@/features/account/email-sign-in-request";
import type { SignInPurpose } from "@/features/account/routes";
import type { Locale } from "@/features/i18n";
import { useClientReady } from "@/shared/browser/use-client-ready";
import { parseSameOriginPath } from "@/shared/utils/same-origin-path";

type SignInCardProps = {
  readonly locale: Locale;
  /** Where to continue after sign-in; validated before use. */
  readonly returnTo?: string;
  /**
   * Offers passkey sign-in: the button below the form and passkey autofill
   * on the email field. Off while `login_passkeys` is off.
   */
  readonly passkeysEnabled?: boolean;
  /** Why the visitor signs in, when a page sent them here. */
  readonly purpose?: SignInPurpose;
  /**
   * Explains above the form that the sign-in a verify page waited for is
   * gone, until the visitor sends a new email.
   */
  readonly noLongerWaiting?: boolean;
};

export function SignInCard({
  locale,
  returnTo,
  passkeysEnabled = false,
  purpose,
  noLongerWaiting = false,
}: SignInCardProps) {
  const [failure, setFailure] = useState<SignInEmailFailure | null>(null);
  const [showNoLongerWaiting, setShowNoLongerWaiting] =
    useState(noLongerWaiting);
  const clientReady = useClientReady();
  // A server-rendered page shows the notice from the start. A client
  // navigation, such as the verify modal handing over, paints the notice's
  // live region empty for a frame first, since screen readers often skip a
  // region inserted together with its text.
  const [noticeRegionMounted, setNoticeRegionMounted] = useState(
    !clientReady || !noLongerWaiting
  );
  useEffect(() => {
    if (noticeRegionMounted) return;
    const frame = requestAnimationFrame(() => setNoticeRegionMounted(true));
    return () => cancelAnimationFrame(frame);
  }, [noticeRegionMounted]);
  const { request, destination, setRequest } =
    useContinuingSignInRequest(returnTo);
  const submissionInProgress = useRef(false);
  // The control that switched the view unmounts with it, so the next view
  // takes focus once it mounts.
  const focusAfterViewChange = useRef<"email" | "accepted" | null>(null);
  const focusOnMount =
    (target: "email" | "accepted") => (element: HTMLElement | null) => {
      if (element === null || focusAfterViewChange.current !== target) return;
      focusAfterViewChange.current = null;
      element.focus();
    };
  const authReturn = useMemo(
    () => createAuthReturnLifecycle({ locale, returnTo: destination }),
    [locale, destination]
  );
  const form = useSignInEmailForm(locale);

  useEffect(() => authReturn.cancel, [authReturn]);

  const requestLink = async ({ email }: SignInFormValues) => {
    const result = await authReturn.sendSignInEmail(email);
    if (result.status === "cancelled") return;
    if (result.status === "failed") {
      setFailure(result.reason);
      return;
    }
    setShowNoLongerWaiting(false);
    if (result.status === "password") {
      setRequest({
        email,
        requestedAt: Date.now(),
        method: "password",
        returnTo: destination,
      });
      return;
    }
    if (!result.signInCode) focusAfterViewChange.current = "accepted";
    setRequest({
      email,
      requestedAt: Date.now(),
      signInCode: result.signInCode,
      attemptId: result.attemptId,
      returnTo: destination,
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (submissionInProgress.current) {
      event.preventDefault();
      return;
    }
    submissionInProgress.current = true;
    setFailure(null);
    void form
      .handleSubmit(requestLink)(event)
      .finally(() => {
        submissionInProgress.current = false;
      });
  };

  const changeEmail = (pending: NonNullable<typeof request>) => {
    authReturn.cancel();
    focusAfterViewChange.current = "email";
    setRequest(null);
    form.reset({
      email:
        hasSignInCode(pending) || signsInWithPassword(pending)
          ? pending.email
          : "",
    });
    setFailure(null);
  };

  if (request && signsInWithPassword(request)) {
    return (
      <AuthCard>
        <SignInPasswordStep
          locale={locale}
          authReturn={authReturn}
          request={request}
          onUseDifferentEmail={() => changeEmail(request)}
        />
      </AuthCard>
    );
  }

  if (request) {
    return (
      <AuthCard>
        <SignInEmailSentStep
          locale={locale}
          authReturn={authReturn}
          request={request}
          headingRef={focusOnMount("accepted")}
          onRequestChange={(next) => {
            if (!hasSignInCode(next)) focusAfterViewChange.current = "accepted";
            setRequest(next);
          }}
          onUseDifferentEmail={() => changeEmail(request)}
        />
      </AuthCard>
    );
  }

  return (
    <SignInEmailStep
      emailRef={focusOnMount("email")}
      failure={failure}
      form={form}
      locale={locale}
      noticeRegionMounted={noticeRegionMounted}
      onSubmit={handleSubmit}
      passkeysEnabled={passkeysEnabled}
      purpose={purpose}
      ready={clientReady}
      returnTo={returnTo}
      showNoLongerWaiting={showNoLongerWaiting}
    />
  );
}

// The pending request continues only to its own destination: its link
// already lands there. A card opened without one takes the request's; a
// card opened for another one starts a fresh request. A hook, so the React
// Compiler treats the destination as frozen and keeps the card's memoization.
function useContinuingSignInRequest(returnTo: string | undefined) {
  const [storedRequest, setRequest] = useEmailSignInRequest();
  const requestedReturnTo = parseSameOriginPath(returnTo);
  const request =
    storedRequest &&
    (requestedReturnTo === undefined ||
      storedRequest.returnTo === requestedReturnTo)
      ? storedRequest
      : null;
  return {
    request,
    destination: request ? request.returnTo : requestedReturnTo,
    setRequest,
  };
}
