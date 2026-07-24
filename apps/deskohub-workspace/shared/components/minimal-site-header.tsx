"use client";

import Link from "next/link";
import { Suspense } from "react";
import type { Locale } from "@/features/i18n";
import { LocaleSwitcherLinks } from "@/shared/components/locale-switcher-links";
import { HorizontalLogo } from "@/shared/components/logo";

type MinimalSiteHeaderProps = {
  currentLocale: Locale;
  languageLabels: Record<Locale, string>;
};

export function MinimalSiteHeader({
  currentLocale,
  languageLabels,
}: MinimalSiteHeaderProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 h-[var(--site-header-height)] border-b border-white/10 bg-navy-blue/92 text-white backdrop-blur-md">
      <div className="mx-auto flex h-full w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href={`/${currentLocale}`} className="shrink-0">
          <HorizontalLogo
            styling={{ color: "dark", variant: "color" }}
            className="scale-80"
          />
        </Link>

        <nav
          aria-label="Language switcher"
          className="rounded-full border border-white/12 bg-white/6 px-6 py-2 text-center text-xs uppercase tracking-[0.14em] text-white/72"
        >
          <Suspense fallback={null}>
            <LocaleSwitcherLinks
              currentLocale={currentLocale}
              languageLabels={languageLabels}
            />
          </Suspense>
        </nav>
      </div>
    </header>
  );
}
