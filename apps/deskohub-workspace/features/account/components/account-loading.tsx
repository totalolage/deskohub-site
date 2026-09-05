import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { Card, CardContent, CardHeader } from "@/shared/components/ui/card";
import { Skeleton } from "@/shared/components/ui/skeleton";

const cardClassName =
  "rounded-3xl border-white/70 bg-white/92 shadow-[0_26px_80px_-48px_rgba(0,2,79,0.55)]";
const skeletonClassName =
  "rounded-full bg-navy-blue/8 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]";

export function AccountLoading({ locale }: { readonly locale: Locale }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f4f3ef] px-4 pb-24 pt-[calc(var(--site-header-height)+3rem)] sm:px-6 lg:pt-[calc(var(--site-header-height)+4.5rem)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_8%,rgba(236,164,35,0.19),transparent_31%),radial-gradient(circle_at_92%_40%,rgba(0,223,153,0.11),transparent_28%)]" />
      <div className="relative mx-auto max-w-6xl">
        <div
          role="status"
          aria-busy="true"
          aria-label={m.accountMetadataTitle({}, { locale })}
          className="grid items-start gap-6"
        >
          <div
            aria-hidden="true"
            className="flex flex-wrap items-center justify-between gap-6"
          >
            <div className="max-w-2xl">
              <Skeleton className="h-12 w-56 rounded-2xl sm:h-14 sm:w-72" />
            </div>
            <Skeleton className="h-10 w-24 shrink-0" />
          </div>

          <div
            aria-hidden="true"
            className="grid items-start gap-6 lg:grid-cols-[minmax(17rem,0.72fr)_minmax(0,1.28fr)]"
          >
            <Card className={cardClassName}>
              <CardContent className="space-y-6 p-6 sm:p-8">
                <div className="space-y-3">
                  <Skeleton className="h-8 w-32 rounded-2xl" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
                <div className="space-y-5">
                  <Skeleton className={`h-13 w-full ${skeletonClassName}`} />
                  <Skeleton className={`h-13 w-full ${skeletonClassName}`} />
                  <Skeleton className={`h-13 w-full ${skeletonClassName}`} />
                  <Skeleton className="h-13 w-36 rounded-full bg-burned-orange/18" />
                </div>
              </CardContent>
            </Card>

            <Card className={cardClassName}>
              <CardContent className="space-y-6 p-6 sm:p-8">
                <div className="space-y-3">
                  <Skeleton className="h-8 w-44 rounded-2xl" />
                  <Skeleton className="h-4 w-full max-w-xl" />
                  <Skeleton className="h-4 w-4/5 max-w-lg" />
                </div>
                <div className="space-y-4">
                  <Skeleton className="h-5 w-40 rounded-full" />
                  <div className="space-y-3 rounded-2xl border border-navy-blue/8 p-4">
                    <Skeleton className="h-6 w-3/4 rounded-full" />
                    <Skeleton className="h-4 w-1/2 rounded-full" />
                    <Skeleton className="h-4 w-2/3 rounded-full" />
                  </div>
                  <Skeleton className="h-5 w-32 rounded-full" />
                  <div className="space-y-3 rounded-2xl border border-navy-blue/8 p-4">
                    <Skeleton className="h-6 w-2/3 rounded-full" />
                    <Skeleton className="h-4 w-1/2 rounded-full" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card aria-hidden="true" className={cardClassName}>
            <CardHeader className="space-y-3">
              <Skeleton className="h-7 w-36 rounded-2xl" />
              <Skeleton className="h-4 w-full max-w-3xl" />
              <Skeleton className="h-4 w-4/5 max-w-2xl" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-10 w-36 rounded-full bg-red-900/12" />
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
