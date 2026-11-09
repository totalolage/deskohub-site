import type { CustomerBookingSelection } from "@deskohub/workspace-customer-api";
import type { CheckoutRestartReason } from "./checkout/booking-problem";

type BookingFamily = CustomerBookingSelection["family"];

/** The family screen's route, optionally saying why the booking restarted. */
export const bookFamilyHref = (
  family: BookingFamily,
  restart?: CheckoutRestartReason
) =>
  restart === undefined
    ? (`/book/${family}` as const)
    : (`/book/${family}?restart=${restart}` as const);

export const bookCheckoutHref = "/book/checkout" as const;

/** The Reservations list (#991's reservations index). */
export const reservationsHref = "/reservations" as const;

/** The status screen a finished checkout opens (#991's reservations route). */
export const paymentStatusHref = (orderId: string) =>
  `/reservations/${encodeURIComponent(orderId)}?after=payment` as const;
