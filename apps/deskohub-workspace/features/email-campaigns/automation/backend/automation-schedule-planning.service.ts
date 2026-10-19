import { and, asc, eq, lte, notExists } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  emailCampaignAutomations as automations,
  emailCampaigns,
  emailCampaignAutomationScheduleFires as fires,
} from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import { planNextFire } from "./automation-schedule-fires";

/** What planner step 8 did, for the plan summary. */
export type AutomationSchedulePlan = {
  /** Fires created with their chunk units. */
  readonly firesCreated: number;
  /** Fires with an empty pool, entered at once. */
  readonly firesEntered: number;
  /** Fire-chunk units planned. */
  readonly chunksPlanned: number;
};

/** The plan when nothing was due. */
export const emptyAutomationSchedulePlan: AutomationSchedulePlan = {
  firesCreated: 0,
  firesEntered: 0,
  chunksPlanned: 0,
};

interface IAutomationSchedulePlanning {
  /**
   * Planner step 8 (§5.7): runs `planNextFire` for each due schedule automation without an `entering` fire. Runs its own short idempotent transactions, so overlapping
   * planners are harmless.
   */
  readonly plan: (
    at: Temporal.Instant
  ) => Effect.Effect<AutomationSchedulePlan, DatabaseQueryError>;
}

export class AutomationSchedulePlanning extends Context.Service<
  AutomationSchedulePlanning,
  IAutomationSchedulePlanning
>()("@deskohub-workspace/email-campaigns/AutomationSchedulePlanning") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const facts = yield* AutomationEvaluationFacts;

      return {
        plan: (at) =>
          db
            .select({ campaignId: automations.campaignId })
            .from(automations)
            .innerJoin(
              emailCampaigns,
              eq(emailCampaigns.id, automations.campaignId)
            )
            .where(
              and(
                eq(emailCampaigns.status, "active"),
                lte(automations.nextFireAt, at),
                notExists(
                  db
                    .select({ campaignId: fires.campaignId })
                    .from(fires)
                    .where(
                      and(
                        eq(fires.campaignId, automations.campaignId),
                        eq(fires.status, "entering")
                      )
                    )
                )
              )
            )
            .orderBy(asc(automations.campaignId))
            .pipe(
              Effect.flatMap((due) =>
                Effect.forEach(due, ({ campaignId }) =>
                  db.transaction((tx) => planNextFire(tx, campaignId, at))
                )
              ),
              Effect.map((plans) =>
                plans.reduce(
                  (total, plan): AutomationSchedulePlan => ({
                    firesCreated: total.firesCreated + plan.firesCreated,
                    firesEntered: total.firesEntered + plan.firesEntered,
                    chunksPlanned: total.chunksPlanned + plan.chunksPlanned,
                  }),
                  emptyAutomationSchedulePlan
                )
              ),
              Effect.provideService(AutomationEvaluationFacts, facts),
              Effect.withSpan("AutomationSchedulePlanning.plan")
            ),
      } satisfies IAutomationSchedulePlanning;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(WorkspaceDatabase.Default, AutomationEvaluationFacts.Live)
    )
  );
}
