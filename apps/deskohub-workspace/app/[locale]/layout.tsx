import { GoogleTagManager } from "@next/third-parties/google";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { env } from "@/env";
import { ConsentAwareAnalytics } from "@/features/cookie-consent/components/consent-aware-analytics";
import { CookieConsentProvider } from "@/features/cookie-consent/components/cookie-consent-provider";
import { isLocale, locales } from "@/features/i18n";
import { QueryProvider } from "@/shared/components/query-provider";
import "../globals.css";

const sculpin = localFont({
  src: [
    {
      path: "../../assets/fonts/Sculpin/regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../assets/fonts/Sculpin/italic.woff2",
      weight: "400",
      style: "italic",
    },
  ],
  preload: false,
  display: "swap",
  variable: "--font-sculpin",
});

export const metadata: Metadata = {
  title: "Deskohub Workspace",
  description: "Workspace shell application for Deskohub products.",
  icons: {
    icon: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

type LocaleLayoutProps = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <html lang={locale} className={sculpin.variable}>
      {env.NEXT_PUBLIC_GTM_ID && (
        <GoogleTagManager gtmId={env.NEXT_PUBLIC_GTM_ID} />
      )}
      <body>
        <CookieConsentProvider locale={locale} />
        <ConsentAwareAnalytics posthogEnvironment={env.VERCEL_ENV} />
        <QueryProvider>
          <div className="min-h-screen pb-[calc(var(--under-construction-ribbon-safe-area-block)+env(safe-area-inset-bottom))]">
            {children}
          </div>
        </QueryProvider>
      </body>
    </html>
  );
}
