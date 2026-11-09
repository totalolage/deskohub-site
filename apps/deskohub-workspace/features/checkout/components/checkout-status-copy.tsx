import Interpolate from "@doist/react-interpolate";
import { Predicate } from "effect";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  HelpCircle,
  MailCheck,
  RotateCcw,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import type { CheckoutStatusViewModel } from "@/features/checkout/backend/checkout";
import type { CheckoutStatusKind } from "@/features/checkout/checkout-status-kind";
import { type Locale, m } from "@/features/i18n";

type CheckoutStatusTone =
  | "success"
  | "pending"
  | "warning"
  | "failed"
  | "unknown";

export type CheckoutStatusCopy = {
  readonly title: string;
  readonly lead: ReactNode;
  readonly tone: CheckoutStatusTone;
  readonly Icon: typeof CheckCircle2;
};

type StatusMessage = (
  inputs: Record<string, never>,
  options: { readonly locale: Locale }
) => string;

/**
 * A lead that names the confirmation recipient when the status knows the
 * customer's address, and a fallback lead when it doesn't.
 */
type RecipientLead = {
  readonly withRecipient: StatusMessage;
  readonly withoutRecipient: StatusMessage;
};

type StatusCopyEntry = {
  readonly title: StatusMessage;
  readonly lead: StatusMessage | RecipientLead;
  readonly tone: CheckoutStatusTone;
  readonly Icon: typeof CheckCircle2;
};

const statusCopy: Readonly<Record<CheckoutStatusKind, StatusCopyEntry>> = {
  created: {
    title: m.checkoutStatusCreatedTitle,
    lead: m.checkoutStatusCreatedLead,
    tone: "pending",
    Icon: Clock3,
  },
  pending: {
    title: m.checkoutStatusPendingTitle,
    lead: m.checkoutStatusPendingLead,
    tone: "pending",
    Icon: Clock3,
  },
  payment_pending_delayed: {
    title: m.checkoutStatusPaymentPendingDelayedTitle,
    lead: m.checkoutStatusPaymentPendingDelayedLead,
    tone: "warning",
    Icon: Clock3,
  },
  paid_waiting_fulfillment: {
    title: m.checkoutStatusPaidWaitingFulfillmentTitle,
    lead: m.checkoutStatusPaidWaitingFulfillmentLead,
    tone: "pending",
    Icon: MailCheck,
  },
  paid_fulfillment_delayed: {
    title: m.checkoutStatusPaidFulfillmentDelayedTitle,
    lead: m.checkoutStatusPaidFulfillmentDelayedLead,
    tone: "warning",
    Icon: AlertTriangle,
  },
  paid_awaiting_delivery: {
    title: m.checkoutStatusPaidAwaitingDeliveryTitle,
    lead: {
      withRecipient: m.checkoutStatusPaidAwaitingDeliveryLead,
      withoutRecipient: m.checkoutStatusPaidAwaitingDeliveryLeadWithoutEmail,
    },
    tone: "success",
    Icon: MailCheck,
  },
  paid_delivery_delayed: {
    title: m.checkoutStatusPaidDeliveryDelayedTitle,
    lead: {
      withRecipient: m.checkoutStatusPaidDeliveryDelayedLead,
      withoutRecipient: m.checkoutStatusPaidDeliveryDelayedLeadWithoutEmail,
    },
    tone: "warning",
    Icon: AlertTriangle,
  },
  fulfilled: {
    title: m.checkoutStatusFulfilledTitle,
    lead: m.checkoutStatusFulfilledLead,
    tone: "success",
    Icon: CheckCircle2,
  },
  fulfillment_failed: {
    title: m.checkoutStatusFulfillmentFailedTitle,
    lead: {
      withRecipient: m.checkoutStatusFulfillmentFailedLead,
      withoutRecipient: m.checkoutStatusFulfillmentFailedLeadWithoutEmail,
    },
    tone: "warning",
    Icon: AlertTriangle,
  },
  payment_failed: {
    title: m.checkoutStatusPaymentFailedTitle,
    lead: m.checkoutStatusPaymentFailedLead,
    tone: "failed",
    Icon: XCircle,
  },
  cancelled: {
    title: m.checkoutStatusCancelledTitle,
    lead: m.checkoutStatusCancelledLead,
    tone: "warning",
    Icon: XCircle,
  },
  expired: {
    title: m.checkoutStatusExpiredTitle,
    lead: m.checkoutStatusExpiredLead,
    tone: "warning",
    Icon: Clock3,
  },
  late_payment_checking: {
    title: m.checkoutStatusLatePaymentCheckingTitle,
    lead: m.checkoutStatusLatePaymentCheckingLead,
    tone: "pending",
    Icon: Clock3,
  },
  late_payment_refund: {
    title: m.checkoutStatusLatePaymentRefundTitle,
    lead: m.checkoutStatusLatePaymentRefundLead,
    tone: "warning",
    Icon: RotateCcw,
  },
  late_payment_review: {
    title: m.checkoutStatusLatePaymentReviewTitle,
    lead: m.checkoutStatusLatePaymentReviewLead,
    tone: "warning",
    Icon: AlertTriangle,
  },
  not_found: {
    title: m.checkoutStatusNotFoundTitle,
    lead: m.checkoutStatusNotFoundLead,
    tone: "unknown",
    Icon: HelpCircle,
  },
};

/** Shows the recipient so the customer can spot a mistyped address. */
const getConfirmationRecipientLead = (
  template: string,
  email: string
): ReactNode => (
  <Interpolate
    string={template}
    mapping={{
      email: (
        <strong className="break-words font-semibold text-navy-blue">
          {email}
        </strong>
      ),
    }}
  />
);

const getStatusLead = (
  lead: StatusCopyEntry["lead"],
  status: CheckoutStatusViewModel,
  locale: Locale
): ReactNode => {
  if (Predicate.isFunction(lead)) return lead({}, { locale });

  const recipientEmail =
    status.status === "not_found"
      ? undefined
      : status.supportContactPrefill?.email;
  return recipientEmail
    ? getConfirmationRecipientLead(
        lead.withRecipient({}, { locale }),
        recipientEmail
      )
    : lead.withoutRecipient({}, { locale });
};

/** The headline, lead, tone, and icon the status page shows for a status. */
export const getCheckoutStatusCopy = (
  status: CheckoutStatusViewModel,
  locale: Locale
): CheckoutStatusCopy => {
  const { title, lead, tone, Icon } = statusCopy[status.status];
  return {
    title: title({}, { locale }),
    lead: getStatusLead(lead, status, locale),
    tone,
    Icon,
  };
};
