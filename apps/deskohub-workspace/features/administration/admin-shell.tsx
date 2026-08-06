"use client";

import {
  BadgePercent,
  CalendarCheck2,
  CalendarRange,
  ChevronRight,
  CircleGauge,
  CreditCard,
  ListChecks,
  Menu,
  Percent,
  Ticket,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { Button } from "@/shared/components/ui/button";
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

type NavItem = {
  readonly href: string;
  readonly icon: ComponentType<SVGProps<SVGSVGElement>>;
  readonly label: string;
};

const navigation = [
  {
    label: "Operations",
    items: [
      { href: "/admin", icon: CircleGauge, label: "Overview" },
      {
        href: "/admin/reservations",
        icon: CalendarRange,
        label: "Reservations",
      },
      { href: "/admin/bookings", icon: CalendarCheck2, label: "Bookings" },
      { href: "/admin/customers", icon: Users, label: "Customers" },
    ],
  },
  {
    label: "Payments",
    items: [
      { href: "/admin/orders", icon: CreditCard, label: "Orders" },
      { href: "/admin/operations", icon: ListChecks, label: "Operations" },
    ],
  },
  {
    label: "Configuration",
    items: [
      { href: "/admin/discounts", icon: Percent, label: "Discounts" },
      { href: "/admin/codes", icon: Ticket, label: "Codes" },
      { href: "/admin/sales", icon: BadgePercent, label: "Sales" },
    ],
  },
] as const;

const isActive = (pathname: string, href: string) =>
  href === "/admin" ? pathname === href : pathname.startsWith(href);

function Navigation({ mobile = false }: { readonly mobile?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Administration" className="space-y-7">
      {navigation.map((section) => (
        <div key={section.label}>
          <p className="mb-2 px-3 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-navy-blue/65">
            {section.label}
          </p>
          <ul className="space-y-1">
            {section.items.map((item) => {
              return (
                <li key={item.href}>
                  <NavigationLink
                    item={item}
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
  mobile,
  pathname,
}: {
  readonly item: NavItem;
  readonly mobile: boolean;
  readonly pathname: string;
}) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  const link = (
    <Link
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors",
        active
          ? "bg-navy-blue text-white"
          : "text-navy-blue/68 hover:bg-navy-blue/6 hover:text-navy-blue"
      )}
      href={item.href}
    >
      <Icon aria-hidden className="size-4" />
      {item.label}
    </Link>
  );
  return mobile ? <SheetClose asChild>{link}</SheetClose> : link;
}

const breadcrumbNames: Record<string, string> = {
  admin: "Overview",
  bookings: "Bookings",
  codes: "Codes",
  customers: "Customers",
  "create-code": "Create discount code",
  discounts: "Discounts",
  operations: "Operations",
  orders: "Orders",
  reservations: "Reservations",
  sales: "Sales",
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
  const crumbs = segments.map((segment, index) => ({
    href: `/${segments.slice(0, index + 1).join("/")}`,
    label:
      segmentLabels?.[segment] ||
      (index === segments.length - 1 && entityLabel) ||
      breadcrumbNames[segment] ||
      ({
        codes: "Code",
        bookings: "Booking",
        customers: "Customer",
        operations: "Operation",
        orders: "Order",
        reservations: "Reservation",
      }[segments[index - 1] ?? ""] ??
        segment),
  }));
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
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

function Brand() {
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
          Workspace admin
        </span>
      </span>
    </Link>
  );
}

export function AdminShell({
  breadcrumb,
  children,
}: {
  readonly breadcrumb: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f6f6f3] text-navy-blue lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-navy-blue/10 bg-white px-4 py-5 lg:sticky lg:top-0 lg:block lg:h-screen">
        <Brand />
        <div className="mt-9">
          <Navigation />
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-40 border-b border-navy-blue/10 bg-white/95 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  aria-label="Open navigation"
                  className="lg:hidden"
                  size="icon"
                  variant="ghost"
                >
                  <Menu aria-hidden className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent className="px-4 py-5" side="left">
                <SheetHeader className="sr-only">
                  <SheetTitle>Administration navigation</SheetTitle>
                  <SheetDescription>
                    Choose an administration page.
                  </SheetDescription>
                </SheetHeader>
                <Brand />
                <div className="mt-9">
                  <Navigation mobile />
                </div>
              </SheetContent>
            </Sheet>
            <div className="lg:hidden">
              <Brand />
            </div>
            <div className="hidden min-w-0 lg:block">{breadcrumb}</div>
          </div>
        </header>
        <div className="border-b border-navy-blue/10 bg-white px-4 py-3 lg:hidden">
          {breadcrumb}
        </div>
        {children}
      </div>
    </div>
  );
}
