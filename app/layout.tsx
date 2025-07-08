import type { Metadata } from "next";
import "./globals.css";
import { getLocale } from "@/src/paraglide/runtime";
import { PropsWithChildren } from "react";

export const metadata: Metadata = {
  title: "Deskohub - Board Game Café",
  description: "Play, drink, eat - everything at one table",
  generator: "v0.dev",
};

export default async function RootLayout({
  children,
}: Readonly<PropsWithChildren>) {
  return (
    <html lang={getLocale()}>
      <body>{children}</body>
    </html>
  );
}
