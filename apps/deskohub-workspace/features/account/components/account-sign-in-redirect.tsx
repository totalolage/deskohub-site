"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { type Locale, m } from "@/features/i18n";
import type { ReferralCode } from "@/features/referrals/client";
import { SignInLoading } from "./sign-in-loading";

export function AccountSignInRedirect({
  locale,
  referralCode,
}: {
  readonly locale: Locale;
  readonly referralCode?: ReferralCode;
}) {
  const router = useRouter();
  const signInPath =
    referralCode === undefined
      ? `/${locale}/auth/sign-in`
      : `/${locale}/auth/sign-in?${new URLSearchParams({ ref: referralCode })}`;

  useEffect(() => {
    router.replace(signInPath);
  }, [router, signInPath]);

  return (
    <>
      <SignInLoading locale={locale} />
      <noscript>
        <a href={signInPath}>{m.accountSignInTitle({}, { locale })}</a>
      </noscript>
    </>
  );
}
