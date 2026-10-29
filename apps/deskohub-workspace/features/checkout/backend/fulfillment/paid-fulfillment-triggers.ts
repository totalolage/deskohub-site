import { Effect, Layer } from "effect";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { FulfillmentLedger } from "./fulfillment-ledger.repository";
import { processPaidFulfillmentMessage } from "./paid-fulfillment-queue-consumer";
import { reconcileStalledPaidFulfillments } from "./paid-fulfillment-reconciliation";
import { ReservationFulfillment } from "./reservation-fulfillment.service";

// The trigger adapters read fulfillment progress from the ledger, so their
// routes get both here instead of reaching into the module.
const TriggerLive = Layer.mergeAll(
  ReservationFulfillment.Live,
  FulfillmentLedger.Live
);

/** The paid-fulfillment queue route's message handler. */
export const consumePaidFulfillmentMessage = (message: {
  readonly orderId: WorkspaceReservationId;
}) => processPaidFulfillmentMessage(message).pipe(Effect.provide(TriggerLive));

/** The daily paid-fulfillment cron's run. */
export const runStalledPaidFulfillmentReconciliation = (input: {
  readonly now: Temporal.Instant;
  readonly limit: number;
}) => reconcileStalledPaidFulfillments(input).pipe(Effect.provide(TriggerLive));
