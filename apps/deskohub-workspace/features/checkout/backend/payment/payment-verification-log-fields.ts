import type { PaymentVerificationResult } from "@deskohub/nexi";

/**
 * The verification outcome for log annotations: its status, the provider's
 * order status, and the mismatched facts as comma-separated text. The
 * provider facts themselves stay out of every row the annotation reaches.
 */
export const paymentVerificationLogFields = (
  verification: PaymentVerificationResult | undefined
) => ({
  verificationStatus: verification?.status,
  verificationMismatches: verification?.mismatches.join(","),
  providerOrderStatus: verification?.provider.orderStatus,
});
