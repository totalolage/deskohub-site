"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { type WorkspaceLocale, workspaceLocales } from "@/features/i18n";
import { HorizontalLogo } from "@/shared/components/logo";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";

type LandingPageHeaderProps = {
  currentLocale: WorkspaceLocale;
  languageLabels: Record<WorkspaceLocale, string>;
  links: Array<{ label: string; href: string }>;
  contactLabel: string;
};

export function LandingPageHeader({
  currentLocale,
  languageLabels,
  links,
  contactLabel,
}: LandingPageHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const closeMenu = () => setMobileMenuOpen(false);

  return (
    <header className="fixed h-[var(--site-header-height)] inset-x-0 top-0 z-50 border-b border-white/10 bg-navy-blue/92 text-white backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-7xl h-full items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
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
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-center tracking-[0.12em] text-white/76 uppercase transition-colors hover:text-sunset-yellow"
            >
              {link.label}
            </a>
          ))}
          <a
            href={links.at(-1)?.href ?? `/${currentLocale}`}
            className="rounded-full text-center border border-white/12 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-navy-blue transition-colors hover:bg-sunset-yellow"
          >
            {contactLabel}
          </a>
        </nav>

        <div className="hidden items-center gap-3 xl:flex">
          <nav
            aria-label="Language switcher"
            className="text-center rounded-full border border-white/12 bg-white/6 px-6 py-2 text-xs uppercase tracking-[0.14em] text-white/72"
          >
            {workspaceLocales.map((locale, index) => {
              const isCurrent = locale === currentLocale;

              return (
                <span
                  key={locale}
                  className={cn(
                    index > 0 &&
                      "before:content-['/'] before:text-white/28 before:absolute before:translate-x-[0.5ch]"
                  )}
                >
                  {index > 0 && <br />}
                  {isCurrent ? (
                    <strong className="text-white">
                      {languageLabels[locale]}
                    </strong>
                  ) : (
                    <Link
                      href={`/${locale}`}
                      className="transition-colors hover:text-sunset-yellow"
                    >
                      {languageLabels[locale]}
                    </Link>
                  )}
                </span>
              );
            })}
          </nav>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full border border-white/12 bg-white/6 text-white hover:bg-white/12 hover:text-white xl:hidden"
          aria-expanded={mobileMenuOpen}
          aria-controls="landing-mobile-menu"
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

      <div
        id="landing-mobile-menu"
        className={cn(
          "overflow-hidden border-white/10 bg-navy-blue/98 transition-[max-height] duration-300 xl:hidden",
          mobileMenuOpen ? "max-h-[32rem] border-t" : "max-h-0"
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
            {workspaceLocales.map((locale) => {
              const isCurrent = locale === currentLocale;

              return isCurrent ? (
                <strong key={locale} className="text-white">
                  {languageLabels[locale]}
                </strong>
              ) : (
                <Link
                  key={locale}
                  href={`/${locale}`}
                  onClick={closeMenu}
                  className="transition-colors hover:text-sunset-yellow"
                >
                  {languageLabels[locale]}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </header>
  );
}
