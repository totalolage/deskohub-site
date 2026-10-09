import type { NexiOperation, NexiOperationId } from "./types";

const REFUND_OPERATION_TYPE = "REFUND";

/**
 * Nexi documents `REFUNDED` as "Full or partial amount refunded" and uses
 * `EXECUTED` for completed operations, so either result on a `REFUND`
 * operation means money went back to the cardholder. Pending, declined, and
 * failed refunds move no money.
 */
const successfulRefundResults = new Set(["EXECUTED", "REFUNDED"]);

const minorUnitAmountPattern = /^[1-9][0-9]*$/;

export interface NexiRefundSummary {
  /** Sum of successful refunds in the order's Nexi minor units. */
  readonly amount: number;
  /** Latest successful refund time as reported by Nexi, when present. */
  readonly lastRefundedAt?: string;
  readonly operationIds: readonly NexiOperationId[];
}

/** Whether the operation is a refund, whatever its result. */
export const isNexiRefundOperation = (
  operation: Pick<NexiOperation, "operationType">
) => operation.operationType?.toUpperCase() === REFUND_OPERATION_TYPE;

export const isSuccessfulNexiRefund = (
  operation: Pick<NexiOperation, "operationType" | "operationResult">
) =>
  isNexiRefundOperation(operation) &&
  successfulRefundResults.has(operation.operationResult?.toUpperCase() ?? "");

const toEpochMilliseconds = (value: string | undefined) => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

/**
 * Summarizes successful refunds among an order's operations. Returns
 * `undefined` when the order has no successful refund with a valid amount.
 */
export const summarizeNexiRefunds = (
  operations: readonly NexiOperation[]
): NexiRefundSummary | undefined => {
  const refunds = operations.filter(
    (operation) =>
      isSuccessfulNexiRefund(operation) &&
      operation.amount !== undefined &&
      minorUnitAmountPattern.test(operation.amount)
  );
  if (refunds.length === 0) return undefined;

  const latest = refunds.reduce<NexiOperation | undefined>(
    (current, operation) =>
      (toEpochMilliseconds(operation.operationTime) ?? -1) >
      (toEpochMilliseconds(current?.operationTime) ?? -1)
        ? operation
        : current,
    undefined
  );

  return {
    amount: refunds.reduce(
      (sum, operation) => sum + Number(operation.amount),
      0
    ),
    ...(latest?.operationTime && { lastRefundedAt: latest.operationTime }),
    operationIds: refunds.flatMap((operation) =>
      operation.operationId ? [operation.operationId] : []
    ),
  };
};
