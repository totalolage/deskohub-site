import { runStalledPaidFulfillmentReconciliation } from "@/features/checkout/backend/fulfillment";
import { defineWorkspaceCron } from "@/shared/backend/service-route";

export const maxDuration = 300;

const cronBatchLimit = 25;

/**
 * Fallback for paid orders whose fulfillment queue message was never sent or
 * expired before fulfillment settled.
 */
export const GET = defineWorkspaceCron({
  operation: "paidFulfillmentReconciliationCron",
  failureMessage: "Paid fulfillment reconciliation failed",
  input: () => ({ now: Temporal.Now.instant(), limit: cronBatchLimit }),
  run: runStalledPaidFulfillmentReconciliation,
});
