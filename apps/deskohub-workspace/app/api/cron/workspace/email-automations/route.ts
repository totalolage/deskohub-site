import { Effect } from "effect";
import { NextResponse } from "next/server";
import { AutomationPlanner } from "@/features/email-campaigns/automation/backend/automation-planner.service";
import { isAuthorizedCronRequest } from "@/shared/backend/cron-request";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";

export const maxDuration = 300;

/**
 * The automation engine tick plans units and makes no Dotypos call.
 */
export const GET = defineWorkspaceRoute(
  {
    operation: "emailAutomationPlannerCron",
    cancellation: "continue-after-disconnect",
    caller: "service",
  },
  (request) => {
    if (!isAuthorizedCronRequest(request)) {
      return Effect.logWarning(
        "Unauthorized email automation planner cron request"
      ).pipe(
        Effect.as(NextResponse.json({ error: "Unauthorized" }, { status: 401 }))
      );
    }

    return Effect.flatMap(AutomationPlanner, (planner) => planner.plan).pipe(
      Effect.map((summary) => NextResponse.json(summary)),
      Effect.provide(AutomationPlanner.Live),
      Effect.catch(
        Effect.fn("handleEmailAutomationPlannerCronError")(function* (cause) {
          yield* Effect.logError("Email automation planner cron failed", {
            cause,
          });

          return NextResponse.json(
            { error: "Email automation planning failed" },
            { status: 500 }
          );
        })
      )
    );
  }
);
