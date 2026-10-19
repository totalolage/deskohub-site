import type { DotyposCustomerId } from "@deskohub/dotypos";
import type {
  AutomationConditionFilter,
  AutomationRunEventDetail,
  AutomationStepType as AutomationStep,
} from "@deskohub/workspace-admin-api";
import { and, eq, inArray } from "drizzle-orm";
import { Effect, Match, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { emailCampaignAutomationRuns as runs } from "@/db/schema";
import { isDatabaseQueryError } from "@/db/sql-constraint";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { currentInstant } from "@/shared/utils/temporal";
import type { AudienceEvaluationContext } from "../../backend/audience-evaluation-context";
import type { CampaignId } from "../../campaign-identifiers";
import type {
  AutomationRunId,
  AutomationStepId,
  AutomationVersionId,
  AutomationWorkUnitId,
} from "../automation-identifiers";
import type { AutomationTriggerKind } from "../automation-states";
import { AutomationConditionEvaluation } from "./automation-condition-evaluation.service";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import { lockAutomationForEngine } from "./automation-lifecycle-lock";
import { advanceAutomationRuns } from "./automation-run-progress";
import {
  type AutomationRunExpectation,
  AutomationRunTransitions,
} from "./automation-run-transitions";
import {
  type AutomationEngineTransaction,
  AutomationUnitDefect,
  AutomationUnitFetchFailure,
  type AutomationUnitHandler,
  AutomationUnitRecheckFailed,
  automationUnitDeadlineMissLimit,
  type ClaimedAutomationUnit,
  type PlannedAutomationUnit,
  registerAutomationUnitHandler,
} from "./automation-unit-handler";
import {
  type AutomationStepPosition,
  automationStepPosition,
  loadAutomationVersionFlows,
} from "./automation-version-flows";

const conditionSubjectSchema = Schema.Struct({
  versionId: Schema.NonEmptyString.pipe(Schema.brand("AutomationVersionId")),
  stepId: Schema.NonEmptyString.pipe(Schema.brand("AutomationStepId")),
  runIds: Schema.Array(
    Schema.NonEmptyString.pipe(Schema.brand("AutomationRunId"))
  ),
});
type ConditionSubject = typeof conditionSubjectSchema.Type;
type ConditionUnit = ClaimedAutomationUnit<ConditionSubject>;

/** Runs wait for their condition's facts at most this long (§5.2). */
const conditionExpiry = Temporal.Duration.from({ hours: 24 });

/**
 * A `condition` unit for runs at one `(version, step)`. `id` keeps the key
 * unique per planning, so runs a settled unit released are planned again.
 */
export const plannedConditionUnit = (input: {
  readonly id: string;
  readonly campaignId: CampaignId;
  readonly versionId: AutomationVersionId;
  readonly stepId: AutomationStepId;
  readonly runIds: readonly AutomationRunId[];
  readonly requestCost: number;
}): PlannedAutomationUnit => ({
  kind: "condition",
  key: `condition:${input.versionId}:${input.stepId}:${input.id}`,
  campaignId: input.campaignId,
  subject: Schema.encodeSync(conditionSubjectSchema)({
    versionId: input.versionId,
    stepId: input.stepId,
    runIds: [...input.runIds],
  }),
  requestCost: input.requestCost,
});

/** The filter of `stepId` if it is a Condition step of the flow. */
export const conditionStepAt = (
  ...position: Parameters<typeof automationStepPosition>
): Option.Option<
  AutomationStepPosition & {
    readonly filter: AutomationConditionFilter;
  }
> =>
  Option.flatMap(automationStepPosition(...position), ({ step, next }) =>
    step._tag === "Condition"
      ? Option.some({ step, next, filter: step.filter })
      : Option.none()
  );

/** What started a run, as its condition evaluates it. */
export type AutomationRunTrigger = {
  readonly triggerKind: AutomationTriggerKind;
  readonly triggerAt: Temporal.Instant;
  readonly triggerReservationId: WorkspaceReservationId | null;
};

/**
 * A run's condition context at `now`: its automation, which `This`
 * campaign sources name, and its trigger, which trigger-relative periods
 * count from.
 */
export const automationRunEvaluationContext = (
  run: AutomationRunTrigger,
  input: { readonly campaignId: CampaignId; readonly now: Temporal.Instant }
): AudienceEvaluationContext => ({
  now: input.now,
  campaignId: Option.some(input.campaignId),
  trigger: Option.some({
    kind: run.triggerKind,
    at: run.triggerAt,
    reservationId: Option.fromNullishOr(run.triggerReservationId),
  }),
});

/** A run the unit still owns, as it read it. */
type ConditionRun = AutomationRunTrigger & {
  readonly runId: AutomationRunId;
  readonly dotyposCustomerId: DotyposCustomerId;
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
      readonly next: Option.Option<AutomationStep>;
      readonly decisions: readonly {
        readonly runId: AutomationRunId;
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
    tx: AutomationEngineTransaction,
    unit: ConditionUnit,
    runIds: readonly AutomationRunId[],
    at: Temporal.Instant
  ) =>
    AutomationRunTransitions.end(tx, {
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
                  runId: run.runId,
                  decision: decided.get(run.dotyposCustomerId) ?? undecided,
                }))
              )
            )
        )
      ),
      Effect.map(
        ({ decisions }): ConditionFetched => ({
          _tag: "Decided",
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

  /** Advances the runs that matched and ends the rest `condition-failed`. */
  const commitDecisions = (
    tx: AutomationEngineTransaction,
    unit: ConditionUnit,
    decided: Extract<ConditionFetched, { _tag: "Decided" }>,
    at: Temporal.Instant
  ) => {
    const passed = decided.decisions.filter(
      ({ decision }) => decision.outcome === "match"
    );
    const failed = decided.decisions.flatMap(({ runId, decision }) =>
      decision.outcome === "match"
        ? []
        : [
            {
              runId,
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
              tx,
              unit,
              passed.map(({ runId }) => runId),
              at
            ),
          onSome: (next) =>
            advanceAutomationRuns(tx, {
              runs: passed.map(({ runId }) => ({
                runId,
                stepId: unit.subject.stepId,
                phase: "ready" as const,
                nextStepId: next.id,
                passed: "condition-passed" as const,
              })),
              workUnitId: unit.id,
              at,
            }),
        })
      ),
      Effect.tap(() =>
        Effect.forEach(
          byFailureDetail(failed),
          ({ detail, runIds }) =>
            AutomationRunTransitions.end(tx, {
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
    expire: (tx, unit, at) =>
      Effect.Do.pipe(
        Effect.bind("campaignId", () => campaignOf(unit)),
        Effect.bind("lifecycle", ({ campaignId }) =>
          lockAutomationForEngine(tx, campaignId)
        ),
        // A paused or archived automation's runs stay frozen; its commit drops the unit.
        Effect.bind("owned", ({ lifecycle }) =>
          lifecycle.status === "active"
            ? readOwnedRuns(tx, unit)
            : Effect.succeed(null)
        ),
        Effect.bind("ended", ({ owned }) =>
          endUnavailable(
            tx,
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
        Effect.flatMap(({ campaignId, flowOf, owned }) =>
          Option.match(
            conditionStepAt(
              flowOf(unit.subject.versionId),
              unit.subject.stepId
            ),
            {
              onNone: () => Effect.succeed(unavailable),
              onSome: ({ filter, next }) =>
                owned.length === 0
                  ? Effect.succeed<ConditionFetched>({
                      _tag: "Decided",
                      next,
                      decisions: [],
                    })
                  : decide({ campaignId, condition: filter, next, owned }),
            }
          )
        ),
        Effect.catchIf(isDatabaseQueryError, (cause) =>
          Effect.fail(
            new AutomationUnitFetchFailure({ code: "database", cause })
          )
        )
      ),
    commit: (tx, unit, fetched, at) =>
      campaignOf(unit).pipe(
        Effect.flatMap((campaignId) => lockAutomationForEngine(tx, campaignId)),
        Effect.filterOrFail(
          (lifecycle) => lifecycle.status === "active",
          (lifecycle) =>
            new AutomationUnitRecheckFailed({
              code: `automation-${lifecycle.status ?? "missing"}`,
            })
        ),
        Effect.andThen(
          Match.value(fetched).pipe(
            Match.tagsExhaustive({
              Unavailable: () =>
                endUnavailable(tx, unit, unit.subject.runIds, at),
              Decided: (decided) => commitDecisions(tx, unit, decided, at),
            })
          )
        ),
        Effect.as([])
      ),
  };

  return registerAutomationUnitHandler(handler);
});
