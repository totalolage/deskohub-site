import { and, eq, inArray, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { emailCampaignAutomationRuns as runs } from "@/db/schema";
import type { AutomationRunId } from "../automation-identifiers";
import type {
  AutomationEngineTransaction,
  PlannedAutomationUnit,
} from "./automation-unit-handler";
import { planAutomationUnits } from "./automation-unit-planning";

/**
 * Plans units that each take the runs they were packed for: inserts them,
 * then gives each written unit its runs by compare-and-set on runs still
 * `active`, `ready` and unowned. The CAS doesn't recheck the step, so the
 * caller must hold the automation's lifecycle lock and the runs' row locks,
 * and must have read the runs at the step the units are for (§5.4). Then the
 * CAS takes no new lock. Returns, per written unit, the runs it took.
 */
export const planAutomationRunUnits = Effect.fn("automationRunUnits.plan")(
  function* (
    tx: AutomationEngineTransaction,
    planned: readonly {
      readonly unit: PlannedAutomationUnit;
      readonly runIds: readonly AutomationRunId[];
    }[],
    at: Temporal.Instant
  ) {
    const { written } = yield* planAutomationUnits(
      tx,
      planned.map(({ unit }) => unit),
      at
    );
    const runIdsOf = new Map(
      planned.map(({ unit, runIds }) => [unit.key, runIds])
    );
    return yield* Effect.forEach(written, ({ unitId, key }) =>
      tx
        .update(runs)
        .set({ workUnitId: unitId, updatedAt: at })
        .where(
          and(
            inArray(runs.id, [...(runIdsOf.get(key) ?? [])]),
            eq(runs.status, "active"),
            eq(runs.phase, "ready"),
            isNull(runs.workUnitId)
          )
        )
        .returning({ runId: runs.id })
    );
  }
);
