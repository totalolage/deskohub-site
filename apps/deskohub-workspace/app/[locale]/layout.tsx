import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isWorkspaceLocale, workspaceLocales } from "@/features/i18n";
import "../globals.css";

const report = localFont({
  src: "../../assets/fonts/Report.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  variable: "--font-report",
});

const sculpin = localFont({
  src: [
    {
      path: "../../assets/fonts/Sculpin-Roman.woff2",
      weight: "300 900",
      style: "normal",
    },
    {
      path: "../../assets/fonts/Sculpin-Italic.woff2",
      weight: "300 900",
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
    <html lang={locale} className={`${report.variable} ${sculpin.variable}`}>
      <body>{children}</body>
    </html>
  );
}
