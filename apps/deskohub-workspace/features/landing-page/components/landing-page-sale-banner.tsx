import { ArrowRight, BadgePercent } from "lucide-react";
import Link from "next/link";

export type LandingPageSaleBannerContent = {
  label: string;
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
      className="absolute left-1/2 top-[calc(var(--site-header-height)+1rem)] z-20 w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 text-left text-navy-blue drop-shadow-[0_30px_45px_rgba(0,2,79,0.42)]"
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
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-burned-orange text-white">
            <BadgePercent aria-hidden="true" className="size-5" />
          </span>
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
