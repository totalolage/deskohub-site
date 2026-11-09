import Interpolate from "@doist/react-interpolate";
import { ArrowRight, DollarSign, Percent } from "lucide-react";
import type { DiscountAdjustment } from "@/features/discounts/contracts";
import type { LandingPageSaleBannerClick } from "../landing-page-sale-banner-analytics";
import { LandingPageSaleBannerLink } from "./landing-page-sale-banner-link";

/**
 * Keeps the translated template separate from the admin-entered title so the
 * title always renders as literal text instead of interpolation markup.
 */
export type LandingPageSaleBannerLabel = {
  template: string;
  title: string;
  adjustment: string;
};

export type LandingPageSaleBannerContent = {
  label: LandingPageSaleBannerLabel;
  adjustmentKind: DiscountAdjustment["kind"];
  statusLabel: string;
  ctaLabel: string;
  href: string;
  click: LandingPageSaleBannerClick;
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
              <Interpolate
                string={content.label.template}
                mapping={{
                  title: content.label.title,
                  adjustment: content.label.adjustment,
                  discount: (value) => (
                    <span
                      className="whitespace-nowrap font-bold text-sunset-yellow-ink"
                      data-landing-sale-discount-value
                    >
                      {value}
                    </span>
                  ),
                }}
              />
            </p>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-burned-orange">
              {content.statusLabel}
            </p>
          </div>
        </div>
        <LandingPageSaleBannerLink
          click={content.click}
          href={content.href}
          label={content.ctaLabel}
        >
          <span className="hidden sm:inline">{content.ctaLabel}</span>
          <ArrowRight aria-hidden="true" className="size-4" />
        </LandingPageSaleBannerLink>
      </div>
    </aside>
  );
}
