"use client";

import { Menu, UserRound, X } from "lucide-react";
import Link from "next/link";
import { Suspense, useState } from "react";
import type { Locale } from "@/features/i18n";
import {
  LocaleSwitcherLabels,
  LocaleSwitcherLinks,
} from "@/shared/components/locale-switcher-links";
import { HorizontalLogo, Logo } from "@/shared/components/logo";
import type { SiteHeaderMenuItem } from "@/shared/components/site-header-config";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";

type SiteHeaderProps = {
  accountHref: string;
  accountLabel: string;
  currentLocale: Locale;
  languageLabels: Record<Locale, string>;
  links: SiteHeaderMenuItem[];
  contactLabel: string;
  contactHref: string;
  closeNavigationMenuLabel: string;
  languageSwitcherLabel: string;
  mobilePrimaryNavigationLabel: string;
  openNavigationMenuLabel: string;
  primaryNavigationLabel: string;
};

export function SiteHeader({
  accountHref,
  accountLabel,
  currentLocale,
  languageLabels,
  links,
  contactLabel,
  contactHref,
  closeNavigationMenuLabel,
  languageSwitcherLabel,
  mobilePrimaryNavigationLabel,
  openNavigationMenuLabel,
  primaryNavigationLabel,
}: SiteHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const closeMenu = () => setMobileMenuOpen(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 h-(--site-header-height) border-b border-white/10 bg-navy-blue/92 text-white backdrop-blur-md">
      <div className="mx-auto flex h-full w-full max-w-8xl items-center justify-between gap-3 px-3 sm:gap-4 sm:px-6 lg:px-8">
        <Link
          href={`/${currentLocale}`}
          aria-label="Deskohub Workspace"
          className="shrink-0"
          onClick={closeMenu}
        >
          <span className="block sm:hidden">
            <Logo
              styling={{ color: "dark", variant: "color" }}
              alt=""
              height={48}
            />
          </span>
          <span className="hidden sm:block">
            <HorizontalLogo
              styling={{ color: "dark", variant: "color" }}
              className="scale-80"
            />
          </span>
        </Link>

        <nav
          aria-label={primaryNavigationLabel}
          className="hidden items-center gap-6 xl:flex"
        >
          {links.map((link) => (
            <Link
              key={link.id}
              href={link.href}
              className="text-balance text-center text-sm uppercase tracking-[0.12em] text-white/76 transition-colors hover:text-sunset-yellow"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3 xl:gap-3">
          <Link
            href={accountHref}
            className="inline-flex size-10 items-center justify-center rounded-full border border-white/12 bg-white/6 text-white/82 transition-colors hover:border-sunset-yellow/55 hover:text-sunset-yellow"
            aria-label={accountLabel}
            title={accountLabel}
            onClick={closeMenu}
          >
            <UserRound aria-hidden className="size-4.5" />
          </Link>

          <Link
            href={contactHref}
            className="shrink-0 whitespace-nowrap rounded-full border border-white/12 bg-white px-3 py-2 text-center text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-navy-blue transition-colors hover:bg-sunset-yellow sm:px-4 sm:text-xs sm:tracking-[0.14em]"
            onClick={closeMenu}
          >
            {contactLabel}
          </Link>

          <nav
            aria-label={languageSwitcherLabel}
            data-locale-switcher
            className="hidden rounded-full border border-white/12 bg-white/6 px-6 py-2 text-center text-xs uppercase tracking-[0.14em] text-white/72 xl:block"
          >
            <Suspense
              fallback={
                <LocaleSwitcherLabels
                  currentLocale={currentLocale}
                  languageLabels={languageLabels}
                />
              }
            >
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
              mobileMenuOpen
                ? closeNavigationMenuLabel
                : openNavigationMenuLabel
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
          "overflow-hidden bg-navy-blue/98 transition-[max-height,visibility] duration-300 motion-reduce:transition-none xl:hidden",
          mobileMenuOpen
            ? "visible max-h-128 border-t border-white/10"
            : "invisible max-h-0"
        )}
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <nav aria-label={mobilePrimaryNavigationLabel} className="grid gap-2">
            <Link
              href={accountHref}
              onClick={closeMenu}
              className="flex items-center gap-2 rounded-2xl border border-sunset-yellow/28 bg-sunset-yellow/10 px-4 py-3 text-sm uppercase tracking-[0.12em] text-white transition-colors hover:border-sunset-yellow/60 hover:text-sunset-yellow"
            >
              <UserRound aria-hidden className="size-4" />
              {accountLabel}
            </Link>
            {links.map((link) => (
              <Link
                key={link.id}
                href={link.href}
                onClick={closeMenu}
                className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-sm uppercase tracking-[0.12em] text-white/80 transition-colors hover:border-sunset-yellow/60 hover:text-sunset-yellow"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div
            data-locale-switcher
            className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-xs uppercase tracking-[0.14em] text-white/72"
          >
            <Suspense
              fallback={
                <LocaleSwitcherLabels
                  currentLocale={currentLocale}
                  languageLabels={languageLabels}
                  isMobile
                />
              }
            >
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
