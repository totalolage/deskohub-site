"use client";

import { useEffect } from "react";
import { getAccountSignInPath } from "@/features/account/routes";
import { type Locale, m } from "@/features/i18n";
import { SignInLoading } from "./sign-in-loading";

export function AccountSignInRedirect({ locale }: { readonly locale: Locale }) {
  const signInPath = getAccountSignInPath(locale);

  // A document navigation: a client one would open the sign-in modal over
  // this loading shell instead of the sign-in page.
  useEffect(() => {
    try {
      window.location.replace(signInPath);
    } catch {
      // The document is already leaving or the browser blocked navigation.
    }
  }, [signInPath]);

  return (
    <>
      <SignInLoading locale={locale} />
      <noscript>
        <a href={signInPath}>{m.accountSignInTitle({}, { locale })}</a>
      </noscript>
    </>
  );
}
