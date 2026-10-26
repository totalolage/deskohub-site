import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { loadGlobalRelease } from "@/features/feature-flags/backend/global-release.server";
import { isLocale, locales, m } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  getPublicPageTitle,
  publicSiteShareImage,
} from "@/features/public-pages/page-metadata";
import { getSharedWorkspaceSummary } from "@/features/public-pages/workspace-summary";
import { TemporalLoader } from "@/shared/polyfills/temporal-loader";
import { workspaceSiteOrigin } from "@/shared/utils";
import "../globals.css";

// Only the regular face is preloaded: few pages render italic text, and the
// browser fetches the italic face when one does. Next names a font's family
// after its const, so the italic face joins the regular face's `sculpin`
// family and italic text still finds it.
const sculpin = localFont({
  src: "../../assets/fonts/Sculpin/regular.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  variable: "--font-sculpin",
});

// Nothing reads its variable; applying it keeps the italic face in the CSS.
const sculpinItalic = localFont({
  src: "../../assets/fonts/Sculpin/italic.woff2",
  weight: "400",
  style: "italic",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-sculpin-italic",
  declarations: [{ prop: "font-family", value: "sculpin" }],
});

export async function generateMetadata({
  params,
}: Pick<LocaleLayoutProps, "params">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return {
    metadataBase: new URL(workspaceSiteOrigin),
    // Pages without a title of their own share the home page's.
    title: getPublicPageTitle({ page: m.landingMetadataTitle({}, { locale }) }),
    // The products every visitor can book. The layout is static, so it reads
    // the office gate only as decided for everyone.
    description: getSharedWorkspaceSummary({
      locale,
      officeRelease: await loadGlobalRelease("office_page"),
    }),
    // Pages that set their own card name the image through the page builder.
    openGraph: { images: [publicSiteShareImage] },
    icons: {
      icon: [
        {
          url: "/favicon.ico",
          type: "image/x-icon",
          sizes: "16x16 32x32 48x48",
        },
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/favicon.png", type: "image/png", sizes: "512x512" },
      ],
      apple: {
        url: "/apple-touch-icon.png",
        type: "image/png",
        sizes: "180x180",
      },
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The header's brand navy.
  themeColor: "#00024f",
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
    <html
      lang={locale}
      className={`${sculpin.variable} ${sculpinItalic.variable}`}
    >
      <head>
        <TemporalLoader />
      </head>
      <body>
        <RouteLocaleProvider locale={locale}>{children}</RouteLocaleProvider>
      </body>
    </html>
  );
}
