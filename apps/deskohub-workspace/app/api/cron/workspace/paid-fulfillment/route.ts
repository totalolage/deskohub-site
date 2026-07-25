import { Effect } from "effect";
import { NextResponse } from "next/server";
import { env } from "@/env";
import {
  PaidFulfillmentRecoveryService,
  PaidFulfillmentRecoveryServiceLiveWithDependencies,
} from "@/features/checkout/backend/fulfillment";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";

const cronBatchLimit = 25;

const isAuthorizedCronRequest = (request: Request) => {
  if (!env.CRON_SECRET) return env.VERCEL_ENV === "development";

  return request.headers.get("authorization") === `Bearer ${env.CRON_SECRET}`;
};

const sweepPaidFulfillment = Effect.fn("sweepPaidFulfillment")(function* () {
  const recovery = yield* PaidFulfillmentRecoveryService;
  const result = yield* recovery.sweep({
    now: Temporal.Now.instant(),
    limit: cronBatchLimit,
  });

  return NextResponse.json(result);
});

export const GET = defineWorkspaceRoute(
  {
    operation: "paidFulfillmentCron",
    cancellation: "continue-after-disconnect",
  },
  (request) => {
    if (!isAuthorizedCronRequest(request)) {
      return Effect.logWarning(
        "Unauthorized paid fulfillment cron request"
      ).pipe(
        Effect.as(NextResponse.json({ error: "Unauthorized" }, { status: 401 }))
      );
    }

    return sweepPaidFulfillment().pipe(
      Effect.provide(PaidFulfillmentRecoveryServiceLiveWithDependencies),
      Effect.catch(() =>
        Effect.logError("Paid fulfillment cron failed").pipe(
          Effect.as(
            NextResponse.json(
              { error: "Paid fulfillment recovery failed" },
              { status: 500 }
            )
          )
        )
      )
    );
  }
);
