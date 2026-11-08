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

const getAttemptStartedItem = (
  attempt: AdministrationPaymentAttempt
): AdministrationPaymentTimelineItem => ({
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
});

/**
 * When Nexi refunded the paid attempt, if the order timeline doesn't already
 * show it. The order timeline shows "Refund reported by Nexi" for each refund
 * operation; the local record stands in only when the live Nexi order details
 * are unavailable.
 */
const getRefundRecordedOnlyLocally = (
  attempt: AdministrationPaymentAttempt,
  orders: readonly AdministrationOrder[]
) =>
  attempt.state === "paid" &&
  attempt.refundedAt &&
  !hasRefundOperationItem(
    orders.find(({ orderId }) => orderId === attempt.providerOrderId)
  )
    ? attempt.refundedAt
    : undefined;

const getRefundRecordedItem = (
  attempt: AdministrationPaymentAttempt,
  refundedAt: string
): AdministrationPaymentTimelineItem => ({
  id: `payment-attempt-${attempt.id}-refunded`,
  title: "Refund recorded",
  description:
    "Nexi reported a refund for this payment, so it no longer needs refund work.",
  occurredAt: refundedAt,
  tone: "neutral",
  event: { source: "payment", kind: "refundRecorded" },
});

/** Attempt states that haven't ended without a payment. */
const unendedAttemptStates: ReadonlySet<AdministrationPaymentAttempt["state"]> =
  new Set<AdministrationPaymentAttempt["state"]>([
    "created",
    "pending",
    "paid",
  ]);

const getAttemptEndedOutcome = (attempt: AdministrationPaymentAttempt) => {
  if (isAbandonedPayment(attempt)) return "abandoned";
  return attempt.state === "failed" ? "failed" : "unsuccessful";
};

const attemptEndedDescriptions = {
  abandoned:
    "Workspace released the reservation after the local payment window elapsed and Nexi still reported no payment activity.",
  failed: "The attempt ended without a recorded payment.",
  unsuccessful: "The attempt ended without a recorded payment.",
} as const;

const getAttemptEndedItem = (
  attempt: AdministrationPaymentAttempt
): AdministrationPaymentTimelineItem => {
  const outcome = getAttemptEndedOutcome(attempt);
  return {
    id: `payment-attempt-${attempt.id}-${attempt.state}`,
    title: attemptEndedTitles[outcome],
    description: attemptEndedDescriptions[outcome],
    occurredAt: attempt.updatedAt,
    tone: "warning",
    event: { source: "payment", kind: "attemptEnded", outcome },
  };
};

/** What followed the attempt's start: a locally recorded refund, or how it ended. */
const getAttemptFollowUpItems = (
  attempt: AdministrationPaymentAttempt,
  orders: readonly AdministrationOrder[]
): readonly AdministrationPaymentTimelineItem[] => {
  const refundedAt = getRefundRecordedOnlyLocally(attempt, orders);
  if (refundedAt) return [getRefundRecordedItem(attempt, refundedAt)];
  if (unendedAttemptStates.has(attempt.state)) return [];
  return [getAttemptEndedItem(attempt)];
};

export const buildPaymentAttemptTimeline = (
  attempts: readonly AdministrationPaymentAttempt[],
  orders: readonly AdministrationOrder[]
): readonly AdministrationPaymentTimelineItem[] =>
  attempts.flatMap((attempt) => [
    getAttemptStartedItem(attempt),
    ...getAttemptFollowUpItems(attempt, orders),
  ]);

/** Outcomes that depend on both the operation's type and its result. */
const operationOutcomesByTypeAndResult: ReadonlyMap<
  string,
  ProviderOperationOutcome
> = new Map([
  ["AUTHORIZATION:AUTHORIZED", "authorized"],
  ["AUTHORIZATION:EXECUTED", "executed"],
  ["CAPTURE:EXECUTED", "executed"],
]);

/** Outcomes that depend only on the operation's type. */
const operationOutcomesByType: ReadonlyMap<string, ProviderOperationOutcome> =
  new Map([
    ["REFUND", "refund"],
    ["CANCEL", "reversal"],
    ["VOID", "reversal"],
  ]);

const getOperationOutcome = (
  operationType: string | undefined,
  operationResult: string | undefined
): ProviderOperationOutcome => {
  if (operationType === undefined) return "other";
  return (
    operationOutcomesByTypeAndResult.get(
      `${operationType}:${operationResult}`
    ) ??
    operationOutcomesByType.get(operationType) ??
    "other"
  );
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

const getOrderCreatedItems = (
  order: AdministrationOrder
): readonly AdministrationPaymentTimelineItem[] => {
  if (!order.link?.providerOrderCreatedAt) return [];
  const estimated = order.link.providerOrderCreatedAtEstimated;
  return [
    {
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
    },
  ];
};

const getOperationReportedEvent = (
  outcome: ProviderOperationOutcome,
  operationType: string | undefined,
  operationResult: string | undefined,
  channel: string | undefined
): AdministrationPaymentTimelineEvent => ({
  source: "payment",
  kind: "operationReported",
  outcome,
  ...(operationType && { operationType }),
  ...(operationResult && { operationResult }),
  ...(channel && { channel }),
});

const getOperationTimelineDescription = (channel: string | undefined) =>
  channel
    ? `Nexi reported this ${formatProviderCode(channel)} operation.`
    : "Nexi reported this payment operation.";

/** The operation's timeline entry, or none when Nexi gave no readable time. */
const getOperationItems = (
  order: AdministrationOrder,
  operation: NexiOperation,
  index: number
): readonly AdministrationPaymentTimelineItem[] => {
  const occurredAt = getOperationOccurredAt(operation);
  if (!occurredAt) return [];
  const operationType = operation.operationType?.toUpperCase();
  const operationResult = operation.operationResult?.toUpperCase();
  const outcome = getOperationOutcome(operationType, operationResult);
  const operationId = operation.operationId;
  return [
    {
      id: operationId
        ? `nexi-operation-${operationId}`
        : `nexi-operation-${order.orderId}-${index}`,
      title: getOperationTimelineTitle(outcome, operationType, operationResult),
      description: getOperationTimelineDescription(operation.channel),
      occurredAt,
      tone: getProviderOperationTimelineTone(
        operation.operationType,
        operation.operationResult
      ),
      ...(operationId && {
        href: `#operation-${operationId}`,
      }),
      event: getOperationReportedEvent(
        outcome,
        operationType,
        operationResult,
        operation.channel
      ),
    },
  ];
};

export const getOrderTimeline = (
  orders: readonly AdministrationOrder[]
): readonly AdministrationPaymentTimelineItem[] =>
  orders.flatMap((order) => [
    ...getOrderCreatedItems(order),
    ...(order.provider?.operations ?? []).flatMap((operation, index) =>
      getOperationItems(order, operation, index)
    ),
  ]);

type OperationReportedEvent = Extract<
  AdministrationPaymentTimelineEvent,
  { readonly kind: "operationReported" }
>;

/** Names an operation the timeline doesn't classify by its type and result. */
const getUnclassifiedOperationCopyTitle = (
  event: OperationReportedEvent,
  locale: Locale
) => {
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
};

const getOperationCopyTitle = (
  event: OperationReportedEvent,
  locale: Locale
) =>
  event.outcome === "other"
    ? getUnclassifiedOperationCopyTitle(event, locale)
    : {
        authorized: m.administrationPaymentTimelineAuthorizedTitle,
        executed: m.administrationPaymentTimelineExecutedTitle,
        refund: m.administrationPaymentTimelineRefundReportedTitle,
        reversal: m.administrationPaymentTimelineReversalTitle,
      }[event.outcome]({}, { locale });

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
