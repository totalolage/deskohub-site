import {
  getProviderOrderAbandonmentCutoff,
  getProviderOrderAbandonmentState,
  hasProviderPaymentActivity,
} from "@/features/checkout/provider-order-abandonment";
import type { Locale } from "@/features/i18n";
import {
  StatusBadge,
  type StatusTone,
} from "@/shared/components/ui/status-badge";
import { formatMoney } from "@/shared/money/money";
import { EmptyState } from "./empty-state";
import {
  formatAdministrationDateTime,
  getAdministrationPaymentStatus,
} from "./formatters";
import { m } from "./i18n";
import { NexiOrderLink } from "./nexi-order-link";
import { AdministrationAlert } from "./notice";
import type { AdministrationOrder } from "./payment-administration.service";
import {
  getAdministrationPaymentAttemptStateLabel,
  getProviderValueLabel,
} from "./payment-presentation";
import { PaymentAmount, PaymentStatusLabel } from "./payment-status";

/** A Nexi amount, which Nexi reports in minor units as a string. */
export const formatProviderMoney = (
  amount: string | undefined,
  currency: string | undefined,
  locale: Locale
) => {
  if (!amount || !currency) {
    return m.administrationPaymentNotReported({}, { locale });
  }
  const value = Number(amount);
  return Number.isSafeInteger(value)
    ? formatMoney({ currency, exponent: 2, value }, locale)
    : `${amount} ${currency}`;
};

export const formatOrderMoney = (
  order: AdministrationOrder,
  locale: Locale
) => {
  if (order.provider) {
    return formatProviderMoney(
      order.provider.amount,
      order.provider.currency,
      locale
    );
  }
  if (order.link) return formatMoney(order.link.amount, locale);
  return m.administrationPaymentNotReported({}, { locale });
};

export const formatProviderDateTime = (
  value: string | undefined,
  locale: Locale
) => {
  if (!value) return m.administrationPaymentNotReported({}, { locale });
  try {
    return formatAdministrationDateTime(value, locale);
  } catch {
    return m.administrationPaymentInvalidProviderTime({}, { locale });
  }
};

/** The badge tone for a Nexi status, or a local attempt state that shares its codes. */
const getProviderStatusTone = (value: string): StatusTone => {
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
  if (positive) return "positive";
  if (warning) return "attention";
  return "neutral";
};

export function ProviderStatusBadge({
  locale,
  value,
}: {
  readonly locale: Locale;
  readonly value: string;
}) {
  return (
    <StatusBadge tone={getProviderStatusTone(value)}>
      {getProviderValueLabel(value, locale)}
    </StatusBadge>
  );
}

/**
 * The local payment attempt's status: its state, or the recorded refund with
 * the same wording as every other payment summary.
 */
export const getPaymentAttemptStatusLabel = (
  link: NonNullable<AdministrationOrder["link"]>,
  locale: Locale
) => {
  const status = getAdministrationPaymentStatus(link, locale);
  return status.refunded
    ? status.label
    : getAdministrationPaymentAttemptStateLabel(link.state, locale);
};

export function PaymentAttemptStatusBadge({
  link,
  locale,
}: {
  readonly link: NonNullable<AdministrationOrder["link"]>;
  readonly locale: Locale;
}) {
  const refunded = getAdministrationPaymentStatus(link, locale).refunded;
  return (
    <StatusBadge
      tone={refunded ? "attention" : getProviderStatusTone(link.state)}
    >
      {getPaymentAttemptStatusLabel(link, locale)}
    </StatusBadge>
  );
}

export function ReservationOrderList({
  orders,
  locale,
}: {
  readonly orders: readonly AdministrationOrder[];
  readonly locale: Locale;
}) {
  if (orders.length === 0) {
    return (
      <EmptyState
        message={m.administrationPaymentReservationOrdersEmpty({}, { locale })}
      />
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
                  {m.administrationPaymentNexiOrder({}, { locale })}
                </p>
                <NexiOrderLink
                  className="mt-1 inline-flex max-w-full items-baseline gap-1.5 break-all font-mono text-sm font-semibold text-burned-orange-ink underline decoration-burned-orange/30 underline-offset-4"
                  locale={locale}
                  orderId={order.orderId}
                />
              </div>
              <div className="sm:text-right">
                <p className="font-semibold">
                  {order.link ? (
                    <PaymentAmount locale={locale} payment={order.link} />
                  ) : (
                    formatOrderMoney(order, locale)
                  )}
                </p>
                <p className="mt-1 text-xs text-navy-blue/60">
                  {order.link ? (
                    <PaymentStatusLabel locale={locale} payment={order.link} />
                  ) : (
                    m.administrationPaymentNoLocalAttempt({}, { locale })
                  )}
                </p>
              </div>
            </div>

            {order.providerStatus === "not_found" && (
              <AdministrationAlert className="m-4 sm:m-5" status="warning">
                {m.administrationPaymentOrderNotFound({}, { locale })}
              </AdministrationAlert>
            )}
            {order.providerStatus === "unavailable" && (
              <AdministrationAlert className="m-4 sm:m-5" status="warning">
                {m.administrationPaymentOrderUnavailable({}, { locale })}
              </AdministrationAlert>
            )}
            {providerHasPaymentActivity && (
              <AdministrationAlert className="m-4 sm:m-5" status="warning">
                {m.administrationPaymentOrderActivityHeld({}, { locale })}
              </AdministrationAlert>
            )}
            {abandonmentState === "deferred" && pendingProviderOrder && (
              <p className="m-4 rounded-xl bg-navy-blue/5 px-4 py-3 text-sm text-navy-blue/70 sm:m-5">
                {m.administrationPaymentOrderWindowOpen(
                  {
                    time: formatAdministrationDateTime(
                      getProviderOrderAbandonmentCutoff(
                        pendingProviderOrder.providerOrderCreatedAt
                      ).toString(),
                      locale
                    ),
                  },
                  { locale }
                )}
              </p>
            )}
            {abandonmentState === "abandoned" && (
              <AdministrationAlert className="m-4 sm:m-5" status="warning">
                {m.administrationPaymentOrderWindowElapsed({}, { locale })}
              </AdministrationAlert>
            )}

            {order.provider?.operations &&
            order.provider.operations.length > 0 ? (
              <ol
                aria-label={m.administrationPaymentOrderOperationsLabel(
                  { orderId: order.orderId },
                  { locale }
                )}
              >
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
                              ? getProviderValueLabel(
                                  operation.operationType,
                                  locale
                                )
                              : m.administrationPaymentOperationFallback(
                                  {},
                                  { locale }
                                )}
                          </p>
                          {operation.operationResult && (
                            <ProviderStatusBadge
                              locale={locale}
                              value={operation.operationResult}
                            />
                          )}
                        </div>
                        <p className="mt-1 text-xs text-navy-blue/60">
                          {formatProviderDateTime(
                            operation.operationTime,
                            locale
                          )}
                          {operation.channel && (
                            <>
                              {" "}
                              ·{" "}
                              {getProviderValueLabel(operation.channel, locale)}
                            </>
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
                          operation.currency,
                          locale
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              order.providerStatus === "available" && (
                <p className="px-4 py-5 text-sm text-navy-blue/60 sm:px-5">
                  {m.administrationPaymentOrderNoOperations({}, { locale })}
                </p>
              )
            )}
          </section>
        );
      })}
    </div>
  );
}
