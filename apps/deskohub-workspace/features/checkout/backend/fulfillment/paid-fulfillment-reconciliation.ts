import { Effect } from "effect";
import { FulfillmentLedger } from "./fulfillment-ledger.repository";
import { ReservationFulfillment } from "./reservation-fulfillment.service";

/** Leaves recent orders to their queue message and the webhook. */
const stalledAfter = { minutes: 15 };

/**
 * Fallback for paid orders whose fulfillment message was never enqueued or
 * expired before fulfillment settled: fulfills the paid orders that have
 * waited longest. Fulfillment claims each order, so running alongside a
 * queue delivery or webhook is safe.
 */
export const reconcileStalledPaidFulfillments = Effect.fn(
  "paidFulfillment.reconcileStalled"
)(
  function* (input: {
    readonly now: Temporal.Instant;
    readonly limit: number;
  }) {
    const ledger = yield* FulfillmentLedger;
    const fulfillment = yield* ReservationFulfillment;

    const orderIds = yield* ledger.selectStalledPaidFulfillments({
      updatedBefore: input.now.subtract(stalledAfter),
      limit: input.limit,
    });
    yield* Effect.logInfo("Stalled paid fulfillment selection completed", {
      count: orderIds.length,
    });

    let attempted = 0;
    let failed = 0;
    for (const orderId of orderIds) {
      attempted += 1;
      yield* fulfillment.run(orderId).pipe(
        Effect.tapError((cause) => {
          failed += 1;
          return Effect.logError("Stalled paid fulfillment retry failed", {
            orderId,
            cause,
          });
        }),
        Effect.ignore
      );
    }

    return { attempted, failed };
  },
  (effect, input) => effect.pipe(Effect.annotateLogs(input))
);
