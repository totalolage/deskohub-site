import type { AutomationStepType as AutomationStep } from "@deskohub/workspace-admin-api";
import { Effect, Match, Option } from "effect";
import type { CampaignId } from "../../campaign-identifiers";
import type { AutomationVersionId } from "../automation-identifiers";
import {
  type ConditionStepRun,
  planConditionSteps,
} from "./automation-condition-units";
import type { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import { planDeliverRuns } from "./automation-send-planning.service";
import type { AutomationEngineTransaction } from "./automation-unit-handler";

/**
 * Plans the step runs just reached, in the transaction that moved them there
 * (D36): a Condition gets condition units at `chainedSteps`, the Send gets
 * deliver units. A wait is left to the next tick's timers. Entry and
 * condition units call it for the runs they inserted or advanced, so a run
 * goes through its conditions to its wait or send within the tick it entered
 * or woke on. The caller holds the automation's lifecycle lock and the runs'
 * row locks (§5.4), and the runs are `ready` and unowned.
 */
export const planReachedStep = (
  tx: AutomationEngineTransaction,
  facts: AutomationEvaluationFacts["Service"],
  input: {
    readonly campaignId: CampaignId;
    readonly versionId: AutomationVersionId;
    readonly step: AutomationStep;
    readonly runs: readonly ConditionStepRun[];
    readonly at: Temporal.Instant;
    readonly chainedSteps: number;
  }
) => {
  const [first, ...rest] = input.runs;
  if (first === undefined) return Effect.void;
  return Match.value(input.step).pipe(
    Match.tagsExhaustive({
      Condition: ({ id, filter }) =>
        planConditionSteps(tx, facts, {
          campaignId: input.campaignId,
          steps: [
            {
              versionId: input.versionId,
              stepId: id,
              filter: Option.some(filter),
              runs: [first, ...rest],
            },
          ],
          at: input.at,
          chainedSteps: input.chainedSteps,
        }),
      Send: () =>
        planDeliverRuns(
          tx,
          input.runs.map((run) => ({
            id: run.runId,
            campaignId: input.campaignId,
            versionId: input.versionId,
            triggerKind: run.triggerKind,
          })),
          input.at
        ),
      Wait: () => Effect.void,
    }),
    Effect.asVoid
  );
};
