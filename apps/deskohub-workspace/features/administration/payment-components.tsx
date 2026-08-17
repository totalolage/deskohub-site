import {
  getProviderOrderAbandonmentCutoff,
  getProviderOrderAbandonmentState,
  hasProviderPaymentActivity,
} from "@/features/checkout/provider-order-abandonment";
import { EmptyState } from "./empty-state";
import { formatAdministrationDateTime } from "./formatters";
import { NexiOrderLink } from "./nexi-order-link";
import { AdministrationAlert } from "./notice";
import type { AdministrationOrder } from "./payment-administration.service";
import { getProviderValueLabel } from "./payment-presentation";
import {
  AdministrationStatusBadge,
  type AdministrationStatusTone,
} from "./status-badge";

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
    "CANCELLED",
    "DECLINED",
    "DENIED",
    "DENIED_BY_RISK",
    "FAILED",
    "REFUNDED",
    "THREEDS_FAILED",
    "VOIDED",
  ].includes(normalized);
  let tone: AdministrationStatusTone = "neutral";
  if (positive) tone = "positive";
  else if (warning) tone = "attention";
  return (
    <AdministrationStatusBadge tone={tone}>
      {getProviderValueLabel(value)}
    </AdministrationStatusBadge>
  );
}

export function ReservationOrderList({
  orders,
}: {
  readonly orders: readonly AdministrationOrder[];
}) {
  if (orders.length === 0) {
    return (
      <EmptyState message="No Nexi order is linked to this reservation." />
    );
  }
  return (
    <div className="space-y-4">
      {orders.map((order) => {
        const pendingProviderOrder =
          order.link?.state === "pending" &&
          order.providerStatus === "available" &&
          order.provider &&
          order.link.providerOrderCreatedAt
            ? {
                checkedAt: Temporal.Now.instant(),
                providerOrderCreatedAt: Temporal.Instant.from(
                  order.link.providerOrderCreatedAt
                ),
                order: {
                  operationCount: order.provider.operations.length,
                  authorizedAmount: order.provider.authorizedAmount,
                  capturedAmount: order.provider.capturedAmount,
                },
              }
            : null;
        const abandonmentState = pendingProviderOrder
          ? getProviderOrderAbandonmentState(pendingProviderOrder)
          : null;
        const providerHasPaymentActivity = pendingProviderOrder
          ? hasProviderPaymentActivity(pendingProviderOrder.order)
          : false;
        return (
          <section
            className="scroll-mt-24 overflow-hidden rounded-xl border border-navy-blue/10 bg-white"
            id={`order-${order.orderId}`}
            key={order.orderId}
          >
            <div className="flex flex-col gap-4 border-b border-navy-blue/10 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-navy-blue/65">
                  Nexi order
                </p>
                <NexiOrderLink
                  className="mt-1 inline-flex max-w-full items-baseline gap-1.5 break-all font-mono text-sm font-semibold text-burned-orange-ink underline decoration-burned-orange/30 underline-offset-4"
                  orderId={order.orderId}
                />
              </div>
              <div className="sm:text-right">
                <p className="font-semibold">{formatOrderMoney(order)}</p>
                <p className="mt-1 text-xs text-navy-blue/60">
                  {order.link?.stateLabel ?? "No local payment attempt"}
                </p>
              </div>
            </div>

            {order.providerStatus === "not_found" && (
              <AdministrationAlert className="m-4 sm:m-5" status="warning">
                Nexi did not return this locally linked order. The order ID and
                local payment facts remain available above.
              </AdministrationAlert>
            )}
            {order.providerStatus === "unavailable" && (
              <AdministrationAlert className="m-4 sm:m-5" status="warning">
                Live order operations are temporarily unavailable from Nexi.
              </AdministrationAlert>
            )}
            {providerHasPaymentActivity && (
              <AdministrationAlert className="m-4 sm:m-5" status="warning">
                Nexi reports payment activity. Automatic cleanup will keep this
                reservation held for payment review.
              </AdministrationAlert>
            )}
            {abandonmentState === "deferred" && pendingProviderOrder && (
              <p className="m-4 rounded-xl bg-navy-blue/5 px-4 py-3 text-sm text-navy-blue/70 sm:m-5">
                The local payment window is open until{" "}
                {formatAdministrationDateTime(
                  getProviderOrderAbandonmentCutoff(
                    pendingProviderOrder.providerOrderCreatedAt
                  ).toString()
                )}
                . If Nexi remains empty, automatic cleanup can release the hold.
              </p>
            )}
            {abandonmentState === "abandoned" && (
              <AdministrationAlert className="m-4 sm:m-5" status="warning">
                Nexi is still empty after the local payment window. Automatic
                cleanup should release this reservation hold.
              </AdministrationAlert>
            )}

            {order.provider?.operations &&
            order.provider.operations.length > 0 ? (
              <ol aria-label={`Operations for order ${order.orderId}`}>
                {order.provider.operations.map((operation, index) => (
                  <li
                    className="scroll-mt-24 border-b border-navy-blue/10 px-4 py-4 last:border-b-0 sm:px-5"
                    id={
                      operation.operationId
                        ? `operation-${operation.operationId}`
                        : undefined
                    }
                    key={
                      operation.operationId ??
                      `${operation.operationTime ?? "unknown"}-${index}`
                    }
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">
                            {operation.operationType
                              ? getProviderValueLabel(operation.operationType)
                              : "Payment operation"}
                          </p>
                          {operation.operationResult && (
                            <ProviderStatusBadge
                              value={operation.operationResult}
                            />
                          )}
                        </div>
                        <p className="mt-1 text-xs text-navy-blue/60">
                          {formatProviderDateTime(operation.operationTime)}
                          {operation.channel && (
                            <> · {getProviderValueLabel(operation.channel)}</>
                          )}
                        </p>
                        {operation.operationId && (
                          <p className="mt-2 break-all font-mono text-xs text-navy-blue/65">
                            {operation.operationId}
                          </p>
                        )}
                      </div>
                      <p className="font-medium sm:text-right">
                        {formatProviderMoney(
                          operation.amount,
                          operation.currency
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              order.providerStatus === "available" && (
                <p className="px-4 py-5 text-sm text-navy-blue/60 sm:px-5">
                  Nexi did not report any operations for this order.
                </p>
              )
            )}
          </section>
        );
      })}
    </div>
  );
}
