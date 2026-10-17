"use client";

import type { NexiOrderId } from "@deskohub/nexi";
import { useMemo } from "react";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import { AdministrationLink as Link } from "./admin-link";
import type {
  AdministrationReservationSort,
  AdministrationReservationSummary,
} from "./administration.service";
import { getAdministrationCustomerName } from "./customer-presentation";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "./data-table";
import { EmptyState } from "./empty-state";
import {
  formatAdministrationDateTime,
  formatAdministrationReservationDate,
} from "./formatters";
import { m } from "./i18n";
import { NexiOrderLink } from "./nexi-order-link";
import { PaymentAmount, PaymentStatusText } from "./payment-status";
import {
  getAdministrationReservationStatusLabel,
  getAdministrationReservationStatusNoteLabel,
} from "./reservation-presentation";
import { getAdministrationReservationProductTitle } from "./reservation-product";
import type { AdministrationStatusGroup } from "./reservation-status";
import {
  type AdministrationTableSorting,
  getAdministrationTableSortHref,
} from "./table-sort";

function ReservationStatusBadge({
  group,
  label,
}: {
  readonly group: AdministrationStatusGroup;
  readonly label: string;
}) {
  return (
    <StatusBadge
      tone={
        {
          attention: "attention",
          cancelled: "neutral",
          complete: "positive",
          in_progress: "progress",
        }[group] as "attention" | "neutral" | "positive" | "progress"
      }
    >
      {label}
    </StatusBadge>
  );
}

export type ReservationTableSorting =
  AdministrationTableSorting<AdministrationReservationSort> & {
    readonly basePath: string;
  };

export function ReservationTable({
  emptyMessage,
  reservations,
  showCustomer = true,
  sorting,
}: {
  readonly emptyMessage?: string;
  readonly reservations: readonly AdministrationReservationSummary[];
  readonly showCustomer?: boolean;
  readonly sorting?: ReservationTableSorting;
}) {
  const locale = useRouteLocale();
  const columns = useMemo<
    AdministrationDataTableColumn<AdministrationReservationSummary>[]
  >(
    () => [
      {
        accessorFn: (reservation) =>
          reservation.date ?? reservation.startsAt ?? "",
        cell: ({ row }) => (
          <ReservationDate locale={locale} reservation={row.original} />
        ),
        header: m.administrationReservationTableDate({}, { locale }),
        id: "date",
      },
      {
        accessorFn: (reservation) =>
          getAdministrationReservationStatusLabel(
            reservation.status.code,
            locale
          ),
        cell: ({ row }) => (
          <ReservationStatus locale={locale} reservation={row.original} />
        ),
        header: m.administrationReservationTableStatus({}, { locale }),
        id: "status",
      },
      ...(showCustomer
        ? [
            {
              accessorFn: (reservation) =>
                reservation.customer
                  ? getAdministrationCustomerName(reservation.customer, locale)
                  : "",
              cell: ({ row }) => (
                <ReservationCustomer
                  locale={locale}
                  reservation={row.original}
                />
              ),
              enableSorting: false,
              header: m.administrationReservationTableCustomer({}, { locale }),
              id: "customer",
            } satisfies AdministrationDataTableColumn<AdministrationReservationSummary>,
          ]
        : []),
      {
        accessorFn: (reservation) =>
          getAdministrationReservationProductTitle(reservation.product, locale),
        cell: ({ row }) => (
          <ReservationReference locale={locale} reservation={row.original} />
        ),
        header: m.administrationReservationTableReservation({}, { locale }),
        id: "reservation",
      },
      {
        accessorKey: "createdAt",
        cell: ({ row }) => (
          <span className="text-sm text-navy-blue/65">
            {formatAdministrationDateTime(row.original.createdAt, locale)}
          </span>
        ),
        header: m.administrationReservationTableCreated({}, { locale }),
        id: "created",
      },
      {
        accessorFn: (reservation) => reservation.latestPayment?.amount.value,
        cell: ({ row }) => (
          <ReservationPayment locale={locale} reservation={row.original} />
        ),
        enableSorting: false,
        header: m.administrationReservationTablePayment({}, { locale }),
        id: "payment",
      },
    ],
    [locale, showCustomer]
  );

  if (reservations.length === 0) {
    return (
      <EmptyState
        message={
          emptyMessage ?? m.administrationReservationTableEmpty({}, { locale })
        }
      />
    );
  }

  return (
    <AdministrationDataTable
      ariaLabel={m.administrationReservationTableLabel({}, { locale })}
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
                        {(showCustomer &&
                          reservation.customer &&
                          getAdministrationCustomerName(
                            reservation.customer,
                            locale
                          )) ||
                          getAdministrationReservationProductTitle(
                            reservation.product,
                            locale
                          )}
                      </Link>
                    </p>
                    <p className="mt-1 text-sm text-navy-blue/65">
                      {formatAdministrationReservationDate(
                        reservation,
                        locale
                      ) ??
                        m.administrationReservationBookingDetailsUnavailable(
                          {},
                          { locale }
                        )}
                    </p>
                  </div>
                  <ReservationStatus
                    alignRight
                    locale={locale}
                    reservation={reservation}
                  />
                </div>
                <p className="mt-3 text-xs text-navy-blue/65">
                  {getAdministrationReservationProductTitle(
                    reservation.product,
                    locale
                  )}
                  {reservation.latestPayment && (
                    <>
                      {" "}
                      ·{" "}
                      <PaymentAmount
                        locale={locale}
                        payment={reservation.latestPayment}
                      />
                    </>
                  )}
                </p>
                {reservation.latestPayment?.providerOrderId && (
                  <PaymentLink
                    className="mt-2 block break-all font-mono text-xs text-burned-orange-ink underline underline-offset-4"
                    locale={locale}
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
      // Without the customer column the table sits in the customer page's
      // main column, which is about 630px wide at the xl breakpoint.
      tableClassName={showCustomer ? "min-w-[1060px]" : "min-w-[620px]"}
    />
  );
}

function ReservationDate({
  locale,
  reservation,
}: {
  readonly locale: Locale;
  readonly reservation: AdministrationReservationSummary;
}) {
  return (
    <>
      <Link
        className="font-semibold underline decoration-navy-blue/20 underline-offset-4 before:absolute before:inset-0 before:content-[''] hover:decoration-navy-blue focus-visible:outline-none focus-visible:before:ring-2 focus-visible:before:ring-inset focus-visible:before:ring-navy-blue/40"
        href={`/admin/reservations/${reservation.id}`}
      >
        {formatAdministrationReservationDate(reservation, locale) ??
          m.administrationReservationDateUnavailable({}, { locale })}
      </Link>
      <p className="mt-1 text-xs text-navy-blue/65">
        {getAdministrationReservationProductTitle(reservation.product, locale)}
      </p>
    </>
  );
}

function ReservationStatus({
  alignRight = false,
  locale,
  reservation,
}: {
  readonly alignRight?: boolean;
  readonly locale: Locale;
  readonly reservation: AdministrationReservationSummary;
}) {
  const statusLabel = getAdministrationReservationStatusLabel(
    reservation.status.code,
    locale
  );
  return (
    <div className={alignRight ? "space-y-1.5 text-right" : "space-y-1.5"}>
      {reservation.statusNoteCode ? (
        <ReservationStatusBadge
          group="attention"
          label={getAdministrationReservationStatusNoteLabel(
            reservation.statusNoteCode,
            locale
          )}
        />
      ) : (
        <ReservationStatusBadge
          group={reservation.status.group}
          label={statusLabel}
        />
      )}
      {reservation.statusNoteCode && (
        <p
          className={
            alignRight
              ? "max-w-32 text-xs text-navy-blue/65"
              : "text-xs text-navy-blue/65"
          }
        >
          {m.administrationReservationDeskohubStatus(
            { status: statusLabel },
            { locale }
          )}
        </p>
      )}
    </div>
  );
}

function ReservationCustomer({
  locale,
  reservation,
}: {
  readonly locale: Locale;
  readonly reservation: AdministrationReservationSummary;
}) {
  if (!reservation.customer) {
    return (
      <span className="text-sm text-navy-blue/65">
        {m.administrationReservationCustomerDetailsUnavailable({}, { locale })}
      </span>
    );
  }
  return (
    <>
      <Link
        className="relative z-10 font-medium hover:underline"
        href={`/admin/customers/${reservation.customerId}`}
      >
        {getAdministrationCustomerName(reservation.customer, locale)}
      </Link>
      <p className="mt-1 text-xs text-navy-blue/65">
        {reservation.customer.email ??
          reservation.customer.phone ??
          m.administrationReservationNoContactDetails({}, { locale })}
      </p>
    </>
  );
}

function ReservationReference({
  locale,
  reservation,
}: {
  readonly locale: Locale;
  readonly reservation: AdministrationReservationSummary;
}) {
  return (
    <>
      <p className="font-medium">
        {getAdministrationReservationProductTitle(reservation.product, locale)}
      </p>
      <p className="mt-1 font-mono text-xs text-navy-blue/65">
        {reservation.id.slice(0, 12)}…
      </p>
    </>
  );
}

function ReservationPayment({
  locale,
  reservation,
}: {
  readonly locale: Locale;
  readonly reservation: AdministrationReservationSummary;
}) {
  const payment = reservation.latestPayment;
  if (!payment) {
    return <span className="text-sm text-navy-blue/45">—</span>;
  }
  return (
    <>
      <p className="font-medium">
        <PaymentAmount locale={locale} payment={payment} />
      </p>
      <p className="mt-1 text-xs text-navy-blue/65">
        <PaymentStatusText locale={locale} payment={payment} />
      </p>
      {payment.providerOrderId && (
        <PaymentLink
          className="relative z-10 mt-1 block max-w-44 break-all font-mono text-xs text-burned-orange-ink underline underline-offset-4"
          locale={locale}
          providerOrderId={payment.providerOrderId}
        />
      )}
    </>
  );
}

function PaymentLink({
  className,
  locale,
  providerOrderId,
}: {
  readonly className: string;
  readonly locale: Locale;
  readonly providerOrderId: NexiOrderId;
}) {
  return (
    <NexiOrderLink
      accessibleLabel={m.administrationReservationPaymentLinkLabel(
        { orderId: providerOrderId },
        { locale }
      )}
      className={className}
      locale={locale}
      orderId={providerOrderId}
    />
  );
}
