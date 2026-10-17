import { isNexiRefundOperation, type NexiOperation } from "@deskohub/nexi";
import { Option } from "effect";
import type { Locale } from "@/features/i18n";
import { parseInstant } from "@/shared/utils/temporal";
import type {
  AdministrationPaymentAttempt,
  AdministrationTimelineItem,
} from "./administration.service";
import { m } from "./i18n";
import type { AdministrationOrder } from "./payment-administration.service";
import {
  formatProviderCode,
  getAdministrationPaymentProviderLabel,
  getProviderOperationTimelineTone,
  getProviderValueLabel,
  isAbandonedPayment,
} from "./payment-presentation";

/** What a Nexi operation did, as far as the timeline names it. */
type ProviderOperationOutcome =
  | "authorized"
  | "executed"
  | "other"
  | "refund"
  | "reversal";

/**
 * The payment event a timeline item records. The Admin UI words it in the
 * route locale; the item's `title` and `description` keep the English the
 * administration API returns.
 */
export type AdministrationPaymentTimelineEvent =
  | {
      readonly source: "payment";
      readonly kind: "attemptStarted";
      readonly attemptId: string;
      readonly provider: AdministrationPaymentAttempt["provider"];
    }
  | { readonly source: "payment"; readonly kind: "refundRecorded" }
  | {
      readonly source: "payment";
      readonly kind: "attemptEnded";
      readonly outcome: "abandoned" | "failed" | "unsuccessful";
    }
  | {
      readonly source: "payment";
      readonly kind: "orderCreated";
      readonly estimated: boolean;
    }
  | {
      readonly source: "payment";
      readonly kind: "operationReported";
      readonly outcome: ProviderOperationOutcome;
      readonly operationType?: string;
      readonly operationResult?: string;
      readonly channel?: string;
    };

export type AdministrationPaymentTimelineItem = AdministrationTimelineItem & {
  readonly event: AdministrationPaymentTimelineEvent;
};

/** The operation's time as an instant, or nothing when Nexi sent none or an unreadable one. */
const getOperationOccurredAt = (operation: NexiOperation) =>
  operation.operationTime
    ? parseInstant(operation.operationTime).pipe(
        Option.map((instant) => instant.toString()),
        Option.getOrUndefined
      )
    : undefined;

/** Whether the order timeline shows a Nexi refund operation for this order. */
const hasRefundOperationItem = (order: AdministrationOrder | undefined) =>
  order?.provider?.operations.some(
    (operation) =>
      isNexiRefundOperation(operation) &&
      getOperationOccurredAt(operation) !== undefined
  ) ?? false;

const attemptEndedTitles = {
  abandoned: "Payment abandoned",
  failed: "Payment failed",
  unsuccessful: "Payment unsuccessful",
} as const;

export const buildPaymentAttemptTimeline = (
  attempts: readonly AdministrationPaymentAttempt[],
  orders: readonly AdministrationOrder[]
): readonly AdministrationPaymentTimelineItem[] =>
  attempts.flatMap((attempt) => {
    const started: AdministrationPaymentTimelineItem = {
      id: `payment-attempt-${attempt.id}-started`,
      title: "Payment started",
      description: `${attempt.providerLabel} attempt ${attempt.id}.`,
      occurredAt: attempt.createdAt,
      tone: "neutral",
      event: {
        source: "payment",
        kind: "attemptStarted",
        attemptId: attempt.id,
        provider: attempt.provider,
      },
    };
    // The order timeline already shows "Refund reported by Nexi" for each
    // refund operation; the local record stands in only when the live Nexi
    // order details are unavailable.
    if (
      attempt.state === "paid" &&
      attempt.refundedAt &&
      !hasRefundOperationItem(
        orders.find(({ orderId }) => orderId === attempt.providerOrderId)
      )
    ) {
      return [
        started,
        {
          id: `payment-attempt-${attempt.id}-refunded`,
          title: "Refund recorded",
          description:
            "Nexi reported a refund for this payment, so it no longer needs refund work.",
          occurredAt: attempt.refundedAt,
          tone: "neutral" as const,
          event: { source: "payment", kind: "refundRecorded" } as const,
        },
      ];
    }
    if (
      attempt.state === "created" ||
      attempt.state === "pending" ||
      attempt.state === "paid"
    ) {
      return [started];
    }
    const abandoned = isAbandonedPayment(attempt);
    let outcome: "abandoned" | "failed" | "unsuccessful" = "unsuccessful";
    if (abandoned) outcome = "abandoned";
    else if (attempt.state === "failed") outcome = "failed";
    return [
      started,
      {
        id: `payment-attempt-${attempt.id}-${attempt.state}`,
        title: attemptEndedTitles[outcome],
        description: abandoned
          ? "Workspace released the reservation after the local payment window elapsed and Nexi still reported no payment activity."
          : "The attempt ended without a recorded payment.",
        occurredAt: attempt.updatedAt,
        tone: "warning" as const,
        event: { source: "payment", kind: "attemptEnded", outcome } as const,
      },
    ];
  });

const getOperationOutcome = (
  operationType: string | undefined,
  operationResult: string | undefined
): ProviderOperationOutcome => {
  if (operationType === "AUTHORIZATION" && operationResult === "AUTHORIZED") {
    return "authorized";
  }
  if (
    (operationType === "AUTHORIZATION" || operationType === "CAPTURE") &&
    operationResult === "EXECUTED"
  ) {
    return "executed";
  }
  if (operationType === "REFUND") return "refund";
  if (operationType === "CANCEL" || operationType === "VOID") return "reversal";
  return "other";
};

const operationTitles = {
  authorized: "Payment authorized by Nexi",
  executed: "Payment executed by Nexi",
  refund: "Refund reported by Nexi",
  reversal: "Payment reversal reported by Nexi",
} as const;

const getOperationTimelineTitle = (
  outcome: ProviderOperationOutcome,
  operationType: string | undefined,
  operationResult: string | undefined
) => {
  if (outcome !== "other") return operationTitles[outcome];
  const typeLabel = operationType
    ? formatProviderCode(operationType)
    : "Payment operation";
  return operationResult
    ? `${typeLabel}: ${formatProviderCode(operationResult)}`
    : typeLabel;
};

export const getOrderTimeline = (
  orders: readonly AdministrationOrder[]
): readonly AdministrationPaymentTimelineItem[] => {
  const items: AdministrationPaymentTimelineItem[] = [];
  for (const order of orders) {
    if (order.link?.providerOrderCreatedAt) {
      const estimated = order.link.providerOrderCreatedAtEstimated;
      items.push({
        id: `order-${order.orderId}-created`,
        title: estimated
          ? "Nexi order created (estimated)"
          : "Nexi order created",
        description: estimated
          ? "This attached Nexi session predates exact order-creation tracking; the local payment-attempt time is shown."
          : "Nexi accepted the hosted-payment request.",
        occurredAt: order.link.providerOrderCreatedAt,
        tone: "neutral",
        href: `#order-${order.orderId}`,
        event: { source: "payment", kind: "orderCreated", estimated },
      });
    }
    for (const [index, operation] of (
      order.provider?.operations ?? []
    ).entries()) {
      const occurredAt = getOperationOccurredAt(operation);
      if (!occurredAt) continue;
      const operationType = operation.operationType?.toUpperCase();
      const operationResult = operation.operationResult?.toUpperCase();
      const outcome = getOperationOutcome(operationType, operationResult);
      const operationId = operation.operationId;
      items.push({
        id: operationId
          ? `nexi-operation-${operationId}`
          : `nexi-operation-${order.orderId}-${index}`,
        title: getOperationTimelineTitle(
          outcome,
          operationType,
          operationResult
        ),
        description: operation.channel
          ? `Nexi reported this ${formatProviderCode(operation.channel)} operation.`
          : "Nexi reported this payment operation.",
        occurredAt,
        tone: getProviderOperationTimelineTone(
          operation.operationType,
          operation.operationResult
        ),
        ...(operationId && {
          href: `#operation-${operationId}`,
        }),
        event: {
          source: "payment",
          kind: "operationReported",
          outcome,
          ...(operationType && { operationType }),
          ...(operationResult && { operationResult }),
          ...(operation.channel && { channel: operation.channel }),
        },
      });
    }
  }
  return items;
};

const getOperationCopyTitle = (
  event: Extract<
    AdministrationPaymentTimelineEvent,
    { readonly kind: "operationReported" }
  >,
  locale: Locale
) => {
  switch (event.outcome) {
    case "authorized":
      return m.administrationPaymentTimelineAuthorizedTitle({}, { locale });
    case "executed":
      return m.administrationPaymentTimelineExecutedTitle({}, { locale });
    case "refund":
      return m.administrationPaymentTimelineRefundReportedTitle({}, { locale });
    case "reversal":
      return m.administrationPaymentTimelineReversalTitle({}, { locale });
    case "other": {
      if (!event.operationType) {
        return m.administrationPaymentOperationFallback({}, { locale });
      }
      const type = getProviderValueLabel(event.operationType, locale);
      return event.operationResult
        ? m.administrationPaymentTimelineOperationResultTitle(
            {
              result: getProviderValueLabel(event.operationResult, locale),
              type,
            },
            { locale }
          )
        : type;
    }
  }
};

/** The payment event's title and description in the route locale. */
export const getAdministrationPaymentTimelineCopy = (
  event: AdministrationPaymentTimelineEvent,
  locale: Locale
): { readonly title: string; readonly description: string } => {
  switch (event.kind) {
    case "attemptStarted":
      return {
        title: m.administrationPaymentTimelineStartedTitle({}, { locale }),
        description: m.administrationPaymentTimelineStartedDescription(
          {
            attemptId: event.attemptId,
            provider: getAdministrationPaymentProviderLabel(
              event.provider,
              locale
            ),
          },
          { locale }
        ),
      };
    case "refundRecorded":
      return {
        title: m.administrationPaymentTimelineRefundRecordedTitle(
          {},
          { locale }
        ),
        description: m.administrationPaymentTimelineRefundRecordedDescription(
          {},
          { locale }
        ),
      };
    case "attemptEnded":
      return {
        title: {
          abandoned: m.administrationPaymentTimelineAbandonedTitle,
          failed: m.administrationPaymentTimelineFailedTitle,
          unsuccessful: m.administrationPaymentTimelineUnsuccessfulTitle,
        }[event.outcome]({}, { locale }),
        description:
          event.outcome === "abandoned"
            ? m.administrationPaymentTimelineAbandonedDescription(
                {},
                { locale }
              )
            : m.administrationPaymentTimelineEndedDescription({}, { locale }),
      };
    case "orderCreated":
      return event.estimated
        ? {
            title: m.administrationPaymentTimelineOrderCreatedEstimatedTitle(
              {},
              { locale }
            ),
            description:
              m.administrationPaymentTimelineOrderCreatedEstimatedDescription(
                {},
                { locale }
              ),
          }
        : {
            title: m.administrationPaymentTimelineOrderCreatedTitle(
              {},
              { locale }
            ),
            description: m.administrationPaymentTimelineOrderCreatedDescription(
              {},
              { locale }
            ),
          };
    case "operationReported":
      return {
        title: getOperationCopyTitle(event, locale),
        description: event.channel
          ? m.administrationPaymentTimelineOperationChannelDescription(
              { channel: getProviderValueLabel(event.channel, locale) },
              { locale }
            )
          : m.administrationPaymentTimelineOperationDescription({}, { locale }),
      };
  }
};
