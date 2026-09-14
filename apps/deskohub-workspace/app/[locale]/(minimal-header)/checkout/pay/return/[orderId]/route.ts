import { CheckoutStatusService } from "@/features/checkout/backend/checkout";
import { makeCheckoutPaymentReturnGet } from "@/features/checkout/backend/checkout/checkout-payment-return-route.server";
import { ReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";

export const GET = makeCheckoutPaymentReturnGet(
  CheckoutStatusService.Live,
  ReservationAuthorizationService.Live
);
