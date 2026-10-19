import { Effect } from "effect";
import { emailCampaignAutomationWorkUnits } from "@/db/schema";
import { automationWorkUnitPriorities } from "../automation-work-units";
import type {
  AutomationEngineTransaction,
  PlannedAutomationUnit,
} from "./automation-unit-handler";

/**
 * Inserts units as `planned`, holding no slot. A key that already exists is
 * skipped, so repeated planning is a no-op. Keys insert in order, so
 * overlapping planners never wait on each other in a cycle.
 */
export const planAutomationUnits = Effect.fn("automationUnits.plan")(function* (
  tx: AutomationEngineTransaction,
  units: ReadonlyArray<PlannedAutomationUnit>
) {
  if (units.length === 0) return 0;

  const inserted = yield* tx
    .insert(emailCampaignAutomationWorkUnits)
    .values(
      units
        .toSorted((left, right) => left.key.localeCompare(right.key))
        .map((unit) => ({
          kind: unit.kind,
          priority: automationWorkUnitPriorities[unit.kind],
          campaignId: unit.campaignId ?? null,
          key: unit.key,
          subject: unit.subject,
          requestCost: unit.requestCost,
          status: "planned" as const,
        }))
    )
    .onConflictDoNothing({ target: emailCampaignAutomationWorkUnits.key })
    .returning({ id: emailCampaignAutomationWorkUnits.id });

  return inserted.length;
});
