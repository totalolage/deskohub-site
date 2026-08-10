import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
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
  AdministrationReservationSort,
  AdministrationReservationSortDirection,
  AdministrationReservationSummary,
} from "./administration.service";
import { EmptyState } from "./empty-state";
import {
  formatAdministrationDateTime,
  formatAdministrationMoney,
  formatAdministrationReservationDate,
} from "./formatters";
import type { AdministrationReservationStatus } from "./reservation-status";

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

export type ReservationTableSorting = {
  readonly basePath: string;
  readonly direction: AdministrationReservationSortDirection;
  readonly field: AdministrationReservationSort;
  readonly params?: Readonly<Record<string, string | undefined>>;
};

export function ReservationTable({
  emptyMessage = "No reservations match this view.",
  reservations,
  showCustomer = true,
  sorting,
}: {
  readonly emptyMessage?: string;
  readonly reservations: readonly AdministrationReservationSummary[];
  readonly showCustomer?: boolean;
  readonly sorting?: ReservationTableSorting;
}) {
  if (reservations.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
      <div className="hidden overflow-x-auto md:block">
        <Table
          aria-label="Reservations"
          className={showCustomer ? "min-w-[1060px]" : "min-w-[880px]"}
        >
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Date</TableHead>
              <ReservationSortHead field="status" sorting={sorting}>
                Status
              </ReservationSortHead>
              {showCustomer && <TableHead>Customer</TableHead>}
              <ReservationSortHead field="reservation" sorting={sorting}>
                Reservation
              </ReservationSortHead>
              <ReservationSortHead field="created" sorting={sorting}>
                Created
              </ReservationSortHead>
              <TableHead>Payment</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reservations.map((reservation) => (
              <TableRow className="relative" key={reservation.id}>
                <TableCell>
                  <ReservationDate reservation={reservation} />
                </TableCell>
                <TableCell>
                  <ReservationStatus reservation={reservation} />
                </TableCell>
                {showCustomer && (
                  <TableCell>
                    <ReservationCustomer reservation={reservation} />
                  </TableCell>
                )}
                <TableCell>
                  <ReservationReference reservation={reservation} />
                </TableCell>
                <TableCell>
                  <span className="text-sm text-navy-blue/65">
                    {formatAdministrationDateTime(reservation.createdAt)}
                  </span>
                </TableCell>
                <TableCell>
                  <ReservationPayment reservation={reservation} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="divide-y divide-navy-blue/10 md:hidden">
        {reservations.map((reservation) => (
          <li key={reservation.id}>
            <div className="px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    <Link
                      className="underline decoration-navy-blue/20 underline-offset-4 hover:decoration-navy-blue"
                      href={`/admin/reservations/${reservation.id}`}
                    >
                      {showCustomer
                        ? (reservation.customer?.displayName ??
                          reservation.typeLabel)
                        : reservation.typeLabel}
                    </Link>
                  </p>
                  <p className="mt-1 text-sm text-navy-blue/65">
                    {formatAdministrationReservationDate(reservation) ??
                      "Booking details unavailable"}
                  </p>
                </div>
                <ReservationStatus reservation={reservation} alignRight />
              </div>
              <p className="mt-3 text-xs text-navy-blue/65">
                {reservation.typeLabel}
                {reservation.latestPayment && (
                  <>
                    {" "}
                    ·{" "}
                    {formatAdministrationMoney(
                      reservation.latestPayment.amount
                    )}
                  </>
                )}
              </p>
              {reservation.latestPayment?.providerOrderId && (
                <PaymentLink
                  className="mt-2 block break-all font-mono text-xs text-burned-orange-ink underline underline-offset-4"
                  providerOrderId={reservation.latestPayment.providerOrderId}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReservationSortHead({
  children,
  field,
  sorting,
}: {
  readonly children: string;
  readonly field: AdministrationReservationSort;
  readonly sorting: ReservationTableSorting | undefined;
}) {
  if (!sorting) return <TableHead>{children}</TableHead>;
  const sorted = sorting.field === field ? sorting.direction : false;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(sorting.params ?? {})) {
    if (value) search.set(key, value);
  }
  search.set("sort", field);
  search.set("direction", sorted === "asc" ? "desc" : "asc");
  let ariaSort: "ascending" | "descending" | "none" = "none";
  if (sorted === "asc") ariaSort = "ascending";
  else if (sorted === "desc") ariaSort = "descending";
  return (
    <TableHead aria-sort={ariaSort}>
      <Link
        className="-ml-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-left hover:bg-navy-blue/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange"
        href={`${sorting.basePath}?${search.toString()}`}
      >
        {children}
        <SortIcon sorted={sorted} />
      </Link>
    </TableHead>
  );
}

function ReservationDate({
  reservation,
}: {
  readonly reservation: AdministrationReservationSummary;
}) {
  return (
    <>
      <Link
        className="font-semibold underline decoration-navy-blue/20 underline-offset-4 before:absolute before:inset-0 before:content-[''] hover:decoration-navy-blue focus-visible:outline-none focus-visible:before:ring-2 focus-visible:before:ring-inset focus-visible:before:ring-navy-blue/40"
        href={`/admin/reservations/${reservation.id}`}
      >
        {formatAdministrationReservationDate(reservation) ?? "Date unavailable"}
      </Link>
      <p className="mt-1 text-xs text-navy-blue/65">{reservation.typeLabel}</p>
    </>
  );
}

function ReservationStatus({
  alignRight = false,
  reservation,
}: {
  readonly alignRight?: boolean;
  readonly reservation: AdministrationReservationSummary;
}) {
  return (
    <div className={alignRight ? "space-y-1.5 text-right" : "space-y-1.5"}>
      <ReservationStatusBadge status={reservation.status} />
      {reservation.statusNote && (
        <p
          className={
            alignRight
              ? "max-w-32 text-xs font-medium text-burned-orange-ink"
              : "text-xs font-medium text-burned-orange-ink"
          }
        >
          {reservation.statusNote}
        </p>
      )}
    </div>
  );
}

function ReservationCustomer({
  reservation,
}: {
  readonly reservation: AdministrationReservationSummary;
}) {
  if (!reservation.customer) {
    return (
      <span className="text-sm text-navy-blue/65">Details unavailable</span>
    );
  }
  return (
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
  );
}

function ReservationReference({
  reservation,
}: {
  readonly reservation: AdministrationReservationSummary;
}) {
  return (
    <>
      <p className="font-medium">{reservation.typeLabel}</p>
      <p className="mt-1 font-mono text-xs text-navy-blue/65">
        {reservation.id.slice(0, 12)}…
      </p>
    </>
  );
}

function ReservationPayment({
  reservation,
}: {
  readonly reservation: AdministrationReservationSummary;
}) {
  const payment = reservation.latestPayment;
  if (!payment) {
    return <span className="text-sm text-navy-blue/45">—</span>;
  }
  return (
    <>
      <p className="font-medium">{formatAdministrationMoney(payment.amount)}</p>
      <p className="mt-1 text-xs text-navy-blue/65">
        {payment.stateLabel} · {formatAdministrationDateTime(payment.updatedAt)}
      </p>
      {payment.providerOrderId && (
        <PaymentLink
          className="relative z-10 mt-1 block max-w-44 break-all font-mono text-xs text-burned-orange-ink underline underline-offset-4"
          providerOrderId={payment.providerOrderId}
        />
      )}
    </>
  );
}

function PaymentLink({
  className,
  providerOrderId,
}: {
  readonly className: string;
  readonly providerOrderId: string;
}) {
  return (
    <a
      aria-label={`Payment ${providerOrderId} (opens in XPay)`}
      className={className}
      href={`https://xpaydashboard.nexigroup.com/nexi/ordermanagement/order/${encodeURIComponent(providerOrderId)}`}
      rel="noreferrer"
      target="_blank"
    >
      {providerOrderId} ↗
    </a>
  );
}

function SortIcon({ sorted }: { readonly sorted: false | "asc" | "desc" }) {
  if (sorted === "asc") return <ArrowUp aria-hidden className="size-3.5" />;
  if (sorted === "desc") {
    return <ArrowDown aria-hidden className="size-3.5" />;
  }
  return <ArrowUpDown aria-hidden className="size-3.5 opacity-55" />;
}
