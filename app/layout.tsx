import type { Metadata } from "next";
import "./globals.css";
import type { PropsWithChildren } from "react";
import { Footer } from "@/components/sections/footer";
import { Header } from "@/components/sections/header";
import { getLocale } from "@/i18n";

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
      <body>
        <div className="min-h-screen bg-white [--header-height:80px]">
          <Header />
          <main>{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
