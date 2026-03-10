import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { defaultWorkspaceLocale } from "../features/i18n/dictionary";
import "./globals.css";

const report = localFont({
  src: "../assets/fonts/Report.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  variable: "--font-report",
});

const sculpin = localFont({
  src: [
    {
      path: "../assets/fonts/Sculpin-Roman.woff2",
      weight: "300 900",
      style: "normal",
    },
    {
      path: "../assets/fonts/Sculpin-Italic.woff2",
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

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html
      lang={defaultWorkspaceLocale}
      className={`${report.variable} ${sculpin.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
