import { isNexiRefundOperation, type NexiOperation } from "@deskohub/nexi";
import type {
  AdministrationPaymentAttempt,
  AdministrationTimelineItem,
} from "./administration.service";
import type { AdministrationOrder } from "./payment-administration.service";
import {
  getProviderOperationTimelineTone,
  getProviderValueLabel,
} from "./payment-presentation";

/** The operation's time as an instant, or nothing when Nexi sent none or an unreadable one. */
const getOperationOccurredAt = (operation: NexiOperation) => {
  if (!operation.operationTime) return undefined;
  try {
    return Temporal.Instant.from(operation.operationTime).toString();
  } catch {
    return undefined;
  }
};

/** Whether the order timeline shows a Nexi refund operation for this order. */
const hasRefundOperationItem = (order: AdministrationOrder | undefined) =>
  order?.provider?.operations.some(
    (operation) =>
      isNexiRefundOperation(operation) &&
      getOperationOccurredAt(operation) !== undefined
  ) ?? false;

export const buildPaymentAttemptTimeline = (
  attempts: readonly AdministrationPaymentAttempt[],
  orders: readonly AdministrationOrder[]
): readonly AdministrationTimelineItem[] =>
  attempts.flatMap((attempt) => {
    const started: AdministrationTimelineItem = {
      id: `payment-attempt-${attempt.id}-started`,
      title: "Payment started",
      description: `${attempt.providerLabel} attempt ${attempt.id}.`,
      occurredAt: attempt.createdAt,
      tone: "neutral",
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
    const abandoned =
      attempt.failureCode === "payment_abandoned_after_provider_cutoff";
    return [
      started,
      {
        id: `payment-attempt-${attempt.id}-${attempt.state}`,
        title: abandoned
          ? "Payment abandoned"
          : {
              cancelled: "Payment unsuccessful",
              expired: "Payment unsuccessful",
              failed: "Payment failed",
            }[attempt.state],
        description: abandoned
          ? "Workspace released the reservation after the local payment window elapsed and Nexi still reported no payment activity."
          : "The attempt ended without a recorded payment.",
        occurredAt: attempt.updatedAt,
        tone: "warning" as const,
      },
    ];
  });

const getOperationTimelineTitle = (
  operationType: string | undefined,
  operationResult: string | undefined
) => {
  if (operationType === "AUTHORIZATION" && operationResult === "AUTHORIZED") {
    return "Payment authorized by Nexi";
  }
  if (
    (operationType === "AUTHORIZATION" || operationType === "CAPTURE") &&
    operationResult === "EXECUTED"
  ) {
    return "Payment executed by Nexi";
  }
  if (operationType === "REFUND") return "Refund reported by Nexi";
  if (operationType === "CANCEL" || operationType === "VOID") {
    return "Payment reversal reported by Nexi";
  }
  const typeLabel = operationType
    ? getProviderValueLabel(operationType)
    : "Payment operation";
  return operationResult
    ? `${typeLabel}: ${getProviderValueLabel(operationResult)}`
    : typeLabel;
};

export const getOrderTimeline = (
  orders: readonly AdministrationOrder[]
): readonly AdministrationTimelineItem[] => {
  const items: AdministrationTimelineItem[] = [];
  for (const order of orders) {
    if (order.link?.providerOrderCreatedAt) {
      items.push({
        id: `order-${order.orderId}-created`,
        title: order.link.providerOrderCreatedAtEstimated
          ? "Nexi order created (estimated)"
          : "Nexi order created",
        description: order.link.providerOrderCreatedAtEstimated
          ? "This attached Nexi session predates exact order-creation tracking; the local payment-attempt time is shown."
          : "Nexi accepted the hosted-payment request.",
        occurredAt: order.link.providerOrderCreatedAt,
        tone: "neutral",
        href: `#order-${order.orderId}`,
      });
    }
    for (const [index, operation] of (
      order.provider?.operations ?? []
    ).entries()) {
      const occurredAt = getOperationOccurredAt(operation);
      if (!occurredAt) continue;
      const result = operation.operationResult?.toUpperCase();
      const operationId = operation.operationId;
      items.push({
        id: operationId
          ? `nexi-operation-${operationId}`
          : `nexi-operation-${order.orderId}-${index}`,
        title: getOperationTimelineTitle(
          operation.operationType?.toUpperCase(),
          result
        ),
        description: operation.channel
          ? `Nexi reported this ${getProviderValueLabel(operation.channel)} operation.`
          : "Nexi reported this payment operation.",
        occurredAt,
        tone: getProviderOperationTimelineTone(
          operation.operationType,
          operation.operationResult
        ),
        ...(operationId && {
          href: `#operation-${operationId}`,
        }),
      });
    }
  }
  return items;
};
