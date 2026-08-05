import { AlertCircle, ArrowRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { cn } from "@/shared/utils";
import type {
  AdministrationBookingSummary,
  AdministrationReservationSummary,
  AdministrationTimelineItem,
} from "./administration.service";
import type { AdministrationReservationStatus } from "./reservation-status";

export type AdministrationNotice = {
  readonly message: string;
  readonly status: "error" | "success";
};

export function AdministrationPage({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <main
      className={cn(
        "mx-auto w-full max-w-[92rem] px-4 py-7 sm:px-6 lg:px-8 lg:py-9",
        className
      )}
    >
      {children}
    </main>
  );
}

export function AdministrationPageHeader({
  actions,
  count,
  description,
  eyebrow,
  title,
}: {
  readonly actions?: ReactNode;
  readonly count?: number;
  readonly description?: string;
  readonly eyebrow?: string;
  readonly title: string;
}) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-burned-orange-ink">
            {eyebrow}
          </p>
        )}
        <div className="flex items-center gap-3">
          <h1 className="text-3xl leading-tight tracking-[-0.025em] sm:text-4xl">
            {title}
          </h1>
          {count !== undefined && <Badge variant="subtle">{count}</Badge>}
        </div>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-navy-blue/62">
            {description}
          </p>
        )}
      </div>
      {actions}
    </div>
  );
}

export function AdministrationNoticeBanner({
  notice,
}: {
  readonly notice?: AdministrationNotice;
}) {
  if (!notice) return null;
  return (
    <div
      className={cn(
        "mb-5 flex items-start gap-3 rounded-xl px-4 py-3",
        notice.status === "success"
          ? "bg-aquamarine-green/15 text-aquamarine-ink"
          : "bg-burned-orange/10 text-burned-orange-ink"
      )}
      role={notice.status === "error" ? "alert" : "status"}
    >
      {notice.status === "success" ? (
        <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0" />
      ) : (
        <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0" />
      )}
      <p className="text-sm font-semibold leading-6">{notice.message}</p>
    </div>
  );
}

export function ReservationStatusBadge({
  status,
}: {
  readonly status: AdministrationReservationStatus;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
        status.group === "attention" &&
          "border-burned-orange/25 bg-burned-orange/10 text-burned-orange-ink",
        status.group === "in_progress" &&
          "border-sunset-yellow/35 bg-sunset-yellow/15 text-navy-blue",
        status.group === "complete" &&
          "border-aquamarine-green/35 bg-aquamarine-green/12 text-aquamarine-ink",
        status.group === "cancelled" &&
          "border-navy-blue/12 bg-navy-blue/5 text-navy-blue/60"
      )}
    >
      {status.label}
    </span>
  );
}

const workspaceTimeZone = "Europe/Prague";

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: workspaceTimeZone,
});

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: workspaceTimeZone,
});

export const formatAdministrationDateTime = (value: string) =>
  dateTimeFormatter.format(new Date(value));

export const formatAdministrationDate = (value: string) =>
  dateFormatter.format(new Date(value));

export const formatAdministrationMoney = ({
  currency,
  exponent,
  value,
}: {
  readonly currency: string;
  readonly exponent: number;
  readonly value: number;
}) =>
  new Intl.NumberFormat("en-GB", {
    currency,
    style: "currency",
  }).format(value / 10 ** exponent);

export function BookingStatusBadge({
  booking,
}: {
  readonly booking: Pick<
    AdministrationBookingSummary,
    "status" | "statusLabel"
  >;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
        booking.status === "CONFIRMED" &&
          "border-aquamarine-green/35 bg-aquamarine-green/12 text-aquamarine-ink",
        booking.status === "NEW" &&
          "border-sunset-yellow/35 bg-sunset-yellow/15 text-navy-blue",
        booking.status === "CANCELLED" &&
          "border-navy-blue/12 bg-navy-blue/5 text-navy-blue/60"
      )}
    >
      {booking.statusLabel}
    </span>
  );
}

export function BookingTable({
  bookings,
  emptyMessage = "No bookings match this date.",
}: {
  readonly bookings: readonly AdministrationBookingSummary[];
  readonly emptyMessage?: string;
}) {
  if (bookings.length === 0) return <EmptyState message={emptyMessage} />;
  return (
    <div className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
      <div className="hidden overflow-x-auto md:block">
        <Table aria-label="Bookings" className="min-w-[820px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Booking</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Table</TableHead>
              <TableHead>Reservation</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bookings.map((booking) => (
              <TableRow className="relative" key={booking.id}>
                <TableCell>
                  <Link
                    className="font-semibold underline decoration-navy-blue/20 underline-offset-4 before:absolute before:inset-0 before:content-[''] hover:decoration-navy-blue focus-visible:outline-none focus-visible:before:ring-2 focus-visible:before:ring-inset focus-visible:before:ring-navy-blue/40"
                    href={`/admin/bookings/${booking.id}`}
                  >
                    {formatAdministrationDateTime(booking.startsAt)}
                  </Link>
                  <p className="mt-1 text-xs text-navy-blue/65">
                    {booking.seats} {booking.seats === "1" ? "guest" : "guests"}
                  </p>
                </TableCell>
                <TableCell>
                  {booking.customer && booking.customerId ? (
                    <Link
                      className="relative z-10 font-medium hover:underline"
                      href={`/admin/customers/${booking.customerId}`}
                    >
                      {booking.customer.displayName}
                    </Link>
                  ) : (
                    <span className="text-sm text-navy-blue/65">
                      Details unavailable
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <p className="font-medium">
                    {booking.tableName ?? "Not assigned"}
                  </p>
                  {booking.tableLocation && (
                    <p className="mt-1 text-xs text-navy-blue/65">
                      {booking.tableLocation}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  {booking.linkedReservation ? (
                    <Link
                      className="relative z-10 font-medium hover:underline"
                      href={`/admin/reservations/${booking.linkedReservation.id}`}
                    >
                      {booking.linkedReservation.label}
                    </Link>
                  ) : (
                    <span className="text-sm text-navy-blue/65">
                      Not linked
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <BookingStatusBadge booking={booking} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="divide-y divide-navy-blue/10 md:hidden">
        {bookings.map((booking) => (
          <li key={booking.id}>
            <Link
              className="block px-4 py-4 hover:bg-navy-blue/[0.025]"
              href={`/admin/bookings/${booking.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {formatAdministrationDateTime(booking.startsAt)}
                  </p>
                  <p className="mt-1 text-sm text-navy-blue/65">
                    {booking.customer?.displayName ?? "Customer unavailable"}
                  </p>
                </div>
                <BookingStatusBadge booking={booking} />
              </div>
              <p className="mt-3 text-xs text-navy-blue/65">
                {booking.tableName ?? "No table assigned"} · {booking.seats}{" "}
                {booking.seats === "1" ? "guest" : "guests"}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReservationTable({
  emptyMessage = "No reservations match this view.",
  reservations,
}: {
  readonly emptyMessage?: string;
  readonly reservations: readonly AdministrationReservationSummary[];
}) {
  if (reservations.length === 0) return <EmptyState message={emptyMessage} />;
  return (
    <div className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
      <div className="hidden overflow-x-auto md:block">
        <Table aria-label="Reservations" className="min-w-[760px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Reservation</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Booking</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reservations.map((reservation) => (
              <TableRow className="relative" key={reservation.id}>
                <TableCell>
                  <Link
                    className="font-semibold underline decoration-navy-blue/20 underline-offset-4 before:absolute before:inset-0 before:content-[''] hover:decoration-navy-blue focus-visible:outline-none focus-visible:before:ring-2 focus-visible:before:ring-inset focus-visible:before:ring-navy-blue/40"
                    href={`/admin/reservations/${reservation.id}`}
                  >
                    {reservation.typeLabel}
                  </Link>
                  <p className="mt-1 font-mono text-xs text-navy-blue/65">
                    {reservation.id.slice(0, 12)}…
                  </p>
                </TableCell>
                <TableCell>
                  {reservation.customer ? (
                    <>
                      <Link
                        className="relative z-10 font-medium hover:underline"
                        href={`/admin/customers/${reservation.customerId}`}
                      >
                        {reservation.customer.displayName}
                      </Link>
                      <p className="mt-1 text-xs text-navy-blue/65">
                        {reservation.customer.email ??
                          reservation.customer.phone ??
                          "No contact details"}
                      </p>
                    </>
                  ) : (
                    <span className="text-sm text-navy-blue/65">
                      Details unavailable
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {reservation.startsAt ? (
                    <>
                      <p className="font-medium">
                        {formatAdministrationDateTime(reservation.startsAt)}
                      </p>
                      <p className="mt-1 text-xs text-navy-blue/65">
                        {reservation.typeLabel}
                      </p>
                    </>
                  ) : (
                    <span className="text-sm text-navy-blue/65">
                      Unavailable
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <ReservationStatusBadge status={reservation.status} />
                </TableCell>
                <TableCell className="text-right text-sm text-navy-blue/65">
                  {formatAdministrationDateTime(reservation.updatedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="divide-y divide-navy-blue/10 md:hidden">
        {reservations.map((reservation) => (
          <li key={reservation.id}>
            <Link
              className="block px-4 py-4 transition-colors hover:bg-navy-blue/[0.025]"
              href={`/admin/reservations/${reservation.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {reservation.customer?.displayName ?? reservation.typeLabel}
                  </p>
                  <p className="mt-1 text-sm text-navy-blue/65">
                    {reservation.startsAt
                      ? formatAdministrationDateTime(reservation.startsAt)
                      : "Booking details unavailable"}
                  </p>
                </div>
                <ReservationStatusBadge status={reservation.status} />
              </div>
              <p className="mt-3 text-xs text-navy-blue/65">
                {reservation.typeLabel}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReservationTimeline({
  items,
}: {
  readonly items: readonly AdministrationTimelineItem[];
}) {
  return (
    <ol className="relative space-y-0" aria-label="Reservation history">
      {items.map((item, index) => (
        <li
          className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-4 pb-7 last:pb-0"
          key={item.id}
        >
          {index < items.length - 1 && (
            <span className="absolute left-[0.59rem] top-5 h-[calc(100%-0.25rem)] w-px bg-navy-blue/12" />
          )}
          <span
            className={cn(
              "relative z-10 mt-1 size-5 rounded-full border-4 border-white",
              item.tone === "positive" && "bg-aquamarine-ink",
              item.tone === "warning" && "bg-burned-orange",
              item.tone === "neutral" && "bg-navy-blue/35"
            )}
          />
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">{item.title}</h3>
              <time
                className="text-xs text-navy-blue/65"
                dateTime={item.occurredAt}
              >
                {formatAdministrationDateTime(item.occurredAt)}
              </time>
            </div>
            <p className="mt-1 text-sm leading-5 text-navy-blue/65">
              {item.description}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function RelatedReservationLink({
  reservation,
}: {
  readonly reservation: AdministrationReservationSummary;
}) {
  return (
    <Link
      className="group flex items-center justify-between gap-3 rounded-lg px-3 py-3 hover:bg-navy-blue/[0.035]"
      href={`/admin/reservations/${reservation.id}`}
    >
      <span>
        <span className="block text-sm font-semibold">
          {reservation.startsAt
            ? formatAdministrationDateTime(reservation.startsAt)
            : reservation.typeLabel}
        </span>
        <span className="mt-1 block text-xs text-navy-blue/65">
          {reservation.status.label}
        </span>
      </span>
      <ArrowRight
        aria-hidden
        className="size-4 text-navy-blue/65 group-hover:text-navy-blue"
      />
    </Link>
  );
}

export function ReservationReferences({
  references,
}: {
  readonly references: {
    readonly workspaceReservationId: string;
    readonly dotyposReservationId: string | null;
    readonly customerId: string;
  };
}) {
  return (
    <dl className="grid gap-4 border-t border-navy-blue/10 px-5 py-4 text-sm">
      <Reference
        label="Reservation record"
        value={references.workspaceReservationId}
      />
      {references.dotyposReservationId && (
        <Reference
          href={`/admin/bookings/${references.dotyposReservationId}`}
          label="Booking record"
          value={references.dotyposReservationId}
        />
      )}
      <Reference
        href={`/admin/customers/${references.customerId}`}
        label="Customer"
        value={references.customerId}
      />
    </dl>
  );
}

function Reference({
  href,
  label,
  value,
}: {
  readonly href?: string;
  readonly label: string;
  readonly value: string;
}) {
  const content = <span className="break-all font-mono text-xs">{value}</span>;
  return (
    <div>
      <dt className="text-navy-blue/65">{label}</dt>
      <dd className="mt-1">
        {href ? (
          <Link className="underline underline-offset-4" href={href}>
            {content}
          </Link>
        ) : (
          content
        )}
      </dd>
    </div>
  );
}

export function Pagination({
  basePath,
  page,
  pageCount,
  pageParam = "page",
  params = {},
}: {
  readonly basePath: string;
  readonly page: number;
  readonly pageCount: number;
  readonly pageParam?: string;
  readonly params?: Readonly<Record<string, string | undefined>>;
}) {
  const href = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value);
    }
    if (target > 1) search.set(pageParam, String(target));
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };
  if (pageCount <= 1) return null;
  return (
    <nav
      aria-label="Pagination"
      className="mt-5 flex items-center justify-between"
    >
      <Button
        asChild={page > 1}
        disabled={page <= 1}
        size="sm"
        variant="secondary"
      >
        {page > 1 ? (
          <Link href={href(page - 1)}>Previous</Link>
        ) : (
          <span>Previous</span>
        )}
      </Button>
      <span className="text-sm text-navy-blue/65">
        Page {page} of {pageCount}
      </span>
      <Button
        asChild={page < pageCount}
        disabled={page >= pageCount}
        size="sm"
        variant="secondary"
      >
        {page < pageCount ? (
          <Link href={href(page + 1)}>Next</Link>
        ) : (
          <span>Next</span>
        )}
      </Button>
    </nav>
  );
}

export function EmptyState({ message }: { readonly message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-navy-blue/15 bg-white px-5 py-12 text-center text-sm text-navy-blue/65">
      {message}
    </div>
  );
}
