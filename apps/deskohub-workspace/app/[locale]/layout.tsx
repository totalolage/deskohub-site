import { GoogleTagManager } from "@next/third-parties/google";
import { Analytics } from "@vercel/analytics/react";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { env } from "@/env";
import { CookieConsentProvider } from "@/features/cookie-consent";
import { isWorkspaceLocale, workspaceLocales } from "@/features/i18n";
import {
  UnderConstructionRibbon,
  underConstructionRibbonViewportStyle,
} from "@/shared/components/under-construction-ribbon";
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
  return workspaceLocales.map((locale) => ({ locale }));
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
  if (!isWorkspaceLocale(locale)) notFound();

  return (
    <html lang={locale} className={sculpin.variable}>
      {env.NEXT_PUBLIC_GTM_ID && <GoogleTagManager gtmId={env.NEXT_PUBLIC_GTM_ID} />}
      <body
        className="sm:[--under-construction-ribbon-corner-size:13rem] sm:[--under-construction-ribbon-band-height:2.75rem]"
        style={underConstructionRibbonViewportStyle as CSSProperties}
      >
        <CookieConsentProvider locale={locale} />
        <Analytics />
        <div className="min-h-screen pb-[calc(var(--under-construction-ribbon-safe-area-block)+env(safe-area-inset-bottom))]">
          {children}
        </div>
        <UnderConstructionRibbon locale={locale} />
      </body>
    </html>
  );
}
