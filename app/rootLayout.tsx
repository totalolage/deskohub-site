import "./globals.css";

import type { PropsWithChildren } from "react";
import { Footer, Header } from "@/features/navigation";
import { getLocale } from "@/i18n";
import { FeatureFlagDebugger } from "@/shared/components/feature-flag-debugger";
import { Toaster } from "@/shared/components/ui/sonner";
import { tableReservationsFlag } from "@/shared/lib/feature-flags";

export default async function RootLayout({
  children,
}: Readonly<PropsWithChildren>) {
  const showReservations = await tableReservationsFlag();

  return (
    <html lang={getLocale()}>
      <body>
        <div className="min-h-screen bg-white [--header-height:80px]">
          <Header showReservations={showReservations} />
          <main className="min-h-[calc(100dvh-var(--header-height))] isolate">
            {children}
          </main>
          <Footer />
          <Toaster />
          <FeatureFlagDebugger />
        </div>
      </body>
    </html>
  );
}
