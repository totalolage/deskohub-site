"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { AdministrationLink as Link } from "./admin-link";
import { AdministrationDataTable } from "./data-table";
import { EmptyState } from "./empty-state";
import type {
  AdministrationNexiOperationRecord,
  AdministrationNexiOrderRecord,
} from "./payment-administration.service";
import {
  formatNexiOrderMoney,
  formatProviderDateTime,
  formatProviderMoney,
  ProviderStatusBadge,
} from "./payment-components";
import { getProviderValueLabel } from "./payment-presentation";

const getReconciliationLabel = (order: AdministrationNexiOrderRecord) => {
  if (order.providerStatus === "available") return "Provider only";
  if (order.providerStatus === "not_found") return "Not found";
  if (order.providerStatus === "not_returned") return "Not returned";
  return "Provider unavailable";
};

export function NexiOrderTable({
  orders,
}: {
  readonly orders: readonly AdministrationNexiOrderRecord[];
}) {
  const columns = useMemo<ColumnDef<AdministrationNexiOrderRecord>[]>(
    () => [
      {
        accessorKey: "orderId",
        header: "Order",
        cell: ({ row }) => (
          <>
            <Link
              className="font-mono text-xs font-semibold underline decoration-navy-blue/20 underline-offset-4 hover:decoration-navy-blue"
              href={`/admin/nexi/orders/${encodeURIComponent(row.original.orderId)}`}
            >
              {row.original.orderId}
            </Link>
            {(row.original.provider?.lastOperationTime ||
              row.original.link?.providerOrderCreatedAt ||
              row.original.link?.attemptCreatedAt) && (
              <p className="mt-1 text-xs text-navy-blue/65">
                {formatProviderDateTime(
                  row.original.provider?.lastOperationTime ??
                    row.original.link?.providerOrderCreatedAt ??
                    row.original.link?.attemptCreatedAt ??
                    ""
                )}
              </p>
            )}
          </>
        ),
      },
      {
        accessorFn: (order) =>
          order.provider?.amount
            ? Number(order.provider.amount)
            : order.link?.amount.value,
        id: "amount",
        header: "Amount",
        cell: ({ row }) => formatNexiOrderMoney(row.original),
        meta: { cellClassName: "font-medium" },
      },
      {
        accessorFn: (order) => order.provider?.lastOperationType,
        id: "lastOperation",
        header: "Last operation",
        cell: ({ row }) =>
          row.original.provider?.lastOperationType ? (
            <span className="font-medium">
              {getProviderValueLabel(row.original.provider.lastOperationType)}
            </span>
          ) : (
            <span className="text-sm text-navy-blue/65">None reported</span>
          ),
      },
      {
        accessorFn: (order) => order.link?.reservationId,
        id: "reservation",
        header: "Reservation",
        cell: ({ row }) =>
          row.original.link ? (
            <Link
              className="font-medium hover:underline"
              href={`/admin/reservations/${row.original.link.reservationId}`}
            >
              View reservation
            </Link>
          ) : (
            <span className="text-sm text-navy-blue/65">Not linked</span>
          ),
      },
      {
        accessorFn: (order) =>
          order.provider && order.link
            ? order.link.state
            : getReconciliationLabel(order),
        id: "reconciliation",
        header: "Reconciliation",
        cell: ({ getValue }) => (
          <ProviderStatusBadge value={getValue<string>()} />
        ),
      },
    ],
    []
  );

  if (orders.length === 0) {
    return <EmptyState message="No Nexi orders match this period." />;
  }

  return (
    <AdministrationDataTable
      ariaLabel="Nexi orders"
      columns={columns}
      data={orders}
      getRowId={(order) => order.orderId}
      tableClassName="min-w-[780px]"
    />
  );
}

export function NexiOperationTable({
  operations,
}: {
  readonly operations: readonly AdministrationNexiOperationRecord[];
}) {
  const columns = useMemo<ColumnDef<AdministrationNexiOperationRecord>[]>(
    () => [
      {
        accessorFn: (operation) => operation.operationId,
        id: "operation",
        header: "Operation",
        cell: ({ row }) => (
          <>
            {row.original.operationId ? (
              <Link
                className="font-mono text-xs font-semibold underline decoration-navy-blue/20 underline-offset-4 hover:decoration-navy-blue"
                href={`/admin/nexi/operations/${encodeURIComponent(row.original.operationId)}`}
              >
                {row.original.operationId}
              </Link>
            ) : (
              <span className="text-sm text-navy-blue/65">Not reported</span>
            )}
            {row.original.operationTime && (
              <p className="mt-1 text-xs text-navy-blue/65">
                {formatProviderDateTime(row.original.operationTime)}
              </p>
            )}
          </>
        ),
      },
      {
        accessorKey: "orderId",
        header: "Order",
        cell: ({ row }) =>
          row.original.orderId ? (
            <Link
              className="font-mono text-xs hover:underline"
              href={`/admin/nexi/orders/${encodeURIComponent(row.original.orderId)}`}
            >
              {row.original.orderId}
            </Link>
          ) : (
            <span className="text-sm text-navy-blue/65">Not reported</span>
          ),
      },
      {
        accessorKey: "operationType",
        header: "Type",
        cell: ({ row }) =>
          row.original.operationType
            ? getProviderValueLabel(row.original.operationType)
            : "Not reported",
        meta: { cellClassName: "font-medium" },
      },
      {
        accessorKey: "operationResult",
        header: "Result",
        cell: ({ row }) =>
          row.original.operationResult ? (
            <ProviderStatusBadge value={row.original.operationResult} />
          ) : (
            <span className="text-sm text-navy-blue/65">Not reported</span>
          ),
      },
      {
        accessorKey: "channel",
        header: "Origin",
        cell: ({ row }) =>
          row.original.channel
            ? getProviderValueLabel(row.original.channel)
            : "Not reported",
      },
      {
        accessorFn: (operation) =>
          operation.amount ? Number(operation.amount) : undefined,
        id: "amount",
        header: "Amount",
        cell: ({ row }) =>
          formatProviderMoney(row.original.amount, row.original.currency),
        meta: { cellClassName: "font-medium" },
      },
      {
        accessorKey: "linkedReservationId",
        header: "Reservation",
        cell: ({ row }) =>
          row.original.linkedReservationId ? (
            <Link
              className="font-medium hover:underline"
              href={`/admin/reservations/${row.original.linkedReservationId}`}
            >
              View reservation
            </Link>
          ) : (
            <span className="text-sm text-navy-blue/65">Not linked</span>
          ),
      },
    ],
    []
  );

  if (operations.length === 0) {
    return <EmptyState message="No Nexi operations match these filters." />;
  }

  return (
    <AdministrationDataTable
      ariaLabel="Nexi operations"
      columns={columns}
      data={operations}
      getRowId={(operation, index) =>
        operation.operationId ??
        `${operation.orderId ?? "unknown"}-${operation.operationTime ?? "unknown"}-${index}`
      }
      tableClassName="min-w-[880px]"
    />
  );
}
