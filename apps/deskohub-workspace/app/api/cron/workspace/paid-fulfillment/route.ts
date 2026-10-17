import { Effect, Layer } from "effect";
import { NextResponse } from "next/server";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  reconcileStalledPaidFulfillments,
  WorkspacePaidFulfillmentService,
} from "@/features/checkout/backend/fulfillment";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { isAuthorizedCronRequest } from "@/shared/backend/cron-request";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";

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
const reconcilePaidFulfillments = Effect.fn("reconcilePaidFulfillments")(
  function* () {
    const input = { now: Temporal.Now.instant(), limit: cronBatchLimit };
    yield* Effect.annotateLogsScoped({ input });
    yield* Effect.logInfo("Paid fulfillment reconciliation started");

    const result = yield* reconcileStalledPaidFulfillments(input);
    yield* Effect.annotateLogsScoped({ result });
    yield* Effect.logInfo("Paid fulfillment reconciliation completed");

    return NextResponse.json(result);
  },
  Effect.scoped
);

export const GET = defineWorkspaceRoute(
  {
    operation: "paidFulfillmentReconciliationCron",
    cancellation: "continue-after-disconnect",
    caller: "service",
  },
  (request) => {
    if (!isAuthorizedCronRequest(request)) {
      return Effect.logWarning(
        "Unauthorized paid fulfillment reconciliation cron request"
      ).pipe(
        Effect.as(NextResponse.json({ error: "Unauthorized" }, { status: 401 }))
      );
    }

    return reconcilePaidFulfillments().pipe(
      Effect.provide(ReconciliationLive),
      Effect.catch(
        Effect.fn("handlePaidFulfillmentCronError")(function* (cause) {
          yield* Effect.logError(
            "Paid fulfillment reconciliation cron failed",
            { cause }
          );

          return NextResponse.json(
            { error: "Paid fulfillment reconciliation failed" },
            { status: 500 }
          );
        })
      )
    );
  }
);
