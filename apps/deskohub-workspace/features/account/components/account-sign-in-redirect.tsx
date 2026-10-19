"use client";

import { useEffect } from "react";
import { getAccountSignInPath } from "@/features/account/routes";
import { type Locale, m } from "@/features/i18n";
import {
  isLeavingDocument,
  leaveDocument,
} from "@/shared/browser/document-navigation";
import { SignInLoading } from "./sign-in-loading";

export function AccountSignInRedirect({ locale }: { readonly locale: Locale }) {
  const signInPath = getAccountSignInPath(locale);

  // A document navigation: a client one would open the sign-in modal over
  // this loading shell instead of the sign-in page. A page already leaving,
  // such as for the deleted page after a deletion, keeps its destination.
  useEffect(() => {
    if (!isLeavingDocument()) leaveDocument(signInPath, { replace: true });
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
