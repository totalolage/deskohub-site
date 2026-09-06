import type { Metadata } from "next";
import { connection } from "next/server";
import { SignInCard } from "@/features/account/components/sign-in-card";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => ({
    title: m.accountSignInMetadataTitle({}, { locale }),
    description: m.accountSignInMetadataDescription({}, { locale }),
    robots: { index: false, follow: false },
  }));
}

export default async function CustomerSignInPage() {
  await connection();
  return runWithRequestLocale((locale) => (
    <main className="relative min-h-[calc(100vh-var(--site-header-height))] overflow-hidden bg-[#f4f3ef] px-4 pb-20 pt-[calc(var(--site-header-height)+4rem)] sm:px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(236,164,35,0.22),transparent_34%),radial-gradient(circle_at_85%_75%,rgba(0,223,153,0.12),transparent_30%)]" />
      <div className="relative mx-auto flex max-w-lg justify-center">
        <SignInCard locale={locale} />
      </div>
    </main>
  ));
}
