import type { PaymentVerificationResult } from "@deskohub/nexi";

/**
 * The verification outcome for log annotations: its status, the provider's
 * order status, and the finite list of mismatched facts. The provider facts
 * themselves stay out of every row the annotation reaches.
 */
export const paymentVerificationLogFields = (
  verification: PaymentVerificationResult | undefined
) => ({
  verificationStatus: verification?.status,
  verificationMismatches: verification?.mismatches,
  providerOrderStatus: verification?.provider.orderStatus,
});
