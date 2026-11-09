import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";

export const instant = false;

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function CookieSettingsRedirect() {
  return runWithRequestLocale((locale) => {
    redirect(`/${locale}/account/legal`);
  });
}
