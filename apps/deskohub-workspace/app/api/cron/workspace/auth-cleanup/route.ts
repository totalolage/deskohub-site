import { Effect } from "effect";
import { NextResponse } from "next/server";
import {
  type AuthCleanupFailure,
  AuthCleanupService,
} from "@/features/account/backend/auth/auth-cleanup.service";
import { isAuthorizedCronRequest } from "@/shared/backend/cron-request";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";

const sweepExpiredAuthRows = Effect.gen(function* () {
  const input = { now: new Date() };
  yield* Effect.annotateLogsScoped({ input });
  yield* Effect.logInfo("Customer account cleanup sweep started");

  const cleanup = yield* AuthCleanupService;
  const result = yield* cleanup.deleteExpiredRows(input);
  yield* Effect.annotateLogsScoped({ result });
  yield* Effect.logInfo("Customer account cleanup sweep completed");

  return NextResponse.json(result);
}).pipe(Effect.scoped);

const handleAuthCleanupCronError = (failure: AuthCleanupFailure) =>
  Effect.logError("Customer account cleanup cron failed", {
    code: "account.cleanup.unavailable",
    cause: failure,
  }).pipe(
    Effect.as(
      NextResponse.json(
        { error: "Customer account cleanup failed" },
        { status: 500 }
      )
    )
  );

export const GET = defineWorkspaceRoute(
  {
    operation: "authCleanupCron",
    cancellation: "continue-after-disconnect",
    caller: "service",
  },
  (request) => {
    if (!isAuthorizedCronRequest(request)) {
      return Effect.logWarning(
        "Unauthorized customer account cleanup cron request"
      ).pipe(
        Effect.as(NextResponse.json({ error: "Unauthorized" }, { status: 401 }))
      );
    }

    return sweepExpiredAuthRows.pipe(
      Effect.provide(AuthCleanupService.Live),
      Effect.catch(handleAuthCleanupCronError)
    );
  }
);
