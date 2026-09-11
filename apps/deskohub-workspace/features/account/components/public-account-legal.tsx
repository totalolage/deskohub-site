"use client";

import { getAccountScreenCopy } from "@/features/account/components/account-screen-copy";
import { LegalScreen } from "@/features/account/components/legal/legal-screen";
import type { Locale } from "@/features/i18n";

type PublicAccountLegalProps = {
  readonly locale: Locale;
  readonly signedIn: boolean;
};

export function PublicAccountLegal({ locale }: PublicAccountLegalProps) {
  const copy = getAccountScreenCopy(locale);

  return <LegalScreen locale={locale} strings={copy.legal} />;
}
