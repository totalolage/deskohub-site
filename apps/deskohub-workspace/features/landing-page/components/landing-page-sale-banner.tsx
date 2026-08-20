import { ArrowRight, DollarSign, Percent } from "lucide-react";
import Link from "next/link";
import type { DiscountAdjustment } from "@/features/discounts/contracts";

export type LandingPageSaleBannerContent = {
  label: string;
  adjustmentKind: DiscountAdjustment["kind"];
  statusLabel: string;
  ctaLabel: string;
  href: string;
};

export function LandingPageSaleBanner({
  content,
}: {
  content: LandingPageSaleBannerContent;
}) {
  const ticketMask =
    "radial-gradient(circle 0.75rem at left center, transparent calc(100% - 1px), #000), radial-gradient(circle 0.75rem at right center, transparent calc(100% - 1px), #000)";

  return (
    <aside
      aria-label={content.statusLabel}
      className="relative z-20 mx-auto mt-6 w-[calc(100%-2rem)] max-w-4xl text-left text-navy-blue drop-shadow-[0_30px_45px_rgba(0,2,79,0.42)]"
    >
      <div
        className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-3xl bg-[#f4f1ea] px-7 py-3 sm:px-9"
        style={{
          maskImage: ticketMask,
          maskPosition: "left center, right center",
          maskRepeat: "no-repeat",
          maskSize: "51% 100%",
          WebkitMaskImage: ticketMask,
          WebkitMaskPosition: "left center, right center",
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskSize: "51% 100%",
        }}
      >
        <div className="flex min-w-0 items-center gap-3">
          {
            {
              fixed: (
                <DollarSign
                  aria-hidden="true"
                  className="size-9 shrink-0 text-burned-orange sm:size-10"
                />
              ),
              percentage: (
                <Percent
                  aria-hidden="true"
                  className="size-9 shrink-0 text-burned-orange sm:size-10"
                />
              ),
            }[content.adjustmentKind]
          }
          <div>
            <p className="text-sm font-semibold leading-6 sm:text-base">
              {content.label}
            </p>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-burned-orange">
              {content.statusLabel}
            </p>
          </div>
        </div>
        <Link
          aria-label={content.ctaLabel}
          href={content.href}
          className="inline-flex h-11 w-fit items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-burned-orange/16 bg-burned-orange px-4 text-xs font-semibold uppercase tracking-[0.08em] text-white transition-colors hover:bg-burned-orange/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sunset-yellow focus-visible:ring-offset-2 focus-visible:ring-offset-navy-blue active:translate-y-px"
        >
          <span className="hidden sm:inline">{content.ctaLabel}</span>
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </aside>
  );
}
