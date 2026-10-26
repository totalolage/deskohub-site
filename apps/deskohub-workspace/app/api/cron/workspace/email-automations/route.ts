import { Effect } from "effect";
import { AutomationPlanner } from "@/features/email-campaigns/automation/backend/automation-planner.service";
import { defineWorkspaceCron } from "@/shared/backend/service-route";

export const maxDuration = 300;

/**
 * The automation engine tick plans units and makes no Dotypos call.
 */
export const GET = defineWorkspaceCron({
  operation: "emailAutomationPlannerCron",
  failureMessage: "Email automation planning failed",
  run: () =>
    Effect.flatMap(AutomationPlanner, (planner) => planner.plan).pipe(
      Effect.provide(AutomationPlanner.Live)
    ),
});
