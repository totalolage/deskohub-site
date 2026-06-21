"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import {
  type Locale,
  locales,
  withLocalePrefixAndSearch,
} from "@/features/i18n";
import { HorizontalLogo } from "@/shared/components/logo";
import { cn } from "@/shared/utils";

type MinimalSiteHeaderProps = {
  currentLocale: Locale;
  languageLabels: Record<Locale, string>;
};

function MinimalLocaleSwitcherLinks({
  currentLocale,
  languageLabels,
}: MinimalSiteHeaderProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const getLocaleHref = (locale: Locale) =>
    withLocalePrefixAndSearch(pathname, locale, searchParams);

  return locales.map((locale, index) => {
    const isCurrent = locale === currentLocale;

    return (
      <span
        key={locale}
        className={cn(
          index > 0 &&
            "before:absolute before:translate-x-[0.5ch] before:text-white/28 before:content-['/']"
        )}
      >
        {index > 0 && <br />}
        {isCurrent ? (
          <strong className="text-white">{languageLabels[locale]}</strong>
        ) : (
          <Link
            href={getLocaleHref(locale)}
            prefetch={false}
            scroll={false}
            className="transition-colors hover:text-sunset-yellow"
          >
            {languageLabels[locale]}
          </Link>
        )}
      </span>
    );
  });
}

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
            <MinimalLocaleSwitcherLinks
              currentLocale={currentLocale}
              languageLabels={languageLabels}
            />
          </Suspense>
        </nav>
      </div>
    </header>
  );
}
