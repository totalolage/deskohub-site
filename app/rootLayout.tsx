import "./globals.css";

import type { PropsWithChildren } from "react";
import { Footer, Header } from "@/features/navigation";
import { tableReservationsFlag } from "@/flags";
import { getLocale } from "@/i18n";
import { Toaster } from "@/shared/components/ui/sonner";

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
        </div>
      </body>
    </html>
  );
}
