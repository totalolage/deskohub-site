"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { type Locale, m } from "@/features/i18n";
import { SignInLoading } from "./sign-in-loading";

export function AccountSignInRedirect({ locale }: { readonly locale: Locale }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(`/${locale}/auth/sign-in`);
  }, [locale, router]);

  return (
    <>
      <SignInLoading locale={locale} />
      <noscript>
        <a href={`/${locale}/auth/sign-in`}>
          {m.accountSignInTitle({}, { locale })}
        </a>
      </noscript>
    </>
  );
}
