import type { PaymentVerificationResult } from "@deskohub/nexi";
import type { PaymentEvidenceConflictCode } from "@/db/schema";

const conflictCodeByMismatch = {
  orderId: "provider_order_identity",
  amount: "provider_amount",
  currency: "provider_currency",
  securityToken: "provider_security_token",
  operationEvidence: "provider_operation_evidence",
} as const satisfies Record<
  PaymentVerificationResult["mismatches"][number],
  PaymentEvidenceConflictCode
>;

export const getProviderEvidenceConflictCodes = (
  verification: PaymentVerificationResult
): readonly PaymentEvidenceConflictCode[] => {
  const conflictCodes = verification.mismatches.map(
    (mismatch) => conflictCodeByMismatch[mismatch]
  );
  if (
    verification.status === "manual_review" &&
    !conflictCodes.includes("provider_operation_evidence")
  ) {
    conflictCodes.push("provider_operation_evidence");
  }
  return [...new Set(conflictCodes)];
};
