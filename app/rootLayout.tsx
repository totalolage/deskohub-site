import "./globals.css";

import { Analytics } from "@vercel/analytics/next";
import type { Viewport } from "next";
import type { PropsWithChildren } from "react";
import { getLocale } from "@/features/i18n";
import { Footer, Header } from "@/features/navigation";
import { Toaster } from "@/shared/components/ui/sonner";
import { SafeAreaProvider } from "@/shared/providers/safe-area-provider";
import { isDev } from "@/shared/utils/environment";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<PropsWithChildren>) {
  return (
    <html lang={getLocale()}>
      <body>
        <SafeAreaProvider>
          <div className="min-h-screen bg-white [--header-height:80px]">
            <Header />
            <main className="min-h-[calc(100dvh-var(--header-height))] isolate">
              {children}
            </main>
            <Footer />
            <Toaster />
            <Analytics mode={isDev() ? "development" : "production"} />
          </div>
        </SafeAreaProvider>
      </body>
    </html>
  );
}
