import type { NexiOrderId } from "@deskohub/nexi";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
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
import { NexiOrderLink } from "./nexi-order-link";
import type { AdministrationReservationStatus } from "./reservation-status";
import { AdministrationSortHead } from "./sort-head";
import { AdministrationStatusBadge } from "./status-badge";
import { AdministrationResponsiveTable } from "./table-frame";

export function ReservationStatusBadge({
  status,
}: {
  readonly status: AdministrationReservationStatus;
}) {
  return (
    <AdministrationStatusBadge
      tone={
        {
          attention: "attention",
          cancelled: "neutral",
          complete: "positive",
          in_progress: "progress",
        }[status.group] as "attention" | "neutral" | "positive" | "progress"
      }
    >
      {status.label}
    </AdministrationStatusBadge>
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
    <AdministrationResponsiveTable
      desktop={
        <Table
          aria-label="Reservations"
          className={showCustomer ? "min-w-[1060px]" : "min-w-[880px]"}
        >
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <ReservationSortHead field="date" sorting={sorting}>
                Date
              </ReservationSortHead>
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
      }
      mobile={
        <ul className="divide-y divide-navy-blue/10">
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
      }
    />
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
  return (
    <AdministrationSortHead
      direction={sorted}
      href={`${sorting.basePath}?${search.toString()}`}
    >
      {children}
    </AdministrationSortHead>
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
      {reservation.statusNote ? (
        <ReservationStatusBadge
          status={{ group: "attention", label: reservation.statusNote }}
        />
      ) : (
        <ReservationStatusBadge status={reservation.status} />
      )}
      {reservation.statusNote && (
        <p
          className={
            alignRight
              ? "max-w-32 text-xs text-navy-blue/65"
              : "text-xs text-navy-blue/65"
          }
        >
          Deskohub: {reservation.status.label}
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
  readonly providerOrderId: NexiOrderId;
}) {
  return (
    <NexiOrderLink
      accessibleLabel={`Payment ${providerOrderId}`}
      className={className}
      orderId={providerOrderId}
    />
  );
}
