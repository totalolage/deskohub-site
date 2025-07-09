import "./globals.css";

import { Footer } from "@/components/sections/footer";
import { Header } from "@/components/sections/header";
import { Toaster } from "@/components/ui/sonner";
import { getLocale } from "@/i18n";
import { PropsWithChildren } from "react";

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
          <Toaster />
        </div>
      </body>
    </html>
  );
}
