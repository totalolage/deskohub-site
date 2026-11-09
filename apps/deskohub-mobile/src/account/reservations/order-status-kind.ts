import type {
  CustomerOrderState,
  CustomerOrderStatus,
} from "@deskohub/workspace-customer-api";
import { offersAccessCode } from "../account-gating";

/**
 * How the status screen treats an order status, as the website's status page
 * does (`checkoutStatusTraits` in the Workspace app's
 * features/checkout/checkout-status-kind.ts). Which statuses refresh on
 * their own is `paymentReturnPollingStatuses`.
 */
export interface OrderStatusTraits {
  /** Paid locally; a late payment counts only once recovery confirms it. */
  readonly paid: boolean;
  /** The order ended without a booking, so a new reservation is the way on. */
  readonly offersNewReservation: boolean;
  /** Why the customer may need support, if they might. */
  readonly supportTopic:
    | "fulfillment_failed"
    | "late_payment_review"
    | "payment_pending"
    | undefined;
  /** How the screen frames the status. */
  readonly tone: "info" | "warning" | "error";
}

export const orderStatusTraits = {
  created: {
    paid: false,
    offersNewReservation: true,
    supportTopic: undefined,
    tone: "info",
  },
  pending: {
    paid: false,
    offersNewReservation: false,
    supportTopic: undefined,
    tone: "info",
  },
  payment_pending_delayed: {
    paid: false,
    offersNewReservation: false,
    supportTopic: "payment_pending",
    tone: "warning",
  },
  paid_waiting_fulfillment: {
    paid: true,
    offersNewReservation: false,
    supportTopic: undefined,
    tone: "info",
  },
  paid_fulfillment_delayed: {
    paid: true,
    offersNewReservation: false,
    supportTopic: "fulfillment_failed",
    tone: "warning",
  },
  paid_awaiting_delivery: {
    paid: true,
    offersNewReservation: false,
    supportTopic: undefined,
    tone: "info",
  },
  paid_delivery_delayed: {
    paid: true,
    offersNewReservation: false,
    supportTopic: "fulfillment_failed",
    tone: "warning",
  },
  fulfilled: {
    paid: true,
    offersNewReservation: true,
    supportTopic: undefined,
    tone: "info",
  },
  fulfillment_failed: {
    paid: true,
    offersNewReservation: false,
    supportTopic: "fulfillment_failed",
    tone: "error",
  },
  payment_failed: {
    paid: false,
    offersNewReservation: true,
    supportTopic: undefined,
    tone: "error",
  },
  cancelled: {
    paid: false,
    offersNewReservation: true,
    supportTopic: undefined,
    tone: "warning",
  },
  expired: {
    paid: false,
    offersNewReservation: true,
    supportTopic: undefined,
    tone: "warning",
  },
  late_payment_checking: {
    paid: false,
    offersNewReservation: false,
    supportTopic: undefined,
    tone: "info",
  },
  late_payment_refund: {
    paid: false,
    offersNewReservation: true,
    supportTopic: undefined,
    tone: "warning",
  },
  late_payment_review: {
    paid: false,
    offersNewReservation: false,
    supportTopic: "late_payment_review",
    tone: "warning",
  },
} as const satisfies Record<CustomerOrderStatus, OrderStatusTraits>;

/** A paid order offers its invoice; one not issued yet answers 409. */
export const offersInvoice = (order: Pick<CustomerOrderState, "status">) =>
  orderStatusTraits[order.status].paid;

/** A confirmed order links to its door code, except in the review sandbox. */
export const offersAccessLink = (
  order: Pick<CustomerOrderState, "status" | "reviewSandbox">
) => order.status === "fulfilled" && offersAccessCode(order);
