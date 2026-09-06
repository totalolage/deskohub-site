import { Effect, Result } from "effect";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => ({
    title: m.accountCallbackMetadataTitle({}, { locale }),
    description: m.accountCallbackMetadataDescription({}, { locale }),
    robots: { index: false, follow: false },
  }));
}

/**
 * Recovery page for consumed magic links. The authoritative session is the
 * only success signal: any signed-in visitor is sent to the account, and
 * everyone else sees one safe failure state for expired, replayed, and
 * unknown links alike.
 */
export default async function CustomerAuthCallbackPage() {
  await connection();
  return runWithRequestLocale(async (locale) => {
    const session = await Effect.flatMap(
      CustomerAuthentication,
      (authentication) => authentication.currentUser
    ).pipe(
      Effect.provide(CustomerAuthentication.Default),
      Effect.result,
      runWorkspaceEffect("account.callback", { boundary: "page" })
    );
    if (Result.isSuccess(session) && session.success) {
      redirect(`/${locale}/account`);
    }

    return (
      <main className="relative min-h-[calc(100vh-var(--site-header-height))] overflow-hidden bg-[#f4f3ef] px-4 pb-20 pt-[calc(var(--site-header-height)+4rem)] sm:px-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(236,164,35,0.22),transparent_34%),radial-gradient(circle_at_85%_75%,rgba(0,223,153,0.12),transparent_30%)]" />
        <div className="relative mx-auto flex max-w-lg justify-center">
          <Card className="w-full rounded-3xl border-white/70 bg-white/94 shadow-[0_32px_100px_-48px_rgba(0,2,79,0.55)]">
            <CardContent className="p-8 sm:p-10">
              <h1 className="text-3xl text-navy-blue">
                {m.accountCallbackFailedTitle({}, { locale })}
              </h1>
              <p className="mt-4 leading-7 text-navy-blue/68">
                {m.accountCallbackFailedBody({}, { locale })}
              </p>
              <Button asChild className="mt-8">
                <Link href={`/${locale}/auth/sign-in`} prefetch={false}>
                  {m.accountCallbackFailedAction({}, { locale })}
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  });
}
