import {
  classifyNexiFailureStatus,
  type PaymentVerificationResult,
} from "@deskohub/nexi";
import type {
  PaymentAttemptState,
  PaymentEvidenceConflictCode,
} from "@/db/schema";

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
  if (verification.status === "manual_review" && conflictCodes.length === 0) {
    conflictCodes.push("provider_operation_evidence");
  }
  return [...new Set(conflictCodes)];
};

export const hasConflictingHistoricalTerminalEvidence = (input: {
  readonly attemptState: PaymentAttemptState;
  readonly lastProviderOperationId: string | null;
  readonly lastProviderStatus: string | null;
  readonly failureCode: string | null;
  readonly verificationStatus: PaymentVerificationResult["status"];
  readonly providerOperationId: string | undefined;
  readonly providerStatus: string | undefined;
  readonly verifiedFailureCode: string | null;
}) => {
  if (
    input.verificationStatus !== "success" &&
    input.verificationStatus !== "failure"
  ) {
    return false;
  }

  const verifiedState =
    input.verificationStatus === "success"
      ? "paid"
      : classifyNexiFailureStatus(input.providerStatus);
  return (
    input.attemptState !== verifiedState ||
    input.lastProviderOperationId !== (input.providerOperationId ?? null) ||
    input.lastProviderStatus !== (input.providerStatus ?? null) ||
    input.failureCode !== input.verifiedFailureCode
  );
};
