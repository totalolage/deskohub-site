"use client";

import { stripLocaleFromPathname } from "@deskohub/i18n/pathname";
import {
  BadgePercent,
  CalendarRange,
  ChevronRight,
  CircleGauge,
  FileText,
  Gift,
  KeyRound,
  ListFilter,
  Mail,
  Menu,
  ShieldCheck,
  SquareTerminal,
  Ticket,
  Users,
} from "lucide-react";
import { usePathname } from "next/navigation";
import {
  type ComponentType,
  type ReactNode,
  Suspense,
  type SVGProps,
  useId,
} from "react";
import { type Locale, locales } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { SkipLink } from "@/shared/components/skip-link";
import { Button } from "@/shared/components/ui/button";
import { NavItem } from "@/shared/components/ui/nav-item";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/components/ui/sheet";
import { cn } from "@/shared/utils";
import { AdministrationLink as Link } from "./admin-link";
import {
  type AdministrationLabel,
  administrationAreas,
  administrationOverview,
  getAdministrationTrail,
} from "./administration-areas";
import type { AdministrationHref } from "./administration-href";
import { m } from "./i18n";
import { AdministrationBreadcrumbLoading } from "./loading";

type NavigationEntry = {
  readonly icon: ComponentType<SVGProps<SVGSVGElement>>;
  readonly page: {
    readonly href: AdministrationHref;
    readonly label: AdministrationLabel;
  };
};

// An area's entry links to its collection under its breadcrumb label.
const navigation = [
  {
    label: m.shellNavigationSectionOperations,
    items: [
      { icon: CircleGauge, page: administrationOverview },
      { icon: CalendarRange, page: administrationAreas.reservations },
      { icon: Users, page: administrationAreas.customers },
    ],
  },
  {
    label: m.shellNavigationSectionDiscounts,
    items: [
      { icon: Ticket, page: administrationAreas.codes },
      { icon: Gift, page: administrationAreas.vouchers },
      { icon: BadgePercent, page: administrationAreas.sales },
    ],
  },
  {
    label: m.shellNavigationSectionEmail,
    items: [
      { icon: Mail, page: administrationAreas["email-campaigns"] },
      { icon: ListFilter, page: administrationAreas["email-audiences"] },
    ],
  },
  {
    label: m.shellNavigationSectionAdministration,
    items: [
      { icon: FileText, page: administrationAreas.invoices },
      { icon: KeyRound, page: administrationAreas["access-codes"] },
      { icon: ShieldCheck, page: administrationAreas.administrators },
      {
        icon: SquareTerminal,
        page: {
          href: administrationAreas.cli.pages.sessions.href,
          label: m.shellNavigationCliSessions,
        },
      },
    ],
  },
] as const satisfies readonly {
  readonly label: AdministrationLabel;
  readonly items: readonly NavigationEntry[];
}[];

// Navigation hrefs are unprefixed; the current pathname carries the locale.
const isActive = (pathname: string, href: AdministrationHref) => {
  const unprefixedPathname = stripLocaleFromPathname(pathname, locales);
  return href === administrationOverview.href
    ? unprefixedPathname === href
    : unprefixedPathname.startsWith(href);
};

function ActiveNavigation({ mobile = false }: { readonly mobile?: boolean }) {
  const pathname = usePathname();
  return <Navigation mobile={mobile} pathname={pathname} />;
}

function Navigation({
  mobile = false,
  pathname,
}: {
  readonly mobile?: boolean;
  readonly pathname?: string;
}) {
  const locale = useRouteLocale();
  // The desktop and mobile navigation render together, so headings need ids
  // unique to each instance.
  const id = useId();
  return (
    <nav
      aria-label={m.shellNavigationLabel({}, { locale })}
      className="space-y-7"
    >
      {navigation.map((section, index) => (
        <div key={section.items[0].page.href}>
          <p
            className="mb-2 px-3 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-navy-blue/65"
            id={`${id}-${index}`}
          >
            {section.label({}, { locale })}
          </p>
          <ul aria-labelledby={`${id}-${index}`} className="space-y-1">
            {section.items.map((item) => {
              return (
                <li key={item.page.href}>
                  <NavigationLink
                    item={item}
                    locale={locale}
                    mobile={mobile}
                    pathname={pathname}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function NavigationLink({
  item,
  locale,
  mobile,
  pathname,
}: {
  readonly item: NavigationEntry;
  readonly locale: Locale;
  readonly mobile: boolean;
  readonly pathname?: string;
}) {
  const active = pathname ? isActive(pathname, item.page.href) : false;
  const Icon = item.icon;
  const link = (
    <NavItem active={active} asChild>
      <Link href={item.page.href}>
        <Icon aria-hidden />
        {item.page.label({}, { locale })}
      </Link>
    </NavItem>
  );
  return mobile ? <SheetClose asChild>{link}</SheetClose> : link;
}

export function AdministrationBreadcrumbs({
  recordLabel,
  segments = [],
}: {
  readonly recordLabel?: string;
  /** The path under `/admin`; none for the overview. */
  readonly segments?: readonly string[];
}) {
  const locale = useRouteLocale();
  const crumbs = getAdministrationTrail(segments, locale, recordLabel);
  return (
    <nav
      aria-label={m.shellBreadcrumbLabel({}, { locale })}
      className="min-w-0"
    >
      {/* Below lg the trail has its own row, so it wraps instead of
          truncating every label; a phone drops the Overview root, which the
          brand already links to. */}
      <ol className="flex min-w-0 items-center gap-1.5 text-sm text-navy-blue/65 max-lg:flex-wrap max-lg:gap-y-1">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          const phoneRoot = index === 0 && !last;
          return (
            <li
              className={cn(
                "flex min-w-0 items-center gap-1.5 max-lg:max-w-full",
                phoneRoot && "max-sm:hidden"
              )}
              key={crumb.href}
            >
              {index > 0 && (
                <ChevronRight
                  aria-hidden
                  className={cn(
                    "size-3.5 max-lg:shrink-0",
                    index === 1 && "max-sm:hidden"
                  )}
                />
              )}
              {last ? (
                <span className="truncate font-semibold text-navy-blue">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  className="truncate hover:text-navy-blue"
                  href={crumb.href}
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Brand({
  labelClassName,
  locale,
}: {
  readonly labelClassName?: string;
  readonly locale: Locale;
}) {
  return (
    <Link
      className="flex min-w-0 items-center gap-3"
      href={administrationOverview.href}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-burned-orange text-sm font-semibold text-white">
        D
      </span>
      <span className={cn("min-w-0", labelClassName)}>
        <span className="block truncate text-sm font-semibold leading-none">
          Deskohub
        </span>
        <span className="mt-1 block overflow-hidden text-ellipsis text-xs text-navy-blue/65">
          {m.shellBrandSubtitle({}, { locale })}
        </span>
      </span>
    </Link>
  );
}

export function AdminShell({
  breadcrumb,
  children,
  localeSwitcher,
}: {
  readonly breadcrumb: ReactNode;
  readonly children: ReactNode;
  readonly localeSwitcher: ReactNode;
}) {
  const locale = useRouteLocale();

  return (
    <div className="min-h-screen bg-[#f6f6f3] text-navy-blue lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <SkipLink label={m.shellSkipToMainContent({}, { locale })} />
      <aside className="hidden border-r border-navy-blue/10 bg-white lg:block">
        <div className="sticky top-0 max-h-screen overflow-y-auto px-4 py-5">
          <Brand locale={locale} />
          <div className="mt-9">
            <Suspense fallback={<Navigation />}>
              <ActiveNavigation />
            </Suspense>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-40 border-b border-navy-blue/10 bg-white/95 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  aria-label={m.shellOpenNavigation({}, { locale })}
                  className="shrink-0 lg:hidden"
                  size="icon"
                  variant="ghost"
                >
                  <Menu aria-hidden className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                className="overflow-y-auto px-4 py-5"
                locale={locale}
                side="left"
              >
                <SheetHeader className="sr-only">
                  <SheetTitle>
                    {m.shellMobileNavigationTitle({}, { locale })}
                  </SheetTitle>
                  <SheetDescription>
                    {m.shellMobileNavigationDescription({}, { locale })}
                  </SheetDescription>
                </SheetHeader>
                <Brand locale={locale} />
                <div className="mt-9">
                  <Suspense fallback={<Navigation mobile />}>
                    <ActiveNavigation mobile />
                  </Suspense>
                </div>
              </SheetContent>
            </Sheet>
            <div className="min-w-0 lg:hidden">
              <Brand labelClassName="max-[379px]:sr-only" locale={locale} />
            </div>
            <div className="hidden min-w-0 lg:block">
              <Suspense fallback={<AdministrationBreadcrumbLoading />}>
                {breadcrumb}
              </Suspense>
            </div>
            <div className="ml-auto shrink-0">{localeSwitcher}</div>
          </div>
        </header>
        <div className="border-b border-navy-blue/10 bg-white px-4 py-3 lg:hidden">
          <Suspense fallback={<AdministrationBreadcrumbLoading />}>
            {breadcrumb}
          </Suspense>
        </div>
        {children}
      </div>
    </div>
  );
}
