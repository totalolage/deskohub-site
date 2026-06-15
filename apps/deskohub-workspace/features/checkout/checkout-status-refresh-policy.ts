import type { CheckoutStatusKind } from "@/features/checkout/backend/checkout-status.service";

export const shouldAutoRefreshCheckoutStatus = (status: CheckoutStatusKind) =>
  status === "pending" || status === "paid_waiting_fulfillment";
