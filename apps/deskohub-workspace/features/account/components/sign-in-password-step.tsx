"use client";

import type { AuthReturnLifecycle } from "@/features/account/auth-return";
import { SignInPasswordForm } from "@/features/account/components/sign-in-password-form";
import type { EmailSignInRequest } from "@/features/account/email-sign-in-request";
import { type Locale, m } from "@/features/i18n";
import { maskEmailAddress } from "@/shared/utils";

type SignInPasswordStepProps = {
  readonly locale: Locale;
  readonly authReturn: AuthReturnLifecycle;
  readonly request: EmailSignInRequest;
  readonly onUseDifferentEmail: () => void;
};

/**
 * What a tab shows instead of the sent email when the address is an
 * app-directory review login: its password, which signs in and continues to
 * the request's destination.
 */
export function SignInPasswordStep({
  locale,
  authReturn,
  request,
  onUseDifferentEmail,
}: SignInPasswordStepProps) {
  return (
    <>
      <h2 className="text-3xl text-navy-blue">
        {m.accountSignInPasswordTitle({}, { locale })}
      </h2>
      <p className="mt-3 text-sm leading-6 text-navy-blue/68">
        {m.accountSignInPasswordBody(
          { email: maskEmailAddress(request.email) },
          { locale }
        )}
      </p>
      <SignInPasswordForm
        locale={locale}
        email={request.email}
        signedInMessage={
          request.returnTo === undefined
            ? m.accountSignInCodeVerified({}, { locale })
            : m.accountSignInCodeVerifiedReturning({}, { locale })
        }
        signIn={(password) =>
          authReturn.signInWithPassword(request.email, password)
        }
        onSignedIn={authReturn.continueWithPassword}
        onUseDifferentEmail={onUseDifferentEmail}
      />
    </>
  );
}
