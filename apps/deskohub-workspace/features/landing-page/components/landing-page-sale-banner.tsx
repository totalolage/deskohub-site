import { ArrowRight, BadgePercent } from "lucide-react";
import Link from "next/link";
import { cn } from "@/shared/utils";

export type LandingPageSaleBannerVariant = 1 | 2 | 3 | 4;

export type LandingPageSaleBannerContent = {
  label: string;
  description: string;
  statusLabel: string;
  ctaLabel: string;
  href: string;
};

export type LandingPageSaleBannerConfig = {
  content: LandingPageSaleBannerContent;
  variant: LandingPageSaleBannerVariant;
};

export function LandingPageSaleBanner({
  content,
  variant,
}: LandingPageSaleBannerConfig) {
  if (variant === 1) {
    return (
      <aside
        aria-label={content.statusLabel}
        className="absolute inset-x-0 top-(--site-header-height) z-20 bg-chilean-fire text-navy-blue shadow-[0_18px_50px_-32px_rgba(0,2,79,0.72)]"
      >
        <div className="mx-auto flex min-h-16 w-full max-w-8xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-navy-blue text-sunset-yellow">
              <BadgePercent aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0 sm:flex sm:items-baseline sm:gap-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-navy-blue/64">
                {content.statusLabel}
              </p>
              <p className="text-sm font-semibold sm:text-base">
                {content.label}
              </p>
              <p className="hidden text-sm text-navy-blue/68 lg:block">
                {content.description}
              </p>
            </div>
          </div>
          <BannerLink
            className="shrink-0 border border-navy-blue/16 bg-navy-blue text-white hover:bg-navy-blue/90"
            content={content}
            compact
          />
        </div>
      </aside>
    );
  }

  if (variant === 2) {
    return (
      <aside
        aria-label={content.statusLabel}
        className="absolute left-1/2 top-[calc(var(--site-header-height)+1rem)] z-20 w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 rounded-3xl border border-white/24 bg-navy-blue/58 p-1 text-left shadow-[0_28px_80px_-42px_rgba(0,2,79,0.95)] backdrop-blur-xl"
      >
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-[1.25rem] border border-white/10 bg-white/8 p-3 sm:px-4">
          <span className="grid size-10 place-items-center rounded-2xl bg-sunset-yellow text-navy-blue shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
            <BadgePercent aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold leading-6 text-white sm:text-base">
              {content.label}
            </p>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-aquamarine-green">
              {content.statusLabel}
            </p>
          </div>
          <BannerLink
            className="w-fit border border-white/14 bg-white text-navy-blue hover:bg-sunset-yellow"
            content={content}
            compact
          />
        </div>
      </aside>
    );
  }

  if (variant === 3) {
    return (
      <aside
        aria-label={content.statusLabel}
        className="absolute left-1/2 top-[calc(var(--site-header-height)+1rem)] z-20 w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 overflow-hidden rounded-3xl bg-[#f4f1ea] text-left text-navy-blue shadow-[0_30px_90px_-44px_rgba(0,2,79,0.92)] before:absolute before:-left-3 before:top-1/2 before:size-6 before:-translate-y-1/2 before:rounded-full before:bg-navy-blue after:absolute after:-right-3 after:top-1/2 after:size-6 after:-translate-y-1/2 after:rounded-full after:bg-navy-blue"
      >
        <div className="grid grid-cols-[1fr_auto] items-center gap-3 px-7 py-3 sm:px-9">
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
          <BannerLink
            className="w-fit border border-burned-orange/16 bg-burned-orange text-white hover:bg-burned-orange/90"
            content={content}
            compact
          />
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label={content.statusLabel}
      className="absolute left-1/2 top-[calc(var(--site-header-height)+1rem)] z-20 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-3xl border border-white/14 bg-navy-blue/94 p-2 text-left text-white shadow-[0_28px_80px_-28px_rgba(0,2,79,0.82)] backdrop-blur-xl lg:left-auto lg:right-[max(1rem,calc((100vw-72rem)/2))] lg:w-full lg:max-w-3xl lg:translate-x-0"
    >
      <div className="flex items-center gap-3 rounded-[1.15rem] border border-white/8 bg-white/6 p-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-chilean-fire text-white">
          <BadgePercent aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-sunset-yellow">
            {content.statusLabel}
          </p>
          <p className="text-sm font-semibold sm:text-base">{content.label}</p>
        </div>
        <BannerLink
          className="shrink-0 border border-white/14 bg-white text-navy-blue hover:bg-sunset-yellow"
          content={content}
          compact
        />
      </div>
    </aside>
  );
}

function BannerLink({
  className,
  compact = false,
  content,
}: {
  className?: string;
  compact?: boolean;
  content: LandingPageSaleBannerContent;
}) {
  return (
    <Link
      href={content.href}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-xs font-semibold uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sunset-yellow focus-visible:ring-offset-2 focus-visible:ring-offset-navy-blue active:translate-y-px",
        className
      )}
    >
      <span className={cn(compact && "hidden sm:inline")}>
        {content.ctaLabel}
      </span>
      <ArrowRight aria-hidden="true" className="size-4" />
    </Link>
  );
}
