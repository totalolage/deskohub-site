"use client";

import { useMemo } from "react";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import { AdministrationLink as Link } from "./admin-link";
import { administrationHref } from "./administration-href";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "./data-table";
import { EmptyState } from "./empty-state";
import { m } from "./i18n";
import type {
  AdministrationOperation,
  AdministrationOrder,
} from "./payment-administration.service";
import {
  formatOrderMoney,
  formatProviderDateTime,
  formatProviderMoney,
  getPaymentAttemptStatusLabel,
  PaymentAttemptStatusBadge,
  ProviderStatusBadge,
} from "./payment-components";
import { getProviderValueLabel } from "./payment-presentation";

const getReconciliationLabel = (order: AdministrationOrder, locale: Locale) =>
  ({
    available: m.administrationOrderReconciliationProviderOnly,
    not_found: m.administrationOrderReconciliationNotFound,
    not_returned: m.administrationOrderReconciliationNotReturned,
    unavailable: m.administrationOrderReconciliationUnavailable,
  })[order.providerStatus]({}, { locale });

/**
 * When the order last moved: Nexi's last operation, else when the Nexi order
 * or the local attempt was created. Nothing when none of them is set.
 */
const getOrderActivityTime = (order: AdministrationOrder) => {
  const times = [
    order.provider?.lastOperationTime,
    order.link?.providerOrderCreatedAt,
    order.link?.attemptCreatedAt,
  ];
  if (!times.some(Boolean)) return undefined;
  return times.find((time) => time !== undefined && time !== null) ?? "";
};

/** The order's sortable amount: Nexi's reported amount, else the local attempt's. */
const getOrderAmountSortValue = (order: AdministrationOrder) =>
  order.provider?.amount
    ? Number(order.provider.amount)
    : order.link?.amount.value;

/** A stable row id, even for an operation Nexi reported without an id. */
export const getOperationRowId = (
  operation: AdministrationOperation,
  index: number
) =>
  operation.operationId ??
  `${operation.orderId ?? "unknown"}-${operation.operationTime ?? "unknown"}-${index}`;

function OrderReference({
  locale,
  order,
}: {
  readonly locale: Locale;
  readonly order: AdministrationOrder;
}) {
  const activityTime = getOrderActivityTime(order);
  return (
    <>
      <Link
        className="font-mono text-xs font-semibold underline decoration-navy-blue/20 underline-offset-4 hover:decoration-navy-blue"
        href={administrationHref("/[locale]/admin/orders/[orderId]", {
          orderId: order.orderId,
        })}
      >
        {order.orderId}
      </Link>
      {activityTime !== undefined && (
        <p className="mt-1 text-xs text-navy-blue/65">
          {formatProviderDateTime(activityTime, locale)}
        </p>
      )}
    </>
  );
}

function OperationReference({
  locale,
  operation,
}: {
  readonly locale: Locale;
  readonly operation: AdministrationOperation;
}) {
  return (
    <>
      {operation.operationId ? (
        <Link
          className="font-mono text-xs font-semibold underline decoration-navy-blue/20 underline-offset-4 hover:decoration-navy-blue"
          href={administrationHref("/[locale]/admin/operations/[operationId]", {
            operationId: operation.operationId,
          })}
        >
          {operation.operationId}
        </Link>
      ) : (
        <span className="text-sm text-navy-blue/65">
          {m.administrationOperationNotReported({}, { locale })}
        </span>
      )}
      {operation.operationTime && (
        <p className="mt-1 text-xs text-navy-blue/65">
          {formatProviderDateTime(operation.operationTime, locale)}
        </p>
      )}
    </>
  );
}

export function OrderTable({
  orders,
}: {
  readonly orders: readonly AdministrationOrder[];
}) {
  const locale = useRouteLocale();
  const columns = useMemo<AdministrationDataTableColumn<AdministrationOrder>[]>(
    () => [
      {
        accessorKey: "orderId",
        header: m.administrationOrderColumnOrder({}, { locale }),
        cell: ({ row }) => (
          <OrderReference locale={locale} order={row.original} />
        ),
      },
      {
        accessorFn: getOrderAmountSortValue,
        id: "amount",
        header: m.administrationOrderColumnAmount({}, { locale }),
        cell: ({ row }) => formatOrderMoney(row.original, locale),
        meta: { cellClassName: "font-medium" },
      },
      {
        accessorFn: (order) => order.provider?.lastOperationType,
        id: "lastOperation",
        header: m.administrationOrderColumnLastOperation({}, { locale }),
        cell: ({ row }) =>
          row.original.provider?.lastOperationType ? (
            <span className="font-medium">
              {getProviderValueLabel(
                row.original.provider.lastOperationType,
                locale
              )}
            </span>
          ) : (
            <span className="text-sm text-navy-blue/65">
              {m.administrationOrderNoOperationReported({}, { locale })}
            </span>
          ),
      },
      {
        accessorFn: (order) => order.link?.reservationId,
        id: "reservation",
        header: m.administrationOrderColumnReservation({}, { locale }),
        cell: ({ row }) =>
          row.original.link ? (
            <Link
              className="font-medium hover:underline"
              href={administrationHref(
                "/[locale]/admin/reservations/[reservationId]",
                { reservationId: row.original.link.reservationId }
              )}
            >
              {m.administrationOrderViewReservation({}, { locale })}
            </Link>
          ) : (
            <span className="text-sm text-navy-blue/65">
              {m.administrationOrderReservationNotLinked({}, { locale })}
            </span>
          ),
      },
      {
        accessorFn: (order) =>
          order.provider && order.link
            ? getPaymentAttemptStatusLabel(order.link, locale)
            : getReconciliationLabel(order, locale),
        id: "reconciliation",
        header: m.administrationOrderColumnReconciliation({}, { locale }),
        cell: ({ getValue, row }) =>
          row.original.provider && row.original.link ? (
            <PaymentAttemptStatusBadge
              link={row.original.link}
              locale={locale}
            />
          ) : (
            <StatusBadge tone="neutral">{getValue<string>()}</StatusBadge>
          ),
      },
    ],
    [locale]
  );

  if (orders.length === 0) {
    return (
      <EmptyState message={m.administrationOrderTableEmpty({}, { locale })} />
    );
  }

  return (
    <AdministrationDataTable
      ariaLabel={m.administrationOrderTableLabel({}, { locale })}
      columns={columns}
      data={orders}
      getRowId={(order) => order.orderId}
      tableClassName="min-w-[780px]"
    />
  );
}

export function OperationTable({
  operations,
}: {
  readonly operations: readonly AdministrationOperation[];
}) {
  const locale = useRouteLocale();
  const columns = useMemo<
    AdministrationDataTableColumn<AdministrationOperation>[]
  >(
    () => [
      {
        accessorFn: (operation) => operation.operationId,
        id: "operation",
        header: m.administrationOperationColumnOperation({}, { locale }),
        cell: ({ row }) => (
          <OperationReference locale={locale} operation={row.original} />
        ),
      },
      {
        accessorKey: "orderId",
        header: m.administrationOperationColumnOrder({}, { locale }),
        cell: ({ row }) =>
          row.original.orderId ? (
            <Link
              className="font-mono text-xs hover:underline"
              href={administrationHref("/[locale]/admin/orders/[orderId]", {
                orderId: row.original.orderId,
              })}
            >
              {row.original.orderId}
            </Link>
          ) : (
            <span className="text-sm text-navy-blue/65">
              {m.administrationOperationNotReported({}, { locale })}
            </span>
          ),
      },
      {
        accessorKey: "operationType",
        header: m.administrationOperationColumnType({}, { locale }),
        cell: ({ row }) =>
          row.original.operationType
            ? getProviderValueLabel(row.original.operationType, locale)
            : m.administrationOperationNotReported({}, { locale }),
        meta: { cellClassName: "font-medium" },
      },
      {
        accessorKey: "operationResult",
        header: m.administrationOperationColumnResult({}, { locale }),
        cell: ({ row }) =>
          row.original.operationResult ? (
            <ProviderStatusBadge
              locale={locale}
              value={row.original.operationResult}
            />
          ) : (
            <span className="text-sm text-navy-blue/65">
              {m.administrationOperationNotReported({}, { locale })}
            </span>
          ),
      },
      {
        accessorKey: "channel",
        header: m.administrationOperationColumnOrigin({}, { locale }),
        cell: ({ row }) =>
          row.original.channel
            ? getProviderValueLabel(row.original.channel, locale)
            : m.administrationOperationNotReported({}, { locale }),
      },
      {
        accessorFn: (operation) =>
          operation.amount ? Number(operation.amount) : undefined,
        id: "amount",
        header: m.administrationOperationColumnAmount({}, { locale }),
        cell: ({ row }) =>
          formatProviderMoney(
            row.original.amount,
            row.original.currency,
            locale
          ),
        meta: { cellClassName: "font-medium" },
      },
      {
        accessorKey: "linkedReservationId",
        header: m.administrationOperationColumnReservation({}, { locale }),
        cell: ({ row }) =>
          row.original.linkedReservationId ? (
            <Link
              className="font-medium hover:underline"
              href={administrationHref(
                "/[locale]/admin/reservations/[reservationId]",
                { reservationId: row.original.linkedReservationId }
              )}
            >
              {m.administrationOperationViewReservation({}, { locale })}
            </Link>
          ) : (
            <span className="text-sm text-navy-blue/65">
              {m.administrationOperationReservationNotLinked({}, { locale })}
            </span>
          ),
      },
    ],
    [locale]
  );

  if (operations.length === 0) {
    return (
      <EmptyState
        message={m.administrationOperationTableEmpty({}, { locale })}
      />
    );
  }

  return (
    <AdministrationDataTable
      ariaLabel={m.administrationOperationTableLabel({}, { locale })}
      columns={columns}
      data={operations}
      getRowId={getOperationRowId}
      tableClassName="min-w-[880px]"
    />
  );
}
