import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getPublicCatalogOfferings } from "@/features/checkout/public-offerings";
import { isLocale, locales, m } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { getWorkspaceSummary } from "@/features/public-pages/workspace-summary";
import { workspaceSiteOrigin } from "@/shared/utils";
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
  display: "swap",
  variable: "--font-sculpin",
});

export async function generateMetadata({
  params,
}: Pick<LocaleLayoutProps, "params">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return {
    metadataBase: new URL(workspaceSiteOrigin),
    title: m.workspaceMetadataTitle({}, { locale }),
    // The products every visitor can book: office reservations open by a
    // release gate, which the root layout does not read.
    description: getWorkspaceSummary({
      locale,
      offerings: getPublicCatalogOfferings({ locale }),
    }),
    icons: {
      icon: {
        url: "/favicon.png",
        type: "image/png",
        sizes: "512x512",
      },
    },
  };
}

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
      <body>
        <RouteLocaleProvider locale={locale}>{children}</RouteLocaleProvider>
      </body>
    </html>
  );
}
