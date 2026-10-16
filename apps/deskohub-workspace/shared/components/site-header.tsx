"use client";

import { Menu, UserRound, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { Suspense, use, useState } from "react";
import type { LocalePreferenceSaving } from "@/features/account/switch-locale";
import type { Locale } from "@/features/i18n";
import { GuardedLink as Link } from "@/shared/components/guarded-link";
import {
  LocaleSwitcherLabels,
  LocaleSwitcherLinks,
} from "@/shared/components/locale-switcher-links";
import type {
  SiteHeaderAccountEntry,
  SiteHeaderMenuItem,
} from "@/shared/components/site-header-config";
import { SiteHeaderLogo } from "@/shared/components/site-header-logo";
import { Button } from "@/shared/components/ui/button";
import { NavItem } from "@/shared/components/ui/nav-item";
import { cn } from "@/shared/utils";

type SiteHeaderProps = {
  account?: SiteHeaderAccountEntry;
  currentLocale: Locale;
  languageLabels: Record<Locale, string>;
  localePreference?: LocalePreferenceSaving;
  links: SiteHeaderMenuItem[];
  contactLabel: string;
  contactHref: string;
  closeNavigationMenuLabel: string;
  languageSwitcherLabel: string;
  mobilePrimaryNavigationLabel: string;
  openNavigationMenuLabel: string;
  primaryNavigationLabel: string;
};

type AccountLinkProps = {
  readonly active?: boolean;
  readonly href: string;
  readonly label: string;
  readonly mobile?: boolean;
  readonly onClick?: () => void;
};

function AccountLink({
  active = false,
  href,
  label,
  mobile = false,
  onClick,
}: AccountLinkProps) {
  return (
    <NavItem
      active={active}
      asChild
      caps={mobile}
      layout={mobile ? "row" : "icon"}
      tone="inverse"
    >
      <Link
        href={href}
        aria-label={mobile ? undefined : label}
        title={mobile ? undefined : label}
        onClick={onClick}
      >
        <UserRound aria-hidden />
        {mobile && label}
      </Link>
    </NavItem>
  );
}

type AccountEntryLinkProps = Omit<
  AccountLinkProps,
  "active" | "href" | "label"
> & {
  readonly entry: SiteHeaderAccountEntry;
};

function ResolvedAccountLink({ entry, ...props }: AccountEntryLinkProps) {
  const href = use(entry.href);
  const pathname = usePathname();
  return (
    <AccountLink
      {...props}
      href={href}
      label={entry.label}
      active={pathname === href}
    />
  );
}

function AccountEntryLink(props: AccountEntryLinkProps) {
  return (
    <Suspense
      fallback={
        <AccountLink
          {...props}
          href={props.entry.signInHref}
          label={props.entry.label}
        />
      }
    >
      <ResolvedAccountLink {...props} />
    </Suspense>
  );
}

type NavigationLinkProps = {
  readonly active?: boolean;
  readonly href: string;
  readonly label: string;
  readonly mobile?: boolean;
  readonly onClick?: () => void;
};

function NavigationLink({
  active = false,
  href,
  label,
  mobile = false,
  onClick,
}: NavigationLinkProps) {
  if (mobile) {
    return (
      <NavItem active={active} asChild caps tone="inverse">
        <Link href={href} onClick={onClick}>
          {label}
        </Link>
      </NavItem>
    );
  }

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="text-balance text-center text-sm uppercase tracking-[0.12em] text-white/76 transition-colors hover:text-sunset-yellow"
      onClick={onClick}
    >
      {label}
    </Link>
  );
}

function ActiveNavigationLink(props: Omit<NavigationLinkProps, "active">) {
  const pathname = usePathname();
  return <NavigationLink {...props} active={pathname === props.href} />;
}

function CurrentPageNavigationLink(props: Omit<NavigationLinkProps, "active">) {
  return (
    <Suspense fallback={<NavigationLink {...props} />}>
      <ActiveNavigationLink {...props} />
    </Suspense>
  );
}

export function SiteHeader({
  account,
  currentLocale,
  languageLabels,
  localePreference,
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
          <SiteHeaderLogo />
        </Link>

        <nav
          aria-label={primaryNavigationLabel}
          className="hidden items-center gap-4 xl:flex 2xl:gap-6"
        >
          {links.map((link) => (
            <CurrentPageNavigationLink
              key={link.id}
              href={link.href}
              label={link.label}
            />
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3 xl:gap-3">
          <Button
            asChild
            variant="secondary"
            tone="inverse"
            size="sm"
            caps
            className="shrink-0"
          >
            <Link href={contactHref} onClick={closeMenu}>
              {contactLabel}
            </Link>
          </Button>

          {account !== undefined && (
            <AccountEntryLink entry={account} onClick={closeMenu} />
          )}

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
                localePreference={localePreference}
              />
            </Suspense>
          </nav>

          <Button
            type="button"
            variant="ghost"
            tone="inverse"
            size="icon"
            className="xl:hidden"
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
            {account !== undefined && (
              <AccountEntryLink entry={account} mobile onClick={closeMenu} />
            )}
            {links.map((link) => (
              <CurrentPageNavigationLink
                key={link.id}
                href={link.href}
                label={link.label}
                mobile
                onClick={closeMenu}
              />
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
                localePreference={localePreference}
              />
            </Suspense>
          </div>
        </div>
      </div>
    </header>
  );
}
