import {
  type AutomationFlowType as AutomationFlow,
  automationFlowMaxSteps,
} from "@deskohub/workspace-admin-api";
import { Effect, Match, Option } from "effect";
import type { CampaignId } from "../../campaign-identifiers";
import type {
  AutomationRunId,
  AutomationStepId,
  AutomationVersionId,
} from "../automation-identifiers";
import { evaluateStep } from "../automation-step-evaluation";
import {
  type ConditionStepRun,
  planConditionSteps,
} from "./automation-condition-units";
import type { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import {
  advanceAutomationRuns,
  waitAutomationRuns,
} from "./automation-run-progress";
import { AutomationRunTransitions } from "./automation-run-transitions";
import { planDeliverRuns } from "./automation-send-planning.service";
import type { AutomationEngineTransaction } from "./automation-unit-handler";
import { automationStepPosition } from "./automation-version-flows";

/**
 * The deepest step a chain reaches without the planner (D36). Entry and the
 * planner start chains at depth 0, and each step a chain moves its runs on
 * to is one deeper. A flow has at most `automationFlowMaxSteps` steps, so
 * every valid flow reaches its pending wait or its send within the tick,
 * and the cap only bounds a defect. Runs past it stay `ready` for the
 * planner.
 */
export const maxChainedSteps = automationFlowMaxSteps - 1;

/** Runs that reached a step of their version's flow, `ready` and unowned. */
export type ReachedStep<Run extends { readonly runId: AutomationRunId }> = {
  readonly campaignId: CampaignId;
  readonly versionId: AutomationVersionId;
  readonly flow: Option.Option<AutomationFlow>;
  readonly stepId: AutomationStepId;
  readonly runs: readonly Run[];
  readonly at: Temporal.Instant;
  /** The step's depth in its chain. */
  readonly chainedSteps: number;
};

/** Ends runs whose step can't be decided `failed / evaluation-unavailable`. */
const endUnavailable = (
  tx: AutomationEngineTransaction,
  input: {
    readonly stepId: AutomationStepId;
    readonly runIds: readonly AutomationRunId[];
    readonly at: Temporal.Instant;
  }
) =>
  AutomationRunTransitions.end(tx, {
    runIds: input.runIds,
    expect: {
      status: "active",
      stepId: input.stepId,
      phase: "ready",
      workUnitId: null,
    },
    outcome: "failed",
    reason: "evaluation-unavailable",
    at: input.at,
  });

/**
 * Enters the waits runs reached, evaluated at `at` as on entry: a wait not
 * due yet stores its due time, and one already holding or due advances the
 * runs, through any waits after it. Returns the first step that isn't a
 * wait with the runs that reached it, if any did. A step past the chain
 * cap is returned unentered, so the caller leaves its runs `ready`.
 */
export const enterReachedWaits = Effect.fn("automationReachedSteps.enterWaits")(
  function* (
    tx: AutomationEngineTransaction,
    reached: ReachedStep<{ readonly runId: AutomationRunId }>
  ) {
    let current = reached;
    for (;;) {
      if (current.runs.length === 0) return Option.none();
      const position = automationStepPosition(current.flow, current.stepId);
      if (Option.isNone(position)) {
        yield* endUnavailable(tx, {
          stepId: current.stepId,
          runIds: current.runs.map(({ runId }) => runId),
          at: current.at,
        });
        return Option.none();
      }
      const { step, next } = position.value;
      if (step._tag !== "Wait" || current.chainedSteps > maxChainedSteps) {
        return Option.some({ step, reached: current });
      }
      const transition = evaluateStep({
        step,
        phase: "ready",
        at: current.at,
        stepEnteredAt: current.at,
        dueAt: Option.none(),
        resumedAt: Option.none(),
        condition: Option.none(),
      });
      const runIds = current.runs.map(({ runId }) => runId);
      if (transition._tag === "Wait") {
        yield* waitAutomationRuns(tx, {
          runs: runIds.map((runId) => ({
            runId,
            stepId: current.stepId,
            phase: "ready" as const,
            dueAt: transition.dueAt,
          })),
          at: current.at,
        });
        return Option.none();
      }
      if (transition._tag !== "Advance" || Option.isNone(next)) {
        // A calendar that never occurs again, or a wait without a step after it.
        yield* endUnavailable(tx, {
          stepId: current.stepId,
          runIds,
          at: current.at,
        });
        return Option.none();
      }
      const moved = new Set(
        yield* advanceAutomationRuns(tx, {
          runs: runIds.map((runId) => ({
            runId,
            stepId: current.stepId,
            phase: "ready" as const,
            nextStepId: next.value.id,
            passed: "woke" as const,
          })),
          workUnitId: null,
          at: current.at,
        })
      );
      current = {
        ...current,
        stepId: next.value.id,
        runs: current.runs.filter(({ runId }) => moved.has(runId)),
        chainedSteps: current.chainedSteps + 1,
      };
    }
  }
);

/**
 * Plans the step runs just reached, in the transaction that moved them there
 * (D36): a Condition gets condition units at `chainedSteps`, the Send gets
 * deliver units, and a wait is entered as `enterReachedWaits` does, its
 * runs going on when it already holds or is due. Entry and condition units
 * call it for the runs they inserted or advanced, so a run goes through its
 * conditions and due waits to a pending wait or its send within the tick it
 * entered or woke on. The caller holds the automation's lifecycle lock and
 * the runs' row locks (§5.4).
 */
export const planReachedStep = Effect.fn("automationReachedSteps.plan")(
  function* (
    tx: AutomationEngineTransaction,
    facts: AutomationEvaluationFacts["Service"],
    reached: ReachedStep<ConditionStepRun>
  ) {
    const entered = yield* enterReachedWaits(tx, reached);
    if (Option.isNone(entered)) return;
    const { step, reached: target } = entered.value;
    const runOf = new Map(reached.runs.map((run) => [run.runId, run]));
    const runs = target.runs.flatMap(({ runId }) =>
      Option.toArray(Option.fromUndefinedOr(runOf.get(runId)))
    );
    const [first, ...rest] = runs;
    if (first === undefined) return;
    if (target.chainedSteps > maxChainedSteps) {
      return yield* Effect.logWarning("Automation step chain reached its cap", {
        stepId: target.stepId,
        chainedSteps: target.chainedSteps,
        runs: runs.length,
      });
    }
    yield* Match.value(step).pipe(
      Match.tagsExhaustive({
        Condition: ({ id, filter }) =>
          planConditionSteps(tx, facts, {
            campaignId: target.campaignId,
            steps: [
              {
                versionId: target.versionId,
                stepId: id,
                filter: Option.some(filter),
                runs: [first, ...rest],
              },
            ],
            at: target.at,
            chainedSteps: target.chainedSteps,
          }),
        Send: () =>
          planDeliverRuns(
            tx,
            runs.map((run) => ({
              id: run.runId,
              campaignId: target.campaignId,
              versionId: target.versionId,
              triggerKind: run.triggerKind,
            })),
            target.at
          ),
        // `enterReachedWaits` returns a wait only past the cap.
        Wait: () => Effect.void,
      }),
      Effect.asVoid
    );
  }
);
