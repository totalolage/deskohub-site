import { getAccountPath } from "@/features/account/routes";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Skeleton } from "@/shared/components/ui/skeleton";

/**
 * The callback card while the sign-in continues. Before the session is known
 * it is a skeleton; once this browser is signed in (`signedIn`) it says so and
 * where the tab goes next, because a link signs in only the browser that
 * opened it, which may not be the one the visitor started in.
 */
export function AuthCallbackLoading({
  locale,
  signedIn,
}: {
  readonly locale: Locale;
  readonly signedIn?: { readonly returning: boolean };
}) {
  return (
    <main className="relative min-h-[calc(100vh-var(--site-header-height))] overflow-hidden bg-[#f4f3ef] px-4 pb-20 pt-[calc(var(--site-header-height)+4rem)] sm:px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(236,164,35,0.22),transparent_34%),radial-gradient(circle_at_85%_75%,rgba(0,223,153,0.12),transparent_30%)]" />
      <div className="relative mx-auto flex max-w-lg justify-center">
        <Card
          aria-busy="true"
          aria-label={m.accountSignInLoading({}, { locale })}
          className="w-full rounded-3xl border-white/70 bg-white/94 shadow-[0_32px_100px_-48px_rgba(0,2,79,0.55)]"
          data-slot="auth-callback-loading"
          role="status"
        >
          <CardContent className="p-8 sm:p-10">
            {signedIn ? (
              <>
                <h1 className="text-3xl text-navy-blue">
                  {m.accountCallbackSignedInTitle({}, { locale })}
                </h1>
                <p className="mt-4 leading-7 text-navy-blue/68">
                  {signedIn.returning
                    ? m.accountCallbackSignedInReturning({}, { locale })
                    : m.accountCallbackSignedInAccount({}, { locale })}
                </p>
              </>
            ) : (
              <div aria-hidden="true" className="space-y-5">
                <Skeleton className="h-4 w-32 rounded-full" />
                <Skeleton className="h-10 w-4/5 rounded-2xl" />
                <div className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-11/12" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-20 rounded-full" />
                  <Skeleton className="h-13 w-full rounded-xl" />
                </div>
                <Skeleton className="h-10 w-48 rounded-full bg-burned-orange/18" />
              </div>
            )}
            <noscript>
              <a href={getAccountPath(locale)}>
                {m.accountTitle({}, { locale })}
              </a>
            </noscript>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
