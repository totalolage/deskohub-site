import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { defaultWorkspaceLocale } from "@/features/i18n/dictionary";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deskohub Workspace",
  description: "Workspace shell application for Deskohub products.",
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
    <html lang={defaultWorkspaceLocale}>
      <body>{children}</body>
    </html>
  );
}
