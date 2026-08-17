"use client";

import { AdministrationLink as Link } from "./admin-link";
import type {
  AdministrationBookingSort,
  AdministrationBookingSummary,
} from "./administration.service";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "./data-table";
import { EmptyState } from "./empty-state";
import { formatAdministrationDateTime } from "./formatters";
import { AdministrationStatusBadge } from "./status-badge";
import {
  type AdministrationTableSorting,
  getAdministrationTableSortHref,
} from "./table-sort";

export function BookingStatusBadge({
  booking,
}: {
  readonly booking: Pick<
    AdministrationBookingSummary,
    "status" | "statusLabel"
  >;
}) {
  return (
    <AdministrationStatusBadge
      tone={
        {
          CANCELLED: "neutral",
          CONFIRMED: "positive",
          NEW: "progress",
        }[booking.status] as "neutral" | "positive" | "progress"
      }
    >
      {booking.statusLabel}
    </AdministrationStatusBadge>
  );
}

const columns: readonly AdministrationDataTableColumn<AdministrationBookingSummary>[] =
  [
    {
      accessorKey: "startsAt",
      cell: ({ row }) => (
        <>
          <Link
            className="font-semibold underline decoration-navy-blue/20 underline-offset-4 before:absolute before:inset-0 before:content-[''] hover:decoration-navy-blue focus-visible:outline-none focus-visible:before:ring-2 focus-visible:before:ring-inset focus-visible:before:ring-navy-blue/40"
            href={`/admin/bookings/${row.original.id}`}
          >
            {formatAdministrationDateTime(row.original.startsAt)}
          </Link>
          <p className="mt-1 text-xs text-navy-blue/65">
            {row.original.seats}{" "}
            {row.original.seats === "1" ? "guest" : "guests"}
          </p>
        </>
      ),
      header: "Booking",
      id: "booking",
    },
    {
      accessorFn: (booking) => booking.customer?.displayName ?? "",
      cell: ({ row }) =>
        row.original.customer && row.original.customerId ? (
          <Link
            className="relative z-10 font-medium hover:underline"
            href={`/admin/customers/${row.original.customerId}`}
          >
            {row.original.customer.displayName}
          </Link>
        ) : (
          <span className="text-sm text-navy-blue/65">Details unavailable</span>
        ),
      enableSorting: false,
      header: "Customer",
      id: "customer",
    },
    {
      accessorFn: (booking) => booking.tableName ?? "",
      cell: ({ row }) => (
        <>
          <p className="font-medium">
            {row.original.tableName ?? "Not assigned"}
          </p>
          {row.original.tableLocation && (
            <p className="mt-1 text-xs text-navy-blue/65">
              {row.original.tableLocation}
            </p>
          )}
        </>
      ),
      enableSorting: false,
      header: "Table",
      id: "table",
    },
    {
      accessorFn: (booking) => booking.linkedReservation?.label ?? "",
      cell: ({ row }) =>
        row.original.linkedReservation ? (
          <Link
            className="relative z-10 font-medium hover:underline"
            href={`/admin/reservations/${row.original.linkedReservation.id}`}
          >
            {row.original.linkedReservation.label}
          </Link>
        ) : (
          <span className="text-sm text-navy-blue/65">Not linked</span>
        ),
      enableSorting: false,
      header: "Reservation",
      id: "reservation",
    },
    {
      accessorKey: "status",
      cell: ({ row }) => <BookingStatusBadge booking={row.original} />,
      header: "Status",
      id: "status",
    },
  ];

export function BookingTable({
  bookings,
  emptyMessage = "No bookings match this date.",
  sorting,
}: {
  readonly bookings: readonly AdministrationBookingSummary[];
  readonly emptyMessage?: string;
  readonly sorting?: AdministrationTableSorting<AdministrationBookingSort>;
}) {
  if (bookings.length === 0) return <EmptyState message={emptyMessage} />;
  return (
    <AdministrationDataTable
      ariaLabel="Bookings"
      columns={columns}
      data={bookings}
      getRowId={(booking) => booking.id}
      getSortHref={
        sorting
          ? (field, direction) =>
              getAdministrationTableSortHref({
                basePath: "/admin/bookings",
                direction,
                field,
                params: sorting.params,
              })
          : undefined
      }
      mobile={
        <ul className="divide-y divide-navy-blue/10">
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
      }
      sorting={
        sorting
          ? [{ id: sorting.field, desc: sorting.direction === "desc" }]
          : undefined
      }
      tableClassName="min-w-[820px]"
    />
  );
}
