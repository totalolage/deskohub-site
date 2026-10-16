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
import { AdministrationLink as Link } from "./admin-link";
import { m } from "./i18n";
import { AdministrationBreadcrumbLoading } from "./loading";

// Every shell label is a message without inputs.
type ShellMessage = typeof m.shellNavigationOverview;

type NavigationEntry = {
  readonly href: string;
  readonly icon: ComponentType<SVGProps<SVGSVGElement>>;
  readonly label: ShellMessage;
};

const navigation = [
  {
    label: m.shellNavigationSectionOperations,
    items: [
      { href: "/admin", icon: CircleGauge, label: m.shellNavigationOverview },
      {
        href: "/admin/reservations",
        icon: CalendarRange,
        label: m.shellNavigationReservations,
      },
      {
        href: "/admin/customers",
        icon: Users,
        label: m.shellNavigationCustomers,
      },
      {
        href: "/admin/invoices",
        icon: FileText,
        label: m.shellNavigationInvoices,
      },
      { href: "/admin/codes", icon: Ticket, label: m.shellNavigationCodes },
      {
        href: "/admin/access-codes",
        icon: KeyRound,
        label: m.shellNavigationAccessCodes,
      },
      { href: "/admin/vouchers", icon: Gift, label: m.shellNavigationVouchers },
      {
        href: "/admin/sales",
        icon: BadgePercent,
        label: m.shellNavigationSales,
      },
      {
        href: "/admin/cli/sessions",
        icon: SquareTerminal,
        label: m.shellNavigationCliSessions,
      },
      {
        href: "/admin/administrators",
        icon: ShieldCheck,
        label: m.administratorsNavigation,
      },
    ],
  },
  {
    label: m.shellNavigationSectionEmail,
    items: [
      {
        href: "/admin/email-campaigns",
        icon: Mail,
        label: m.shellNavigationCampaigns,
      },
      {
        href: "/admin/email-audiences",
        icon: ListFilter,
        label: m.shellNavigationAudiences,
      },
    ],
  },
] as const satisfies readonly {
  readonly label: ShellMessage;
  readonly items: readonly NavigationEntry[];
}[];

// Navigation hrefs are unprefixed; the current pathname carries the locale.
const isActive = (pathname: string, href: string) => {
  const unprefixedPathname = stripLocaleFromPathname(pathname, locales);
  return href === "/admin"
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
  return (
    <nav
      aria-label={m.shellNavigationLabel({}, { locale })}
      className="space-y-7"
    >
      {navigation.map((section) => (
        <div key={section.items[0].href}>
          <p className="mb-2 px-3 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-navy-blue/65">
            {section.label({}, { locale })}
          </p>
          <ul className="space-y-1">
            {section.items.map((item) => {
              return (
                <li key={item.href}>
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
  const active = pathname ? isActive(pathname, item.href) : false;
  const Icon = item.icon;
  const link = (
    <NavItem active={active} asChild>
      <Link href={item.href}>
        <Icon aria-hidden />
        {item.label({}, { locale })}
      </Link>
    </NavItem>
  );
  return mobile ? <SheetClose asChild>{link}</SheetClose> : link;
}

const breadcrumbNames: Readonly<Record<string, ShellMessage>> = {
  admin: m.shellBreadcrumbOverview,
  "access-codes": m.shellBreadcrumbAccessCodes,
  administrators: m.administratorsBreadcrumb,
  bookings: m.shellBreadcrumbBookings,
  cli: m.shellBreadcrumbCli,
  codes: m.shellBreadcrumbCodes,
  customers: m.shellBreadcrumbCustomers,
  "create-code": m.shellBreadcrumbCreateDiscountCode,
  "create-voucher": m.shellBreadcrumbCreateVoucher,
  discounts: m.shellBreadcrumbDiscounts,
  "email-audiences": m.shellBreadcrumbAudiences,
  "email-campaigns": m.shellBreadcrumbCampaigns,
  recipients: m.shellBreadcrumbRecipients,
  invoices: m.shellBreadcrumbInvoices,
  new: m.shellBreadcrumbNewInvoice,
  authenticate: m.shellBreadcrumbAuthenticate,
  operations: m.shellBreadcrumbOperations,
  orders: m.shellBreadcrumbOrders,
  reservations: m.shellBreadcrumbReservations,
  sales: m.shellBreadcrumbSales,
  vouchers: m.shellBreadcrumbVouchers,
  sessions: m.shellBreadcrumbSessions,
};

// The label of a record segment, by the collection segment before it.
const breadcrumbRecordNames: Readonly<Record<string, ShellMessage>> = {
  codes: m.shellBreadcrumbCode,
  bookings: m.shellBreadcrumbBooking,
  customers: m.shellBreadcrumbCustomer,
  "email-audiences": m.shellBreadcrumbAudience,
  "email-campaigns": m.shellBreadcrumbCampaign,
  invoices: m.shellBreadcrumbInvoice,
  operations: m.shellBreadcrumbOperation,
  orders: m.shellBreadcrumbOrder,
  reservations: m.shellBreadcrumbReservation,
  vouchers: m.shellBreadcrumbVoucher,
};

export function AdministrationBreadcrumbs({
  entityLabel,
  segmentLabels,
  segments,
}: {
  readonly entityLabel?: string;
  readonly segmentLabels?: Readonly<Record<string, string>>;
  readonly segments: readonly string[];
}) {
  const locale = useRouteLocale();
  const crumbs = segments.map((segment, index) => ({
    href: `/${segments.slice(0, index + 1).join("/")}`,
    label:
      segmentLabels?.[segment] ||
      (index === segments.length - 1 && entityLabel) ||
      (Object.hasOwn(breadcrumbNames, segment)
        ? breadcrumbNames[segment]
        : breadcrumbRecordNames[segments[index - 1] ?? ""])?.({}, { locale }) ||
      segment,
  }));
  return (
    <nav
      aria-label={m.shellBreadcrumbLabel({}, { locale })}
      className="min-w-0"
    >
      <ol className="flex min-w-0 items-center gap-1.5 text-sm text-navy-blue/65">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li className="flex min-w-0 items-center gap-1.5" key={crumb.href}>
              {index > 0 && <ChevronRight aria-hidden className="size-3.5" />}
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

function Brand({ locale }: { readonly locale: Locale }) {
  return (
    <Link className="flex items-center gap-3" href="/admin">
      <span className="grid size-9 place-items-center rounded-lg bg-burned-orange text-sm font-semibold text-white">
        D
      </span>
      <span>
        <span className="block text-sm font-semibold leading-none">
          Deskohub
        </span>
        <span className="mt-1 block text-xs text-navy-blue/65">
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
                  className="lg:hidden"
                  size="icon"
                  variant="ghost"
                >
                  <Menu aria-hidden className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent className="px-4 py-5" locale={locale} side="left">
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
            <div className="lg:hidden">
              <Brand locale={locale} />
            </div>
            <div className="hidden min-w-0 lg:block">
              <Suspense fallback={<AdministrationBreadcrumbLoading />}>
                {breadcrumb}
              </Suspense>
            </div>
            <div className="ml-auto">{localeSwitcher}</div>
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
