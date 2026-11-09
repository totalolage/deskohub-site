import { Duration, Effect } from "effect";
import {
  PaymentRefundService,
  refundBatchOverrunWorstCase,
} from "@/features/checkout/backend/payment";
import { nexiRequestWorstCaseDuration } from "@/shared/backend/config/nexi.config";
import { defineWorkspaceCron } from "@/shared/backend/service-route";

export const maxDuration = 300;

/** Time `maxDuration` keeps for the cold start and the response. */
const startupAndResponseHeadroom = Duration.seconds(25);

/**
 * Time the batch may spend claiming, looking up, and recording. It starts a
 * lookup only while one exhausting every Nexi retry still ends within it, and
 * at the budget it interrupts whatever is still running and releases those
 * claims. Uninterruptible transaction phases and releases can still run for
 * up to `refundBatchOverrunWorstCase` (35 seconds with the database pool's
 * 15-second connection and 10-second query timeouts), so the budget leaves
 * that and the headroom: 300 - 35 - 25 = 240 seconds, and the batch returns
 * within 275 seconds.
 */
const lookupBudget = Duration.millis(
  Duration.toMillis(Duration.seconds(maxDuration)) -
    Duration.toMillis(refundBatchOverrunWorstCase) -
    Duration.toMillis(startupAndResponseHeadroom)
);

/**
 * Runs hourly, at :30 with an email automation engine tick so both share one
 * production database wake-up. At about 100 paid attempts a day, the 30-day
 * window holds about 3,000 recent payments; 150 checks an hour (3,600 a day)
 * re-check each of them within a day while Nexi answers normally (four
 * lookups of about a second each run at a time). While every lookup times out, a production
 * lookup takes up to about 21 seconds with retries, so a run checks about 44
 * attempts and leaves the rest unclaimed for the next run.
 */
const cronBatchLimit = 150;

/**
 * Production has received no Nexi notification for refunds made in the Nexi
 * back office, so polling is the primary way to record them. The webhook still
 * records a refund if Nexi does notify. This re-reads the Nexi orders of paid
 * attempts awaiting a refund and of recent payments not yet fully refunded,
 * checked longest ago first, and records any refund an operator made there.
 */
export const GET = defineWorkspaceCron({
  operation: "paymentRefundReconciliationCron",
  failureMessage: "Payment refund reconciliation failed",
  input: () => ({
    limit: cronBatchLimit,
    budget: lookupBudget,
    worstCaseLookupDuration: nexiRequestWorstCaseDuration,
  }),
  run: (input) =>
    Effect.flatMap(PaymentRefundService, (refunds) =>
      refunds.reconcileRefunds(input)
    ).pipe(Effect.provide(PaymentRefundService.Live)),
});
