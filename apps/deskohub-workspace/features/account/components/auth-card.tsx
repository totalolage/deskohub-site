import type { ReactNode } from "react";
import { Card, CardContent } from "@/shared/components/ui/card";

/** The card every sign-in step renders in, on its page and in its modal. */
export function AuthCard({ children }: { readonly children: ReactNode }) {
  return (
    <Card className="rounded-3xl border-white/70 bg-white/94 shadow-[0_32px_100px_-48px_rgba(0,2,79,0.55)]">
      <CardContent className="p-8 sm:p-10">{children}</CardContent>
    </Card>
  );
}

/** The full-page backdrop of an auth page that renders without a modal. */
export function AuthPageShell({ children }: { readonly children: ReactNode }) {
  return (
    <main className="relative min-h-[calc(100vh-var(--site-header-height))] overflow-hidden bg-[#f4f3ef] px-4 pb-20 pt-[calc(var(--site-header-height)+4rem)] sm:px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(236,164,35,0.22),transparent_34%),radial-gradient(circle_at_85%_75%,rgba(0,223,153,0.12),transparent_30%)]" />
      <div className="relative mx-auto flex max-w-lg justify-center">
        {children}
      </div>
    </main>
  );
}
