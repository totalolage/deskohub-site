import "@/shared/polyfills/temporal";

import type { DotyposCustomerId } from "@deskohub/dotypos";
import type {
  AutomationConditionFilter,
  AutomationFlowType as AutomationFlow,
  AutomationRunEventDetail,
  AutomationStepType as AutomationStep,
} from "@deskohub/workspace-admin-api";
import { and, eq, inArray } from "drizzle-orm";
import { Effect, Match, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { emailCampaignAutomationRuns as runs } from "@/db/schema";
import { isDatabaseQueryError } from "@/db/sql-constraint";
import { currentInstant } from "@/shared/utils/temporal";
import type { CampaignId } from "../../campaign-identifiers";
import type {
  AutomationRunId,
  AutomationWorkUnitId,
} from "../automation-identifiers";
import { AutomationConditionEvaluation } from "./automation-condition-evaluation.service";
import {
  automationRunEvaluationContext,
  type ConditionStepRun,
  type ConditionSubject,
  conditionStepAt,
  conditionSubjectSchema,
} from "./automation-condition-units";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import { lockAutomationForEngine } from "./automation-lifecycle-lock";
import { planReachedStep } from "./automation-reached-step";
import { advanceAutomationRuns } from "./automation-run-progress";
import {
  type AutomationRunExpectation,
  AutomationRunTransitions,
} from "./automation-run-transitions";
import {
  AutomationUnitDefect,
  AutomationUnitFetchFailure,
  type AutomationUnitHandler,
  AutomationUnitRecheckFailed,
  automationUnitDeadlineMissLimit,
  type ClaimedAutomationUnit,
  registerAutomationUnitHandler,
} from "./automation-unit-handler";
import { loadAutomationVersionFlows } from "./automation-version-flows";

type ConditionUnit = ClaimedAutomationUnit<ConditionSubject>;

/** Runs wait for their condition's facts at most this long (§5.2). */
const conditionExpiry = Temporal.Duration.from({ hours: 24 });

/** A run the unit still owns, as it read it. */
type ConditionRun = ConditionStepRun & {
  readonly stepEnteredAt: Temporal.Instant;
};

type ConditionDecision =
  Effect.Success<
    ReturnType<AutomationConditionEvaluation["Service"]["evaluate"]>
  > extends ReadonlyMap<DotyposCustomerId, infer Decision>
    ? Decision
    : never;

/** A customer the evaluation returned nothing for can't pass. */
const undecided: ConditionDecision = {
  outcome: "unknown",
  failedConditions: [],
  savedAudiences: [],
};

/**
 * The unit's decisions, or `Unavailable` when the runs can't be decided:
 * the version's flow or step is gone, or a referenced saved audience was
 * deleted (§2.3).
 */
type ConditionFetched =
  | {
      readonly _tag: "Decided";
      readonly flow: Option.Option<AutomationFlow>;
      readonly next: Option.Option<AutomationStep>;
      readonly decisions: readonly {
        readonly run: ConditionRun;
        readonly decision: ConditionDecision;
      }[];
    }
  | { readonly _tag: "Unavailable" };

const unavailable: ConditionFetched = { _tag: "Unavailable" };

/** The runs at the unit's step that it still owns. */
const ownedRunsOf = (
  unit: ConditionUnit
): AutomationRunExpectation & {
  readonly workUnitId: AutomationWorkUnitId;
} => ({
  status: "active",
  stepId: unit.subject.stepId,
  phase: "ready",
  workUnitId: unit.id,
});

const readOwnedRuns = (
  db: WorkspaceDatabase["Service"]["db"],
  unit: ConditionUnit
) =>
  db
    .select({
      runId: runs.id,
      dotyposCustomerId: runs.dotyposCustomerId,
      triggerKind: runs.triggerKind,
      triggerAt: runs.triggerAt,
      triggerReservationId: runs.triggerReservationId,
      stepEnteredAt: runs.stepEnteredAt,
    })
    .from(runs)
    .where(
      and(
        inArray(runs.id, [...unit.subject.runIds]),
        eq(runs.status, "active"),
        eq(runs.stepId, unit.subject.stepId),
        eq(runs.phase, "ready"),
        eq(runs.workUnitId, unit.id)
      )
    )
    .orderBy(runs.id);

const campaignOf = (unit: ConditionUnit) =>
  Effect.fromNullishOr(unit.campaignId).pipe(
    Effect.mapError(
      () => new AutomationUnitDefect({ code: "unit-without-campaign" })
    )
  );

/** Runs that share a trigger share an evaluation context. */
const byTrigger = (owned: readonly ConditionRun[]) => {
  const groups = new Map<
    string,
    { readonly trigger: ConditionRun; readonly runs: ConditionRun[] }
  >();
  for (const run of owned) {
    const key = `${run.triggerKind}\u0000${run.triggerAt.toString()}\u0000${run.triggerReservationId ?? ""}`;
    const group = groups.get(key) ?? { trigger: run, runs: [] };
    group.runs.push(run);
    groups.set(key, group);
  }
  return [...groups.values()];
};

/** Runs that failed with the same detail end in one compare-and-set. */
const byFailureDetail = (
  failed: readonly {
    readonly runId: AutomationRunId;
    readonly detail: AutomationRunEventDetail<"condition-failed">;
  }[]
) => {
  const groups = new Map<
    string,
    {
      readonly detail: AutomationRunEventDetail<"condition-failed">;
      readonly runIds: AutomationRunId[];
    }
  >();
  for (const { runId, detail } of failed) {
    const key = JSON.stringify(detail);
    const group = groups.get(key) ?? { detail, runIds: [] };
    group.runIds.push(runId);
    groups.set(key, group);
  }
  return [...groups.values()];
};

/**
 * The `condition` unit: evaluates one `(version, step)` Condition for its
 * runs at the time after its fetch (D9, D17), against saved audiences'
 * current definitions (D32), and advances or ends each run once (§5.8).
 */
export const makeConditionHandler = Effect.gen(function* () {
  const { db } = yield* WorkspaceDatabase;
  const facts = yield* AutomationEvaluationFacts;
  const evaluation = yield* AutomationConditionEvaluation;

  const endUnavailable = (
    unit: ConditionUnit,
    runIds: readonly AutomationRunId[],
    at: Temporal.Instant
  ) =>
    AutomationRunTransitions.end({
      runIds,
      expect: ownedRunsOf(unit),
      outcome: "failed",
      reason: "evaluation-unavailable",
      at,
    });

  /** Fetches the facts the filter needs, for the owned runs only, and decides them. */
  const decide = (input: {
    readonly campaignId: CampaignId;
    readonly condition: AutomationConditionFilter;
    readonly flow: Option.Option<AutomationFlow>;
    readonly next: Option.Option<AutomationStep>;
    readonly owned: readonly ConditionRun[];
  }) =>
    Effect.Do.pipe(
      Effect.bind("plannedAt", () => currentInstant),
      Effect.bind("plan", ({ plannedAt }) =>
        facts.plan({
          filters: { condition: input.condition },
          context: Option.match(Option.fromUndefinedOr(input.owned[0]), {
            onNone: () => ({
              now: plannedAt,
              campaignId: Option.some(input.campaignId),
              trigger: Option.none(),
            }),
            onSome: (run) =>
              automationRunEvaluationContext(run, {
                campaignId: input.campaignId,
                now: plannedAt,
              }),
          }),
        })
      ),
      Effect.let("customers", () =>
        input.owned.map((run) => run.dotyposCustomerId)
      ),
      Effect.bind("facts", ({ plan, customers }) =>
        facts.fetch({ reads: plan.reads, customers })
      ),
      // Evaluated at an instant sampled after the fetch (§5.2).
      Effect.bind("at", () => currentInstant),
      Effect.bind("decisions", ({ plan, facts: fetched, at }) =>
        Effect.forEach(byTrigger(input.owned), (group) =>
          evaluation
            .evaluate({
              condition: input.condition,
              plan,
              customers: group.runs.map((run) => run.dotyposCustomerId),
              context: automationRunEvaluationContext(group.trigger, {
                campaignId: input.campaignId,
                now: at,
              }),
              facts: fetched,
            })
            .pipe(
              Effect.map((decided) =>
                group.runs.map((run) => ({
                  run,
                  decision: decided.get(run.dotyposCustomerId) ?? undecided,
                }))
              )
            )
        )
      ),
      Effect.map(
        ({ decisions }): ConditionFetched => ({
          _tag: "Decided",
          flow: input.flow,
          next: input.next,
          decisions: decisions.flat(),
        })
      ),
      Effect.catchTags({
        AutomationConditionAudienceMissing: () => Effect.succeed(unavailable),
        CampaignRecipientResolutionError: (error) =>
          Effect.fail(
            new AutomationUnitFetchFailure({
              code: `evaluation-${error.source}`,
              cause: error,
            })
          ),
      })
    );

  /**
   * Plans the step the passed runs reached, one deeper in the chain (D36).
   * Past the cap the runs stay `ready` for the next planner tick.
   */
  const planReached = (
    unit: ConditionUnit,
    input: {
      readonly campaignId: CampaignId;
      readonly flow: Option.Option<AutomationFlow>;
      readonly next: AutomationStep;
      readonly moved: readonly ConditionRun[];
      readonly at: Temporal.Instant;
    }
  ) =>
    planReachedStep(facts, {
      campaignId: input.campaignId,
      versionId: unit.subject.versionId,
      flow: input.flow,
      stepId: input.next.id,
      runs: input.moved,
      at: input.at,
      chainedSteps: (unit.subject.chainedSteps ?? 0) + 1,
    });

  /**
   * Advances the runs that matched, planning the step they reach, and ends
   * the rest `condition-failed`.
   */
  const commitDecisions = (
    unit: ConditionUnit,
    campaignId: CampaignId,
    decided: Extract<ConditionFetched, { _tag: "Decided" }>,
    at: Temporal.Instant
  ) => {
    const passed = decided.decisions.flatMap(({ run, decision }) =>
      decision.outcome === "match" ? [run] : []
    );
    const failed = decided.decisions.flatMap(({ run, decision }) =>
      decision.outcome === "match"
        ? []
        : [
            {
              runId: run.runId,
              detail: {
                failedConditions: [...decision.failedConditions],
                savedAudiences: decision.savedAudiences.map(
                  ({ audienceId, filterHash }) => ({ audienceId, filterHash })
                ),
              },
            },
          ]
    );
    return Effect.Do.pipe(
      Effect.tap(() =>
        Option.match(decided.next, {
          // A condition is never last, so a flow without a next step is a defect.
          onNone: () =>
            endUnavailable(
              unit,
              passed.map(({ runId }) => runId),
              at
            ),
          onSome: (next) =>
            advanceAutomationRuns({
              runs: passed.map(({ runId }) => ({
                runId,
                stepId: unit.subject.stepId,
                phase: "ready" as const,
                nextStepId: next.id,
                passed: "condition-passed" as const,
              })),
              workUnitId: unit.id,
              at,
            }).pipe(
              Effect.flatMap((movedIds) => {
                const moved = new Set(movedIds);
                return planReached(unit, {
                  campaignId,
                  flow: decided.flow,
                  next,
                  moved: passed.filter(({ runId }) => moved.has(runId)),
                  at,
                });
              })
            ),
        })
      ),
      Effect.tap(() =>
        Effect.forEach(
          byFailureDetail(failed),
          ({ detail, runIds }) =>
            AutomationRunTransitions.end({
              runIds,
              expect: ownedRunsOf(unit),
              outcome: "condition-failed",
              detail,
              at,
            }),
          { discard: true }
        )
      )
    );
  };

  const handler: AutomationUnitHandler<ConditionSubject, ConditionFetched> = {
    kind: "condition",
    subject: conditionSubjectSchema,
    expire: (unit, at) =>
      Effect.Do.pipe(
        Effect.bind("campaignId", () => campaignOf(unit)),
        Effect.bind("lifecycle", ({ campaignId }) =>
          lockAutomationForEngine(campaignId)
        ),
        // A paused or archived automation's runs stay frozen; its commit drops the unit.
        Effect.bind("owned", ({ lifecycle }) =>
          lifecycle.status === "active"
            ? readOwnedRuns(db, unit)
            : Effect.succeed(null)
        ),
        Effect.bind("ended", ({ owned }) =>
          endUnavailable(
            unit,
            (owned ?? [])
              .filter(
                (run) =>
                  unit.deadlineMisses >= automationUnitDeadlineMissLimit ||
                  Temporal.Instant.compare(
                    run.stepEnteredAt,
                    at.subtract(conditionExpiry)
                  ) < 0
              )
              .map((run) => run.runId),
            at
          )
        ),
        Effect.map(({ owned, ended }) =>
          owned === null || owned.length > ended.length
            ? ("remaining" as const)
            : ("settled" as const)
        )
      ),
    fetch: (unit) =>
      Effect.Do.pipe(
        Effect.bind("campaignId", () => campaignOf(unit)),
        Effect.bind("flowOf", () =>
          loadAutomationVersionFlows(db, [unit.subject.versionId])
        ),
        Effect.bind("owned", () => readOwnedRuns(db, unit)),
        Effect.flatMap(({ campaignId, flowOf, owned }) => {
          const flow = flowOf(unit.subject.versionId);
          return Option.match(conditionStepAt(flow, unit.subject.stepId), {
            onNone: () => Effect.succeed(unavailable),
            onSome: ({ filter, next }) =>
              owned.length === 0
                ? Effect.succeed<ConditionFetched>({
                    _tag: "Decided",
                    flow,
                    next,
                    decisions: [],
                  })
                : decide({ campaignId, condition: filter, flow, next, owned }),
          });
        }),
        Effect.catchIf(isDatabaseQueryError, (cause) =>
          Effect.fail(
            new AutomationUnitFetchFailure({ code: "database", cause })
          )
        )
      ),
    commit: (unit, fetched, at) =>
      campaignOf(unit).pipe(
        Effect.tap((campaignId) =>
          lockAutomationForEngine(campaignId).pipe(
            Effect.filterOrFail(
              (lifecycle) => lifecycle.status === "active",
              (lifecycle) =>
                new AutomationUnitRecheckFailed({
                  code: `automation-${lifecycle.status ?? "missing"}`,
                })
            )
          )
        ),
        Effect.flatMap((campaignId) =>
          Match.value(fetched).pipe(
            Match.tagsExhaustive({
              Unavailable: () => endUnavailable(unit, unit.subject.runIds, at),
              Decided: (decided) =>
                commitDecisions(unit, campaignId, decided, at),
            })
          )
        ),
        Effect.as([])
      ),
  };

  return registerAutomationUnitHandler(handler);
});
