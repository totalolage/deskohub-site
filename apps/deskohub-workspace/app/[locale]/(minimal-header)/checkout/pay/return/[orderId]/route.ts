import { CheckoutStatusService } from "@/features/checkout/backend/checkout";
import { makeCheckoutPaymentReturnGet } from "@/features/checkout/backend/checkout/checkout-payment-return-route.server";

export const GET = makeCheckoutPaymentReturnGet(CheckoutStatusService.Live);
