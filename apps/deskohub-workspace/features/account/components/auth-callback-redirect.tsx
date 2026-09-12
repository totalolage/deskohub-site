"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { Locale } from "@/features/i18n";
import { AuthCallbackLoading } from "./auth-callback-loading";

export function AuthCallbackRedirect({ locale }: { readonly locale: Locale }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(`/${locale}/account`);
  }, [locale, router]);

  return <AuthCallbackLoading locale={locale} />;
}
