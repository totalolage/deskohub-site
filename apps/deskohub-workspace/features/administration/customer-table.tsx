"use client";

import { AdministrationLink as Link } from "./admin-link";
import type {
  AdministrationCustomerSort,
  AdministrationCustomerSummary,
} from "./administration.service";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "./data-table";
import { EmptyState } from "./empty-state";
import { formatAdministrationDateTime } from "./formatters";
import {
  type AdministrationTableSorting,
  getAdministrationTableSortHref,
} from "./table-sort";

const columns: readonly AdministrationDataTableColumn<AdministrationCustomerSummary>[] =
  [
    {
      accessorFn: (item) => item.customer?.displayName ?? "Details unavailable",
      cell: ({ row }) => (
        <Link
          className="font-semibold underline decoration-navy-blue/20 underline-offset-4 before:absolute before:inset-0 before:content-[''] hover:decoration-navy-blue focus-visible:outline-none focus-visible:before:ring-2 focus-visible:before:ring-inset focus-visible:before:ring-navy-blue/40"
          href={`/admin/customers/${row.original.customerId}`}
        >
          {row.original.customer?.displayName ?? "Details unavailable"}
        </Link>
      ),
      enableSorting: false,
      header: "Name",
      id: "name",
    },
    {
      accessorFn: (item) => item.customer?.email ?? "—",
      enableSorting: false,
      header: "Email",
      id: "email",
      meta: { cellClassName: "text-navy-blue/68" },
    },
    {
      accessorFn: (item) => item.customer?.phone ?? "—",
      enableSorting: false,
      header: "Phone",
      id: "phone",
      meta: { cellClassName: "text-navy-blue/68" },
    },
    {
      accessorKey: "reservationCount",
      cell: ({ row }) => (
        <>
          <span className="font-semibold">{row.original.reservationCount}</span>{" "}
          <span className="text-navy-blue/60">
            {row.original.reservationCount === 1
              ? "reservation"
              : "reservations"}
          </span>
        </>
      ),
      header: "Reservations",
      id: "reservations",
    },
    {
      accessorKey: "lastActivityAt",
      cell: ({ row }) =>
        formatAdministrationDateTime(row.original.lastActivityAt),
      header: "Last activity",
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
  if (customers.length === 0) {
    return <EmptyState message="No customers have reservations yet." />;
  }
  return (
    <AdministrationDataTable
      ariaLabel="Customers"
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
                  {item.customer?.displayName ?? "Details unavailable"}
                </p>
                <p className="mt-1 text-sm text-navy-blue/65">
                  {item.customer?.email ??
                    item.customer?.phone ??
                    "Customer details unavailable"}
                </p>
                <p className="mt-3 text-xs text-navy-blue/60">
                  {item.reservationCount}{" "}
                  {item.reservationCount === 1 ? "reservation" : "reservations"}{" "}
                  · Updated {formatAdministrationDateTime(item.lastActivityAt)}
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
