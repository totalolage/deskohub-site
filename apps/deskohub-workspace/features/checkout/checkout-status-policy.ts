import type { CheckoutStatusKind } from "@/features/checkout/backend/checkout";

/**
 * Statuses whose checkout holds no live paid reservation and no payment that
 * could still settle, plus a fulfilled one, which may be booked again for
 * another visit. Any other status, a new one included, keeps the customer on
 * recovery instead of a second purchase.
 */
const newReservationStatuses: ReadonlySet<CheckoutStatusKind> =
  new Set<CheckoutStatusKind>([
    "not_found",
    "created",
    "payment_failed",
    "cancelled",
    "expired",
    "late_payment_refund",
    "fulfilled",
  ]);

export const shouldOfferNewReservation = (status: CheckoutStatusKind) =>
  newReservationStatuses.has(status);

/**
 * Statuses whose payment ended without settling and released nothing paid, so
 * the customer may retry the same selection in a fresh checkout.
 */
const reservationRetryStatuses: ReadonlySet<CheckoutStatusKind> =
  new Set<CheckoutStatusKind>(["payment_failed", "cancelled", "expired"]);

export const shouldOfferReservationRetry = (status: CheckoutStatusKind) =>
  reservationRetryStatuses.has(status);

/**
 * Statuses whose reservation is confirmed, or will be once its payment
 * settles, so its details reach the customer by email. Any other status, a new
 * one included, makes no email promise: its payment ended unpaid, its
 * confirmation bounced, or a late payment awaits a check or refund.
 */
const reservationDetailsEmailStatuses: ReadonlySet<CheckoutStatusKind> =
  new Set<CheckoutStatusKind>([
    "pending",
    "payment_pending_delayed",
    "paid_waiting_fulfillment",
    "paid_fulfillment_delayed",
    "paid_awaiting_delivery",
    "paid_delivery_delayed",
    "fulfilled",
  ]);

export const shouldPromiseReservationDetailsEmail = (
  status: CheckoutStatusKind
) => reservationDetailsEmailStatuses.has(status);
