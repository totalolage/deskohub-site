import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  reconcileStalledPaidFulfillments,
  WorkspacePaidFulfillmentService,
} from "@/features/checkout/backend/fulfillment";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { defineWorkspaceCron } from "@/shared/backend/service-route";

export const maxDuration = 300;

const cronBatchLimit = 25;

const ReconciliationLive = Layer.mergeAll(
  WorkspacePaidFulfillmentService.Live,
  WorkspaceReservationRepository.Default.pipe(
    Layer.provide(WorkspaceDatabase.Default)
  )
);

/**
 * Fallback for paid orders whose fulfillment queue message was never sent or
 * expired before fulfillment settled.
 */
export const GET = defineWorkspaceCron({
  operation: "paidFulfillmentReconciliationCron",
  failureMessage: "Paid fulfillment reconciliation failed",
  input: () => ({ now: Temporal.Now.instant(), limit: cronBatchLimit }),
  run: (input) =>
    reconcileStalledPaidFulfillments(input).pipe(
      Effect.provide(ReconciliationLive)
    ),
});
