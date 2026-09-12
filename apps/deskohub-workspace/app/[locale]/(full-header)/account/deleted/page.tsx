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

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => ({
    title: m.accountDeletedMetadataTitle({}, { locale }),
    description: m.accountDeletedMetadataDescription({}, { locale }),
    robots: { index: false, follow: false },
  }));
}

/**
 * The after-deletion page. A visitor with a live authoritative session has no
 * deleted account and is sent to the account itself.
 */
export default async function CustomerAccountDeletedPage() {
  await connection();
  return runWithRequestLocale(async (locale) => {
    const session = await Effect.flatMap(
      CustomerAuthentication,
      (authentication) => authentication.currentUser
    ).pipe(
      Effect.provide(CustomerAuthentication.Default),
      Effect.result,
      runWorkspaceEffect("account.deleted", { boundary: "page" })
    );
    if (Result.isSuccess(session) && session.success) {
      redirect(`/${locale}/account`);
    }

    return (
      <main className="relative min-h-screen overflow-hidden bg-[#f4f3ef] px-4 pb-24 pt-[calc(var(--site-header-height)+3rem)] sm:px-6 lg:pt-[calc(var(--site-header-height)+4.5rem)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_8%,rgba(236,164,35,0.19),transparent_31%),radial-gradient(circle_at_92%_40%,rgba(0,223,153,0.11),transparent_28%)]" />
        <div className="relative mx-auto max-w-xl">
          <Card className="rounded-3xl border-white/70 bg-white/92 p-8 text-center shadow-[0_26px_80px_-48px_rgba(0,2,79,0.55)] sm:p-10">
            <CardContent className="p-0">
              <h1 className="text-3xl text-navy-blue sm:text-4xl">
                {m.accountDeletedTitle({}, { locale })}
              </h1>
              <p className="mt-4 leading-7 text-navy-blue/68">
                {m.accountDeletedBody({}, { locale })}
              </p>
              <Button asChild className="mt-8">
                <Link href={`/${locale}/auth/sign-in`} prefetch={false}>
                  {m.accountDeletedSignInAgain({}, { locale })}
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  });
}
