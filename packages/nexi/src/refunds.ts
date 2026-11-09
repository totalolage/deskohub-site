import type { NexiOperation, NexiOperationId } from "./types";

const REFUND_OPERATION_TYPE = "REFUND";

/**
 * Results that mean a `REFUND` operation returned money to the cardholder.
 * Nexi documents `REFUNDED` as "Full or partial amount refunded" and uses
 * `EXECUTED` for completed operations. Refunds made in the Nexi back office
 * before settlement are reported as `REFUND` with `VOIDED`: the refund was
 * performed as a void of the unsettled charge, so the money also went back.
 *
 * Every other result is excluded. Declined, denied, failed, and cancelled
 * refunds moved no money. Pending and unrecognized results are excluded too,
 * because they are not final: counting them could clear refund work for a
 * refund that later fails, while excluding them only delays clearing until
 * Nexi reports a final result, which the webhook or the daily reconciliation
 * then picks up.
 */
const successfulRefundResults = new Set(["EXECUTED", "REFUNDED", "VOIDED"]);

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
