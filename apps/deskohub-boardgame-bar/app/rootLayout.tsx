import { GoogleTagManager } from "@next/third-parties/google";
import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import type { PropsWithChildren } from "react";
import { env } from "@/env";
import { CookieConsentProvider } from "@/features/cookie-consent";
import { baseLocale, type Locale } from "@/features/i18n";
import { Footer, Header } from "@/features/navigation";
import { Toaster } from "@/shared/components/ui/sonner";
import { QueryProvider } from "@/shared/providers/query-provider";
import { SafeAreaProvider } from "@/shared/providers/safe-area-provider";
import { isDev } from "@/shared/utils/environment";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: env.NEXT_PUBLIC_DOMAIN,
};

export default async function RootLayout({
  locale = baseLocale,
  children,
}: Readonly<
  PropsWithChildren<{
    locale?: Locale;
  }>
>) {
  return (
    <html lang={locale}>
      {env.NEXT_PUBLIC_GTM_ID && (
        <GoogleTagManager gtmId={env.NEXT_PUBLIC_GTM_ID} />
      )}
      <body className="min-h-screen bg-white [--header-height:80px]">
        <SafeAreaProvider>
          <QueryProvider>
            <CookieConsentProvider locale={locale} />
            <Header />
            <main className="min-h-[calc(100dvh-var(--header-height))] isolate">
              {children}
            </main>
            <Footer />
            <Toaster />
            <Analytics
              mode={
                isDev({
                  nodeEnv: env.NEXT_PUBLIC_NODE_ENV,
                  vercelEnv: env.NEXT_PUBLIC_VERCEL_ENV,
                })
                  ? "development"
                  : "production"
              }
            />
          </QueryProvider>
        </SafeAreaProvider>
      </body>
    </html>
  );
}
