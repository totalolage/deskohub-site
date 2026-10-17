"use client";

import { useMemo } from "react";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import { AdministrationLink as Link } from "./admin-link";
import type {
  AdministrationBookingSort,
  AdministrationBookingSummary,
} from "./administration.service";
import {
  getAdministrationBookingGuestCount,
  getAdministrationBookingStatusLabel,
} from "./booking-presentation";
import { getAdministrationCustomerName } from "./customer-presentation";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "./data-table";
import { EmptyState } from "./empty-state";
import { formatAdministrationDateTime } from "./formatters";
import { m } from "./i18n";
import { getAdministrationReservationProductTitle } from "./reservation-product";
import {
  type AdministrationTableSorting,
  getAdministrationTableSortHref,
} from "./table-sort";

export function BookingStatusBadge({
  booking,
  locale,
}: {
  readonly booking: Pick<AdministrationBookingSummary, "status">;
  readonly locale: Locale;
}) {
  return (
    <StatusBadge
      tone={
        {
          CANCELLED: "neutral",
          CONFIRMED: "positive",
          NEW: "progress",
        }[booking.status] as "neutral" | "positive" | "progress"
      }
    >
      {getAdministrationBookingStatusLabel(booking.status, locale)}
    </StatusBadge>
  );
}

const getColumns = (
  locale: Locale
): readonly AdministrationDataTableColumn<AdministrationBookingSummary>[] => [
  {
    accessorKey: "startsAt",
    cell: ({ row }) => (
      <>
        <Link
          className="font-semibold underline decoration-navy-blue/20 underline-offset-4 before:absolute before:inset-0 before:content-[''] hover:decoration-navy-blue focus-visible:outline-none focus-visible:before:ring-2 focus-visible:before:ring-inset focus-visible:before:ring-navy-blue/40"
          href={`/admin/bookings/${row.original.id}`}
        >
          {formatAdministrationDateTime(row.original.startsAt, locale)}
        </Link>
        <p className="mt-1 text-xs text-navy-blue/65">
          {getAdministrationBookingGuestCount(row.original.seats, locale)}
        </p>
      </>
    ),
    header: m.administrationBookingColumnBooking({}, { locale }),
    id: "booking",
  },
  {
    accessorFn: (booking) =>
      booking.customer
        ? getAdministrationCustomerName(booking.customer, locale)
        : "",
    cell: ({ row }) =>
      row.original.customer && row.original.customerId ? (
        <Link
          className="relative z-10 font-medium hover:underline"
          href={`/admin/customers/${row.original.customerId}`}
        >
          {getAdministrationCustomerName(row.original.customer, locale)}
        </Link>
      ) : (
        <span className="text-sm text-navy-blue/65">
          {m.administrationBookingCustomerDetailsUnavailable({}, { locale })}
        </span>
      ),
    enableSorting: false,
    header: m.administrationBookingColumnCustomer({}, { locale }),
    id: "customer",
  },
  {
    accessorFn: (booking) => booking.tableName ?? "",
    cell: ({ row }) => (
      <>
        <p className="font-medium">
          {row.original.tableName ??
            m.administrationBookingTableNotAssigned({}, { locale })}
        </p>
        {row.original.tableLocation && (
          <p className="mt-1 text-xs text-navy-blue/65">
            {row.original.tableLocation}
          </p>
        )}
      </>
    ),
    enableSorting: false,
    header: m.administrationBookingColumnTable({}, { locale }),
    id: "table",
  },
  {
    accessorFn: (booking) =>
      booking.linkedReservation
        ? getAdministrationReservationProductTitle(
            booking.linkedReservation.product,
            locale
          )
        : "",
    cell: ({ row }) =>
      row.original.linkedReservation ? (
        <Link
          className="relative z-10 font-medium hover:underline"
          href={`/admin/reservations/${row.original.linkedReservation.id}`}
        >
          {getAdministrationReservationProductTitle(
            row.original.linkedReservation.product,
            locale
          )}
        </Link>
      ) : (
        <span className="text-sm text-navy-blue/65">
          {m.administrationBookingReservationNotLinked({}, { locale })}
        </span>
      ),
    enableSorting: false,
    header: m.administrationBookingColumnReservation({}, { locale }),
    id: "reservation",
  },
  {
    accessorKey: "status",
    cell: ({ row }) => (
      <BookingStatusBadge booking={row.original} locale={locale} />
    ),
    header: m.administrationBookingColumnStatus({}, { locale }),
    id: "status",
  },
];

export function BookingTable({
  bookings,
  sorting,
}: {
  readonly bookings: readonly AdministrationBookingSummary[];
  readonly sorting?: AdministrationTableSorting<AdministrationBookingSort>;
}) {
  const locale = useRouteLocale();
  const columns = useMemo(() => getColumns(locale), [locale]);
  if (bookings.length === 0) {
    return (
      <EmptyState message={m.administrationBookingTableEmpty({}, { locale })} />
    );
  }
  return (
    <AdministrationDataTable
      ariaLabel={m.administrationBookingTableLabel({}, { locale })}
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
                      {formatAdministrationDateTime(booking.startsAt, locale)}
                    </p>
                    <p className="mt-1 text-sm text-navy-blue/65">
                      {booking.customer
                        ? getAdministrationCustomerName(
                            booking.customer,
                            locale
                          )
                        : m.administrationBookingCustomerUnavailable(
                            {},
                            { locale }
                          )}
                    </p>
                  </div>
                  <BookingStatusBadge booking={booking} locale={locale} />
                </div>
                <p className="mt-3 text-xs text-navy-blue/65">
                  {booking.tableName ??
                    m.administrationBookingNoTableAssigned({}, { locale })}{" "}
                  · {getAdministrationBookingGuestCount(booking.seats, locale)}
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
