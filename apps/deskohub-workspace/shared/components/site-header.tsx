"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import {
  type Locale,
  locales,
  withLocalePrefixAndSearch,
} from "@/features/i18n";
import { HorizontalLogo } from "@/shared/components/logo";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";

type SiteHeaderProps = {
  currentLocale: Locale;
  languageLabels: Record<Locale, string>;
  links: Array<{ label: string; href: string }>;
  contactLabel: string;
  contactHref: string;
};

type LocaleSwitcherLinksProps = Pick<
  SiteHeaderProps,
  "currentLocale" | "languageLabels"
> & {
  closeMenu?: () => void;
  isMobile?: boolean;
};

function LocaleSwitcherLinks({
  currentLocale,
  languageLabels,
  closeMenu,
  isMobile = false,
}: LocaleSwitcherLinksProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const getLocaleHref = (locale: Locale) =>
    withLocalePrefixAndSearch(pathname, locale, searchParams);

  return locales.map((locale, index) => {
    const isCurrent = locale === currentLocale;

    if (isMobile) {
      return isCurrent ? (
        <strong key={locale} className="text-white">
          {languageLabels[locale]}
        </strong>
      ) : (
        <Link
          key={locale}
          href={getLocaleHref(locale)}
          scroll={false}
          onClick={closeMenu}
          className="transition-colors hover:text-sunset-yellow"
        >
          {languageLabels[locale]}
        </Link>
      );
    }

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

export function SiteHeader({
  currentLocale,
  languageLabels,
  links,
  contactLabel,
  contactHref,
}: SiteHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const closeMenu = () => setMobileMenuOpen(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 h-(--site-header-height) border-b border-white/10 bg-navy-blue/92 text-white backdrop-blur-md">
      <div className="mx-auto flex h-full w-full max-w-8xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href={`/${currentLocale}`}
          className="shrink-0"
          onClick={closeMenu}
        >
          <HorizontalLogo
            styling={{ color: "dark", variant: "color" }}
            className="scale-80"
          />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-6 xl:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-balance text-center text-sm uppercase tracking-[0.12em] text-white/76 transition-colors hover:text-sunset-yellow"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3 xl:gap-3">
          <Link
            href={contactHref}
            className="rounded-full border border-white/12 bg-white px-3 py-2 text-center text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-navy-blue transition-colors hover:bg-sunset-yellow sm:px-4 sm:text-xs sm:tracking-[0.14em]"
            onClick={closeMenu}
          >
            {contactLabel}
          </Link>

          <nav
            aria-label="Language switcher"
            className="hidden rounded-full border border-white/12 bg-white/6 px-6 py-2 text-center text-xs uppercase tracking-[0.14em] text-white/72 xl:block"
          >
            <Suspense fallback={null}>
              <LocaleSwitcherLinks
                currentLocale={currentLocale}
                languageLabels={languageLabels}
              />
            </Suspense>
          </nav>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-full border border-white/12 bg-white/6 text-white hover:bg-white/12 hover:text-white xl:hidden"
            aria-expanded={mobileMenuOpen}
            aria-controls="site-header-mobile-menu"
            aria-label={
              mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"
            }
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </Button>
        </div>
      </div>

      <div
        id="site-header-mobile-menu"
        className={cn(
          "overflow-hidden bg-navy-blue/98 transition-[max-height] duration-300 xl:hidden",
          mobileMenuOpen ? "max-h-128 border-t border-white/10" : "max-h-0"
        )}
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <nav aria-label="Mobile primary" className="grid gap-2">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={closeMenu}
                className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-sm uppercase tracking-[0.12em] text-white/80 transition-colors hover:border-sunset-yellow/60 hover:text-sunset-yellow"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-xs uppercase tracking-[0.14em] text-white/72">
            <Suspense fallback={null}>
              <LocaleSwitcherLinks
                currentLocale={currentLocale}
                languageLabels={languageLabels}
                closeMenu={closeMenu}
                isMobile
              />
            </Suspense>
          </div>
        </div>
      </div>
    </header>
  );
}
