import type { CheckoutStatusKind } from "@/features/checkout/backend/checkout";

export const shouldAutoRefreshCheckoutStatus = (status: CheckoutStatusKind) =>
  status === "pending" || status === "paid_waiting_fulfillment";
