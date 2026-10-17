"use client";

import Interpolate from "@doist/react-interpolate";
import { useMemo } from "react";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { AdministrationLink as Link } from "./admin-link";
import type {
  AdministrationCustomerSort,
  AdministrationCustomerSummary,
} from "./administration.service";
import { getAdministrationCustomerName } from "./customer-presentation";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "./data-table";
import { EmptyState } from "./empty-state";
import { formatAdministrationDateTime } from "./formatters";
import { m } from "./i18n";
import {
  type AdministrationTableSorting,
  getAdministrationTableSortHref,
} from "./table-sort";

const getColumns = (
  locale: Locale
): readonly AdministrationDataTableColumn<AdministrationCustomerSummary>[] => [
  {
    accessorFn: (item) =>
      item.customer
        ? getAdministrationCustomerName(item.customer, locale)
        : m.administrationCustomerDetailsUnavailable({}, { locale }),
    cell: ({ row }) => (
      <Link
        className="font-semibold underline decoration-navy-blue/20 underline-offset-4 before:absolute before:inset-0 before:content-[''] hover:decoration-navy-blue focus-visible:outline-none focus-visible:before:ring-2 focus-visible:before:ring-inset focus-visible:before:ring-navy-blue/40"
        href={`/admin/customers/${row.original.customerId}`}
      >
        {row.original.customer
          ? getAdministrationCustomerName(row.original.customer, locale)
          : m.administrationCustomerDetailsUnavailable({}, { locale })}
      </Link>
    ),
    enableSorting: false,
    header: m.administrationCustomerTableName({}, { locale }),
    id: "name",
  },
  {
    accessorFn: (item) => item.customer?.email ?? "—",
    enableSorting: false,
    header: m.administrationCustomerTableEmail({}, { locale }),
    id: "email",
    meta: { cellClassName: "text-navy-blue/68" },
  },
  {
    accessorFn: (item) => item.customer?.phone ?? "—",
    enableSorting: false,
    header: m.administrationCustomerTablePhone({}, { locale }),
    id: "phone",
    meta: { cellClassName: "text-navy-blue/68" },
  },
  {
    accessorKey: "reservationCount",
    cell: ({ row }) => (
      <span className="text-navy-blue/60">
        <Interpolate
          string={m.administrationCustomerTableReservationCount(
            { count: row.original.reservationCount },
            { locale }
          )}
          mapping={{
            count: (count) => (
              <span className="font-semibold text-navy-blue">{count}</span>
            ),
          }}
        />
      </span>
    ),
    header: m.administrationCustomerTableReservations({}, { locale }),
    id: "reservations",
  },
  {
    accessorKey: "lastActivityAt",
    cell: ({ row }) =>
      formatAdministrationDateTime(row.original.lastActivityAt, locale),
    header: m.administrationCustomerTableLastActivity({}, { locale }),
    id: "activity",
    meta: { cellClassName: "text-navy-blue/68" },
  },
];

export function AdministrationCustomerTable({
  customers,
  sorting,
}: {
  readonly customers: readonly AdministrationCustomerSummary[];
  readonly sorting?: AdministrationTableSorting<AdministrationCustomerSort>;
}) {
  const locale = useRouteLocale();
  const columns = useMemo(() => getColumns(locale), [locale]);
  if (customers.length === 0) {
    return (
      <EmptyState message={m.administrationCustomerListEmpty({}, { locale })} />
    );
  }
  return (
    <AdministrationDataTable
      ariaLabel={m.administrationCustomerListTitle({}, { locale })}
      columns={columns}
      data={customers}
      getRowId={(item) => item.customerId}
      getSortHref={
        sorting
          ? (field, direction) =>
              getAdministrationTableSortHref({
                basePath: "/admin/customers",
                direction,
                field,
                params: sorting.params,
              })
          : undefined
      }
      mobile={
        <ul className="divide-y divide-navy-blue/10">
          {customers.map((item) => (
            <li key={item.customerId}>
              <Link
                className="block px-4 py-4 transition-colors hover:bg-navy-blue/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-blue/40"
                href={`/admin/customers/${item.customerId}`}
              >
                <p className="font-semibold">
                  {item.customer
                    ? getAdministrationCustomerName(item.customer, locale)
                    : m.administrationCustomerDetailsUnavailable(
                        {},
                        { locale }
                      )}
                </p>
                <p className="mt-1 text-sm text-navy-blue/65">
                  {item.customer?.email ??
                    item.customer?.phone ??
                    m.administrationCustomerContactUnavailable({}, { locale })}
                </p>
                <p className="mt-3 text-xs text-navy-blue/60">
                  {m.administrationCustomerListItemSummary(
                    {
                      count: item.reservationCount,
                      date: formatAdministrationDateTime(
                        item.lastActivityAt,
                        locale
                      ),
                    },
                    { locale }
                  )}
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
      tableClassName="min-w-[860px]"
    />
  );
}
