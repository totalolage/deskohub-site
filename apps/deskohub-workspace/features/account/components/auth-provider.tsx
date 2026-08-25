"use client";

import {
  authLocalization,
  NeonAuthUIProvider,
} from "@neondatabase/auth/react/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { type Locale, m } from "@/features/i18n";
import { authClient } from "../auth.client";

export function AuthProvider({
  children,
  locale,
}: {
  readonly children: ReactNode;
  readonly locale: Locale;
}) {
  const router = useRouter();

  return (
    <NeonAuthUIProvider
      authClient={authClient}
      basePath={`/${locale}/auth`}
      redirectTo={`/${locale}/account`}
      navigate={router.push}
      replace={router.replace}
      onSessionChange={() => router.refresh()}
      Link={Link}
      credentials={false}
      magicLink
      signUp={false}
      account={false}
      changeEmail={false}
      deleteUser={false}
      defaultTheme="light"
      className="contents"
      localization={{
        ...authLocalization,
        EMAIL: m.accountAuthEmailLabel({}, { locale }),
        EMAIL_PLACEHOLDER: m.accountAuthEmailPlaceholder({}, { locale }),
        INVALID_EMAIL: m.accountAuthEmailInvalid({}, { locale }),
        IS_INVALID: m.accountAuthInvalid({}, { locale }),
        MAGIC_LINK_ACTION: m.accountAuthSubmit({}, { locale }),
        MAGIC_LINK_EMAIL: m.accountAuthEmailSent({}, { locale }),
        REQUEST_FAILED: m.accountAuthRequestFailed({}, { locale }),
        SIGN_IN: m.accountAuthTitle({}, { locale }),
        SIGN_IN_DESCRIPTION: m.accountAuthDescription({}, { locale }),
      }}
    >
      {children}
    </NeonAuthUIProvider>
  );
}
