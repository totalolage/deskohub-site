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
import { EmptyState, formatAdministrationDateTime } from "./components";
import type {
  AdministrationOperation,
  AdministrationOrder,
} from "./payment-administration.service";
import { getProviderValueLabel } from "./payment-presentation";

export const formatProviderMoney = (
  amount: string | undefined,
  currency: string | undefined
) => {
  if (!amount || !currency) return "Not reported";
  const value = Number(amount);
  return Number.isSafeInteger(value)
    ? new Intl.NumberFormat("en-GB", { currency, style: "currency" }).format(
        value / 100
      )
    : `${amount} ${currency}`;
};

export const formatOrderMoney = (order: AdministrationOrder) => {
  if (order.provider) {
    return formatProviderMoney(order.provider.amount, order.provider.currency);
  }
  if (order.link) {
    return new Intl.NumberFormat("en-GB", {
      currency: order.link.amount.currency,
      style: "currency",
    }).format(order.link.amount.value / 10 ** order.link.amount.exponent);
  }
  return "Not reported";
};

export const formatProviderDateTime = (value: string | undefined) => {
  if (!value) return "Not reported";
  try {
    return formatAdministrationDateTime(value);
  } catch {
    return "Invalid provider timestamp";
  }
};

const getReconciliationLabel = (order: AdministrationOrder) => {
  if (order.providerStatus === "available") return "Provider only";
  if (order.providerStatus === "not_found") return "Not found";
  if (order.providerStatus === "not_returned") return "Not returned";
  return "Provider unavailable";
};

export function ProviderStatusBadge({ value }: { readonly value: string }) {
  const normalized = value.toUpperCase();
  const positive = [
    "AUTHORIZED",
    "EXECUTED",
    "PAID",
    "THREEDS_VALIDATED",
  ].includes(normalized);
  const warning = [
    "CANCELED",
    "DECLINED",
    "DENIED",
    "DENIED_BY_RISK",
    "FAILED",
    "REFUNDED",
    "THREEDS_FAILED",
    "VOIDED",
  ].includes(normalized);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
        positive &&
          "border-aquamarine-green/35 bg-aquamarine-green/12 text-aquamarine-ink",
        warning &&
          "border-burned-orange/30 bg-burned-orange/10 text-burned-orange-ink",
        !(positive || warning) &&
          "border-navy-blue/12 bg-navy-blue/5 text-navy-blue/65"
      )}
    >
      {getProviderValueLabel(value)}
    </span>
  );
}

export function OrderTable({
  orders,
}: {
  readonly orders: readonly AdministrationOrder[];
}) {
  if (orders.length === 0) {
    return <EmptyState message="No Nexi orders match this period." />;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-navy-blue/10 bg-white">
      <Table aria-label="Nexi orders" className="min-w-[780px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Order</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Last operation</TableHead>
            <TableHead>Reservation</TableHead>
            <TableHead>Reconciliation</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow key={order.orderId}>
              <TableCell>
                <Link
                  className="font-mono text-xs font-semibold underline decoration-navy-blue/20 underline-offset-4 hover:decoration-navy-blue"
                  href={`/admin/orders/${encodeURIComponent(order.orderId)}`}
                >
                  {order.orderId}
                </Link>
                {(order.provider?.lastOperationTime ||
                  order.link?.providerOrderCreatedAt ||
                  order.link?.attemptCreatedAt) && (
                  <p className="mt-1 text-xs text-navy-blue/65">
                    {formatProviderDateTime(
                      order.provider?.lastOperationTime ??
                        order.link?.providerOrderCreatedAt ??
                        order.link?.attemptCreatedAt ??
                        ""
                    )}
                  </p>
                )}
              </TableCell>
              <TableCell className="font-medium">
                {formatOrderMoney(order)}
              </TableCell>
              <TableCell>
                {order.provider?.lastOperationType ? (
                  <span className="font-medium">
                    {getProviderValueLabel(order.provider.lastOperationType)}
                  </span>
                ) : (
                  <span className="text-sm text-navy-blue/65">
                    None reported
                  </span>
                )}
              </TableCell>
              <TableCell>
                {order.link ? (
                  <Link
                    className="font-medium hover:underline"
                    href={`/admin/reservations/${order.link.reservationId}`}
                  >
                    View reservation
                  </Link>
                ) : (
                  <span className="text-sm text-navy-blue/65">Not linked</span>
                )}
              </TableCell>
              <TableCell>
                {order.provider && order.link ? (
                  <ProviderStatusBadge value={order.link.state} />
                ) : (
                  <ProviderStatusBadge value={getReconciliationLabel(order)} />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function OperationTable({
  operations,
}: {
  readonly operations: readonly AdministrationOperation[];
}) {
  if (operations.length === 0) {
    return <EmptyState message="No Nexi operations match these filters." />;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-navy-blue/10 bg-white">
      <Table aria-label="Nexi operations" className="min-w-[880px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Operation</TableHead>
            <TableHead>Order</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Result</TableHead>
            <TableHead>Origin</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Reservation</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {operations.map((operation, index) => (
            <TableRow
              key={
                operation.operationId ??
                `${operation.orderId ?? "unknown"}-${operation.operationTime ?? index}`
              }
            >
              <TableCell>
                {operation.operationId ? (
                  <Link
                    className="font-mono text-xs font-semibold underline decoration-navy-blue/20 underline-offset-4 hover:decoration-navy-blue"
                    href={`/admin/operations/${encodeURIComponent(operation.operationId)}`}
                  >
                    {operation.operationId}
                  </Link>
                ) : (
                  <span className="text-sm text-navy-blue/65">
                    Not reported
                  </span>
                )}
                {operation.operationTime && (
                  <p className="mt-1 text-xs text-navy-blue/65">
                    {formatProviderDateTime(operation.operationTime)}
                  </p>
                )}
              </TableCell>
              <TableCell>
                {operation.orderId ? (
                  <Link
                    className="font-mono text-xs hover:underline"
                    href={`/admin/orders/${encodeURIComponent(operation.orderId)}`}
                  >
                    {operation.orderId}
                  </Link>
                ) : (
                  <span className="text-sm text-navy-blue/65">
                    Not reported
                  </span>
                )}
              </TableCell>
              <TableCell className="font-medium">
                {operation.operationType
                  ? getProviderValueLabel(operation.operationType)
                  : "Not reported"}
              </TableCell>
              <TableCell>
                {operation.operationResult ? (
                  <ProviderStatusBadge value={operation.operationResult} />
                ) : (
                  <span className="text-sm text-navy-blue/65">
                    Not reported
                  </span>
                )}
              </TableCell>
              <TableCell>
                {operation.channel
                  ? getProviderValueLabel(operation.channel)
                  : "Not reported"}
              </TableCell>
              <TableCell className="font-medium">
                {formatProviderMoney(operation.amount, operation.currency)}
              </TableCell>
              <TableCell>
                {operation.linkedReservationId ? (
                  <Link
                    className="font-medium hover:underline"
                    href={`/admin/reservations/${operation.linkedReservationId}`}
                  >
                    View reservation
                  </Link>
                ) : (
                  <span className="text-sm text-navy-blue/65">Not linked</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
