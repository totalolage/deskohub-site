"use client";

import type { NexiOrderId } from "@deskohub/nexi";
import { useMemo } from "react";
import { AdministrationLink as Link } from "./admin-link";
import type {
  AdministrationReservationSort,
  AdministrationReservationSummary,
} from "./administration.service";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "./data-table";
import { EmptyState } from "./empty-state";
import {
  formatAdministrationDateTime,
  formatAdministrationMoney,
  formatAdministrationReservationDate,
} from "./formatters";
import { NexiOrderLink } from "./nexi-order-link";
import type { AdministrationReservationStatus } from "./reservation-status";
import { AdministrationStatusBadge } from "./status-badge";
import {
  type AdministrationTableSorting,
  getAdministrationTableSortHref,
} from "./table-sort";

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

export type ReservationTableSorting =
  AdministrationTableSorting<AdministrationReservationSort> & {
    readonly basePath: string;
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
  const columns = useMemo<
    AdministrationDataTableColumn<AdministrationReservationSummary>[]
  >(
    () => [
      {
        accessorFn: (reservation) =>
          reservation.date ?? reservation.startsAt ?? "",
        cell: ({ row }) => <ReservationDate reservation={row.original} />,
        header: "Date",
        id: "date",
      },
      {
        accessorFn: (reservation) => reservation.status.label,
        cell: ({ row }) => <ReservationStatus reservation={row.original} />,
        header: "Status",
        id: "status",
      },
      ...(showCustomer
        ? [
            {
              accessorFn: (reservation) =>
                reservation.customer?.displayName ?? "",
              cell: ({ row }) => (
                <ReservationCustomer reservation={row.original} />
              ),
              enableSorting: false,
              header: "Customer",
              id: "customer",
            } satisfies AdministrationDataTableColumn<AdministrationReservationSummary>,
          ]
        : []),
      {
        accessorKey: "typeLabel",
        cell: ({ row }) => <ReservationReference reservation={row.original} />,
        header: "Reservation",
        id: "reservation",
      },
      {
        accessorKey: "createdAt",
        cell: ({ row }) => (
          <span className="text-sm text-navy-blue/65">
            {formatAdministrationDateTime(row.original.createdAt)}
          </span>
        ),
        header: "Created",
        id: "created",
      },
      {
        accessorFn: (reservation) => reservation.latestPayment?.amount.value,
        cell: ({ row }) => <ReservationPayment reservation={row.original} />,
        enableSorting: false,
        header: "Payment",
        id: "payment",
      },
    ],
    [showCustomer]
  );

  if (reservations.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <AdministrationDataTable
      ariaLabel="Reservations"
      columns={columns}
      data={reservations}
      getRowId={(reservation) => reservation.id}
      getSortHref={
        sorting
          ? (field, direction) =>
              getAdministrationTableSortHref({
                basePath: sorting.basePath,
                direction,
                field,
                params: sorting.params,
              })
          : undefined
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
      sorting={
        sorting
          ? [{ id: sorting.field, desc: sorting.direction === "desc" }]
          : undefined
      }
      tableClassName={showCustomer ? "min-w-[1060px]" : "min-w-[880px]"}
    />
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
