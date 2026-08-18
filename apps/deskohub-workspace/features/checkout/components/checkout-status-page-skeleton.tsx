import { type Locale, m } from "@/features/i18n";
import { Skeleton } from "@/shared/components/ui/skeleton";

type CheckoutStatusPageSkeletonProps = {
  readonly locale: Locale;
};

export function CheckoutStatusPageSkeleton({
  locale,
}: CheckoutStatusPageSkeletonProps) {
  return (
    <output
      aria-busy="true"
      aria-label={m.checkoutStatusMetadataTitle({}, { locale })}
      className="block rounded-[2.25rem] border border-white/55 bg-white/94 p-6 shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm sm:p-10"
    >
      <div
        aria-hidden="true"
        className="flex flex-col gap-6 sm:flex-row sm:items-start"
      >
        <Skeleton className="h-16 w-16 shrink-0 rounded-full ring-8 ring-navy-blue/6" />
        <div className="min-w-0 flex-1 space-y-5">
          <Skeleton className="h-4 w-40 rounded-full bg-burned-orange/18" />
          <Skeleton className="h-12 w-full max-w-lg rounded-2xl" />
          <Skeleton className="h-5 w-full max-w-xl rounded-full" />
          <Skeleton className="h-5 w-3/4 rounded-full" />
        </div>
      </div>
    </output>
  );
}
