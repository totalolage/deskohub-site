import { type Locale, m } from "@/features/i18n";

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
      <span
        aria-hidden="true"
        className="flex flex-col gap-6 sm:flex-row sm:items-start"
      >
        <span className="block h-16 w-16 shrink-0 rounded-full bg-navy-blue/8 ring-8 ring-navy-blue/6" />
        <span className="block min-w-0 flex-1 space-y-5">
          <span className="block h-4 w-40 rounded-full bg-burned-orange/18" />
          <span className="block h-12 w-full max-w-lg rounded-2xl bg-navy-blue/8" />
          <span className="block h-5 w-full max-w-xl rounded-full bg-navy-blue/8" />
          <span className="block h-5 w-3/4 rounded-full bg-navy-blue/8" />
        </span>
      </span>
    </output>
  );
}
