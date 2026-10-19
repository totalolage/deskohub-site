import type { Metadata } from "next";
import { connection } from "next/server";
import { AuthPageShell } from "@/features/account/components/auth-card";
import { SignInVerifyCard } from "@/features/account/components/sign-in-verify-card";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => ({
    title: m.accountVerifyMetadataTitle({}, { locale }),
    description: m.accountVerifyMetadataDescription({}, { locale }),
    robots: { index: false, follow: false },
  }));
}

export default async function CustomerSignInVerifyPage() {
  await connection();

  return runWithRequestLocale((locale) => (
    <AuthPageShell>
      <SignInVerifyCard locale={locale} presentation="page" />
    </AuthPageShell>
  ));
}
