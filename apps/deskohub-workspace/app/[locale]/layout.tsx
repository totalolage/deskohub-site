import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isWorkspaceLocale, workspaceLocales } from "@/features/i18n";
import "../globals.css";

const montserrat = Montserrat({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-montserrat",
});

const asgard = localFont({
  src: [
    {
      path: "../../assets/fonts/AsgardFit/thin.woff2",
      weight: "100",
      style: "normal",
    },
    {
      path: "../../assets/fonts/AsgardFit/extra-light.woff2",
      weight: "200",
      style: "normal",
    },
    {
      path: "../../assets/fonts/AsgardFit/light.woff2",
      weight: "300",
      style: "normal",
    },
    {
      path: "../../assets/fonts/AsgardFit/regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../assets/fonts/AsgardFit/medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../assets/fonts/AsgardFit/bold.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../../assets/fonts/AsgardFit/extra-bold.woff2",
      weight: "800",
      style: "normal",
    },
    {
      path: "../../assets/fonts/AsgardFit/fat.woff2",
      weight: "900",
      style: "normal",
    },
    {
      path: "../../assets/fonts/AsgardFit/thin-italic.woff2",
      weight: "100",
      style: "italic",
    },
    {
      path: "../../assets/fonts/AsgardFit/extra-light-italic.woff2",
      weight: "200",
      style: "italic",
    },
    {
      path: "../../assets/fonts/AsgardFit/light-italic.woff2",
      weight: "300",
      style: "italic",
    },
    {
      path: "../../assets/fonts/AsgardFit/regular-italic.woff2",
      weight: "400",
      style: "italic",
    },
    {
      path: "../../assets/fonts/AsgardFit/medium-italic.woff2",
      weight: "500",
      style: "italic",
    },
    {
      path: "../../assets/fonts/AsgardFit/bold-italic.woff2",
      weight: "700",
      style: "italic",
    },
    {
      path: "../../assets/fonts/AsgardFit/extra-bold-italic.woff2",
      weight: "800",
      style: "italic",
    },
    {
      path: "../../assets/fonts/AsgardFit/fat-italic.woff2",
      weight: "900",
      style: "italic",
    },
  ],
  preload: false,
  display: "swap",
  variable: "--font-asgard",
});

const hiruko = localFont({
  src: [
    {
      path: "../../assets/fonts/Hiruko/extra-light.woff2",
      weight: "200",
      style: "normal",
    },
    {
      path: "../../assets/fonts/Hiruko/light.woff2",
      weight: "300",
      style: "normal",
    },
    {
      path: "../../assets/fonts/Hiruko/regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../assets/fonts/Hiruko/black.woff2",
      weight: "900",
      style: "normal",
    },
    {
      path: "../../assets/fonts/Hiruko/extra-light-oblique.woff2",
      weight: "200",
      style: "italic",
    },
    {
      path: "../../assets/fonts/Hiruko/light-oblique.woff2",
      weight: "300",
      style: "italic",
    },
    {
      path: "../../assets/fonts/Hiruko/regular-oblique.woff2",
      weight: "400",
      style: "italic",
    },
    {
      path: "../../assets/fonts/Hiruko/black-oblique.woff2",
      weight: "900",
      style: "italic",
    },
  ],
  preload: false,
  display: "swap",
  variable: "--font-hiruko",
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
    <html
      lang={locale}
      className={`${montserrat.variable} ${asgard.variable} ${hiruko.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
