import "server-only";

import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposService,
} from "@deskohub/dotypos";
import type {
  AutomationConditionFilter,
  AutomationFlowType as AutomationFlow,
  AutomationStepType as AutomationStep,
} from "@deskohub/workspace-admin-api";
import { and, eq, inArray, ne } from "drizzle-orm";
import { Data, Effect, Match, Option, Schema } from "effect";
import { WorkspaceDatabase, WorkspaceTransaction } from "@/db/database.service";
import { toStoredInstant } from "@/db/instant";
import {
  emailCampaignAutomationPreviews as previews,
  emailCampaignAutomationRuns as runs,
  workspaceReservations,
} from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import {
  type ReservationVisit,
  ReservationVisits,
} from "@/features/reservation/backend/reservation-visits.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { currentInstant } from "@/shared/utils/temporal";
import {
  type AudienceFilter,
  type AudienceFilterOutcome,
  audienceReservationStatusesOf,
} from "../../audience-filter";
import {
  type AudienceEvaluationContext,
  type AudienceFactSource,
  AudienceScope,
} from "../../backend/audience-evaluation-context";
import { CampaignCandidateRepository } from "../../backend/campaign-candidate.repository";
import { CampaignRecipientService } from "../../backend/campaign-recipient.service";
import type { CampaignPurpose } from "../../body/campaign-content";
import type { CampaignId } from "../../campaign-identifiers";
import type { CampaignRecipientResolutionError } from "../../errors";
import {
  countsSimulatedSendsIn,
  type ReplayedEvent,
  replayCustomerEvents,
  replayedFilter,
  simulateRun,
} from "../automation-dry-run-simulation";
import {
  type AutomationPreviewId,
  type AutomationStepId,
  type AutomationWorkUnitId,
  automationPreviewIdSchema,
} from "../automation-identifiers";
import type { AutomationTriggerKind } from "../automation-states";
import { automationTickAtOrAfter } from "../automation-ticks";
import {
  readsTriggeringVisit,
  triggeringVisitVerdict,
  withdrawnByCancellation,
} from "../automation-trigger-verification";
import { automationTriggerKind } from "../automation-triggers";
import type { AutomationConditionAudienceMissing } from "../errors";
import { AutomationConditionEvaluation } from "./automation-condition-evaluation.service";
import {
  AutomationEvaluationFacts,
  type AutomationEvaluationPlan,
} from "./automation-evaluation-facts.service";
import {
  type AutomationPreviewOutcomeRow,
  type AutomationPreviewRow,
  closePreview,
  type ReplayEvent,
  recordPreviewUnit,
  replayEventScope,
  selectReplayEvents,
} from "./automation-previews";
import {
  AutomationUnitFetchFailure,
  type AutomationUnitHandler,
  type ClaimedAutomationUnit,
  type PlannedAutomationUnit,
  registerAutomationUnitHandler,
} from "./automation-unit-handler";
import { loadAutomationWorkingCopy } from "./automation-working-copy";

const previewUnitSubjectSchema = Schema.Struct({
  previewId: automationPreviewIdSchema,
  customerIds: Schema.Array(DotyposCustomerIdSchema),
});
type PreviewUnitSubject = typeof previewUnitSubjectSchema.Type;

/** After this many deadline misses a solo unit's customers are `unavailable` (§5.3). */
const unavailableAfterDeadlineMisses = 3;

/** The `preview` unit that evaluates one packed chunk of a dry run's customers. */
export const plannedPreviewUnit = (input: {
  readonly previewId: AutomationPreviewId;
  readonly campaignId: CampaignId;
  /** The chunk's position in the dry run, from 0. */
  readonly index: number;
  readonly customers: readonly DotyposCustomerId[];
  readonly requestCost: number;
}): PlannedAutomationUnit => ({
  kind: "preview",
  key: `preview:${input.previewId}:${input.index}`,
  campaignId: input.campaignId,
  subject: Schema.encodeSync(previewUnitSubjectSchema)({
    previewId: input.previewId,
    customerIds: input.customers,
  }),
  requestCost: input.requestCost,
});

/** What a preview unit's fetch found and computed. */
type PreviewUnitFetch = Data.TaggedEnum<{
  /** The dry run is gone or no longer running; the unit writes nothing. */
  Closed: Record<never, never>;
  /** The working copy no longer has the dry run's draft hash. */
  Changed: Record<never, never>;
  Evaluated: { readonly rows: readonly AutomationPreviewOutcomeRow[] };
}>;
const PreviewUnitFetch = Data.taggedEnum<PreviewUnitFetch>();

/** The dry run a unit found: closed, changed, or ready to evaluate. */
type LoadedPreviewJob =
  | Exclude<PreviewUnitFetch, { readonly _tag: "Evaluated" }>
  | { readonly _tag: "Ready"; readonly job: PreviewJob };

/** The working copy a running dry run evaluates, as the unit read it. */
type PreviewJob = {
  readonly preview: AutomationPreviewRow;
  readonly flow: AutomationFlow;
  readonly audienceFilter: AudienceFilter;
  readonly purpose: CampaignPurpose;
  /** Replay only: the unit's customers' share of the replayed events. */
  readonly events: readonly ReplayEvent[];
};

/** A condition referencing a saved audience that's gone ends the run unavailable. */
class PreviewConditionUnavailable extends Data.TaggedError(
  "PreviewConditionUnavailable"
)<{
  readonly stepId: AutomationStepId;
  readonly at: Temporal.Instant;
}> {}

/**
 * The `preview` unit (design §8): evaluates one chunk of a dry run's
 * customers against the working copy and records the computed outcomes.
 * Facts are fetched once per invocation and never stored (D35). The dry
 * run doesn't depend on the campaign's status, so the commit takes no
 * lifecycle lock; a changed working copy supersedes the dry run instead.
 */
export const makePreviewUnitHandler = Effect.gen(function* () {
  const { db, transaction } = yield* WorkspaceDatabase;
  const facts = yield* AutomationEvaluationFacts;
  const recipients = yield* CampaignRecipientService;
  const conditions = yield* AutomationConditionEvaluation;
  const candidates = yield* CampaignCandidateRepository;
  const context = yield* Effect.context<WorkspaceDatabase | DotyposService>();

  const databaseFailure = (cause: DatabaseQueryError) =>
    new AutomationUnitFetchFailure({ code: "database", cause });
  const evaluationFailure = (cause: CampaignRecipientResolutionError) =>
    new AutomationUnitFetchFailure({ code: "evaluation", cause });

  /** Reads the running dry run, its working copy and its events in one snapshot. */
  const loadJob = (subject: PreviewUnitSubject) =>
    transaction(
      selectPreview(subject.previewId).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.succeed<LoadedPreviewJob>(PreviewUnitFetch.Closed()),
            onSome: (preview) =>
              preview.status !== "running"
                ? Effect.succeed<LoadedPreviewJob>(PreviewUnitFetch.Closed())
                : loadCurrentJob(preview, subject.customerIds),
          })
        )
      )
    ).pipe(Effect.mapError(databaseFailure));

  const loadCurrentJob = (
    preview: AutomationPreviewRow,
    customers: readonly DotyposCustomerId[]
  ) =>
    workingCopyOf(preview).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(PreviewUnitFetch.Changed()),
          onSome: (copy) =>
            Option.match(replayEventScope(copy.flow.trigger, preview), {
              onNone: (): Effect.Effect<
                readonly ReplayEvent[],
                DatabaseQueryError
              > => Effect.succeed([]),
              onSome: (scope) => selectReplayEvents(scope, customers),
            }).pipe(
              Effect.map(
                (events): LoadedPreviewJob => ({
                  _tag: "Ready",
                  job: { ...copy, preview, events },
                })
              )
            ),
        })
      )
    );

  const withVisits = <A, E>(
    read: (visits: ReservationVisits["Service"]) => Effect.Effect<A, E>
  ) =>
    Effect.flatMap(ReservationVisits, read).pipe(
      Effect.provide(ReservationVisits.Default),
      Effect.provideContext(context)
    );

  /**
   * Plans and fetches the unit's facts for the entry audience and every
   * condition step, with each referenced saved audience as it is now (D32).
   * A saved audience edited since the dry run was planned may need more
   * requests than the unit's cost; the fetch proceeds, bounded by the
   * deadline.
   */
  const fetchFacts = (input: {
    readonly job: PreviewJob;
    readonly customers: readonly DotyposCustomerId[];
    readonly context: AudienceEvaluationContext;
    readonly reachability: boolean;
  }) =>
    Effect.Do.pipe(
      Effect.bind("plan", () =>
        facts.plan({
          filters: {
            entryAudience: input.job.audienceFilter,
            reachability: input.reachability,
            ...Option.match(conditionFilterOf(input.job.flow), {
              onNone: () => ({}),
              onSome: (condition) => ({ condition }),
            }),
          },
          context: input.context,
        })
      ),
      Effect.bind("source", ({ plan }) =>
        facts.fetch({ reads: plan.reads, customers: input.customers })
      )
    );

  const evaluateCondition = (input: {
    readonly condition: AutomationConditionFilter;
    readonly plan: AutomationEvaluationPlan;
    readonly customers: readonly DotyposCustomerId[];
    readonly context: AudienceEvaluationContext;
    readonly source: AudienceFactSource;
  }) =>
    conditions
      .evaluate({
        condition: input.condition,
        plan: input.plan,
        customers: input.customers,
        context: input.context,
        facts: input.source,
      })
      .pipe(
        Effect.catchTag(
          "CampaignRecipientResolutionError",
          (cause): Effect.Effect<never, AutomationUnitFetchFailure> =>
            Effect.fail(evaluationFailure(cause))
        )
      );

  /** Customers the entry audience admits, reachable or not (§5.6). */
  const audienceMembers = (input: {
    readonly job: PreviewJob;
    readonly filter: AudienceFilter;
    readonly customers: readonly DotyposCustomerId[];
    readonly context: AudienceEvaluationContext;
    readonly source: AudienceFactSource;
    readonly reachableOnly: boolean;
  }) =>
    recipients
      .resolve({
        purpose: input.job.purpose,
        filter: input.filter,
        scope: AudienceScope.Customers({ ids: input.customers }),
        context: input.context,
        facts: input.source,
      })
      .pipe(
        Effect.map(
          ({ recipients: reachable, exclusions, duplicates }) =>
            new Set<DotyposCustomerId>([
              ...reachable.map(({ dotyposCustomerId }) => dotyposCustomerId),
              ...(input.reachableOnly
                ? []
                : [
                    ...exclusions.map(
                      ({ dotyposCustomerId }) => dotyposCustomerId
                    ),
                    ...duplicates.flatMap(
                      ({ duplicateCustomerIds }) => duplicateCustomerIds
                    ),
                  ]),
            ])
        ),
        Effect.mapError(evaluationFailure)
      );

  /**
   * A schedule's entrants at its next fire `F` (design §8.1): the pool
   * chunk evaluated like a fire chunk, with the same reachability
   * exclusions and per-chunk email dedup, then simulated from `F` with
   * conditions on facts as they are now.
   */
  const evaluateScheduleFire = (
    job: PreviewJob,
    customers: readonly DotyposCustomerId[]
  ) => {
    const fireAt = job.preview.asOf;
    const contextAt = (now: Temporal.Instant): AudienceEvaluationContext => ({
      now,
      campaignId: Option.some(job.preview.campaignId),
      trigger: Option.some({
        kind: "schedule",
        at: fireAt,
        reservationId: Option.none(),
      }),
    });
    const row = (
      customerId: DotyposCustomerId,
      outcome: Omit<AutomationPreviewOutcomeRow, "dotyposCustomerId">
    ): AutomationPreviewOutcomeRow => ({
      dotyposCustomerId: customerId,
      ...outcome,
    });
    const entryRow = (
      outcome: "not-in-audience" | "already-active" | "unavailable"
    ) => ({
      triggerAt: fireAt,
      customerEventId: null,
      outcome,
      stepId: null,
      sendAt: null,
      projected: false,
    });

    return Effect.Do.pipe(
      Effect.bind("planned", () =>
        currentInstant.pipe(
          Effect.flatMap((now) =>
            fetchFacts({
              job,
              customers,
              context: contextAt(now),
              reachability: true,
            })
          )
        )
      ),
      Effect.bind("now", () => currentInstant),
      Effect.bind("members", ({ planned, now }) =>
        audienceMembers({
          job,
          filter: job.audienceFilter,
          customers,
          context: contextAt(now),
          source: planned.source,
          reachableOnly: true,
        })
      ),
      Effect.bind("active", ({ members }) =>
        openRunCustomers(job.preview.campaignId, [...members])
      ),
      Effect.let("entrants", ({ members, active }) =>
        customers.filter((id) => members.has(id) && !active.has(id))
      ),
      Effect.bind("decisions", ({ planned, now, entrants }) =>
        Effect.forEach(conditionStepsOf(job.flow), (step) =>
          evaluateCondition({
            condition: step.filter,
            plan: planned.plan,
            customers: entrants,
            context: contextAt(now),
            source: planned.source,
          }).pipe(Effect.map((decided) => [step.id, decided] as const))
        ).pipe(Effect.map((entries) => new Map(entries)))
      ),
      Effect.flatMap(({ now, members, active, decisions }) =>
        Effect.forEach(customers, (customerId) => {
          if (!members.has(customerId)) {
            return Effect.succeed(row(customerId, entryRow("not-in-audience")));
          }
          if (active.has(customerId)) {
            return Effect.succeed(row(customerId, entryRow("already-active")));
          }
          return simulateRun({
            steps: job.flow.steps,
            triggerAt: fireAt,
            evaluateCondition: (step) =>
              Effect.succeed<AudienceFilterOutcome>(
                decisions.get(step.id)?.get(customerId)?.outcome ?? "unknown"
              ),
          }).pipe(
            Effect.map((end) =>
              row(customerId, {
                triggerAt: fireAt,
                customerEventId: null,
                outcome: end.outcome,
                stepId: end.stepId,
                sendAt: end.outcome === "would-send" ? end.at : null,
                projected: Temporal.Instant.compare(end.at, now) > 0,
              })
            )
          );
        })
      ),
      Effect.catchTag("AutomationConditionAudienceMissing", () =>
        Effect.succeed(
          customers.map((customerId) =>
            row(customerId, entryRow("unavailable"))
          )
        )
      )
    );
  };

  /**
   * An event trigger's 30-day replay for the unit's customers (design
   * §8.2): each customer's events in time order with per-customer overlays
   * only, so units are independent.
   */
  const evaluateReplay = (
    job: PreviewJob,
    customers: readonly DotyposCustomerId[]
  ) => {
    const kind = automationTriggerKind(job.flow.trigger);
    const reservationIds = [
      ...new Set(
        job.events.flatMap(({ workspaceReservationId }) =>
          workspaceReservationId === null ? [] : [workspaceReservationId]
        )
      ),
    ];
    const contextOf = (
      event: ReplayEvent,
      now: Temporal.Instant
    ): AudienceEvaluationContext => ({
      now,
      campaignId: Option.some(job.preview.campaignId),
      trigger: Option.some({
        kind,
        at: event.occurredAt,
        reservationId: Option.fromNullishOr(event.workspaceReservationId),
      }),
      replayed: true,
    });

    return Effect.Do.pipe(
      Effect.bind("planned", () =>
        currentInstant.pipe(
          Effect.flatMap((now) =>
            fetchFacts({
              job,
              customers,
              context: {
                now,
                campaignId: Option.some(job.preview.campaignId),
                trigger: Option.some({
                  kind,
                  at: now,
                  reservationId: Option.none(),
                }),
              },
              reachability: false,
            })
          )
        )
      ),
      Effect.bind("visits", () =>
        readsTriggeringVisit(kind) && reservationIds.length > 0
          ? withVisits((visits) => visits.ofReservations(reservationIds)).pipe(
              Effect.mapError(AutomationUnitFetchFailure.fromReservationVisits)
            )
          : Effect.succeed(
              new Map<WorkspaceReservationId, Option.Option<ReservationVisit>>()
            )
      ),
      Effect.bind("cancellations", () =>
        workspaceCancellations(reservationIds)
      ),
      Effect.bind("undatedChanges", ({ planned }) =>
        undatedStatusChanges(planned.plan, customers)
      ),
      Effect.bind("now", () => currentInstant),
      Effect.flatMap(
        ({ planned, visits, cancellations, undatedChanges, now }) => {
          const replay = (
            event: ReplayEvent,
            simulatedSends: readonly Temporal.Instant[]
          ): Effect.Effect<
            ReplayedEvent,
            AutomationUnitFetchFailure | AutomationConditionAudienceMissing
          > => {
            const rechecked = recheck({ kind, event, visits, cancellations });
            if (Option.isSome(rechecked))
              return Effect.succeed(rechecked.value);
            const entryContext = contextOf(event, event.occurredAt);
            return audienceMembers({
              job,
              filter: replayedFilter(job.audienceFilter, {
                context: entryContext,
                purpose: job.purpose,
                simulatedSends,
              }),
              customers: [event.dotyposCustomerId],
              context: entryContext,
              source: planned.source,
              reachableOnly: false,
            }).pipe(
              Effect.flatMap((members) =>
                members.has(event.dotyposCustomerId)
                  ? simulateEntered(event, simulatedSends)
                  : Effect.succeed<ReplayedEvent>({ _tag: "NotInAudience" })
              )
            );
          };

          const simulateEntered = (
            event: ReplayEvent,
            simulatedSends: readonly Temporal.Instant[]
          ) =>
            simulateRun({
              steps: job.flow.steps,
              triggerAt: event.occurredAt,
              evaluateCondition: (step, at) => {
                // Conditions use facts as of the step, or now once it's past.
                const evaluatedAt =
                  Temporal.Instant.compare(at, now) > 0 ? now : at;
                const conditionContext = contextOf(event, evaluatedAt);
                return evaluateCondition({
                  condition: replayedFilter(step.filter, {
                    context: conditionContext,
                    purpose: job.purpose,
                    simulatedSends,
                  }),
                  plan: planned.plan,
                  customers: [event.dotyposCustomerId],
                  context: conditionContext,
                  source: planned.source,
                }).pipe(
                  Effect.map(
                    (decided): AudienceFilterOutcome =>
                      decided.get(event.dotyposCustomerId)?.outcome ?? "unknown"
                  ),
                  Effect.catchTag("AutomationConditionAudienceMissing", () =>
                    Effect.fail(
                      new PreviewConditionUnavailable({ stepId: step.id, at })
                    )
                  )
                );
              },
            }).pipe(
              Effect.map((end) =>
                preSubmit({ kind, event, end, cancellations })
              ),
              Effect.catchTag("PreviewConditionUnavailable", ({ stepId, at }) =>
                Effect.succeed<ReplayedEvent>({
                  _tag: "Entered",
                  end: { outcome: "unavailable", stepId, at },
                })
              )
            );

          const byCustomer = Map.groupBy(
            job.events,
            ({ dotyposCustomerId }) => dotyposCustomerId
          );
          const sendsContext = {
            context: {
              now,
              campaignId: Option.some(job.preview.campaignId),
              trigger: Option.none(),
            },
            purpose: job.purpose,
          };
          const countsSimulatedSends = [
            job.audienceFilter,
            ...conditionStepsOf(job.flow).map(({ filter }) => filter),
          ].some((filter) => countsSimulatedSendsIn(filter, sendsContext));
          return Effect.forEach(customers, (customerId) =>
            replayCustomerEvents({
              events: byCustomer.get(customerId) ?? [],
              occurredAt: ({ occurredAt }) => occurredAt,
              now,
              steps: job.flow.steps,
              approximation: {
                undatedChangeAt: Option.fromUndefinedOr(
                  undatedChanges.get(customerId)
                ),
                countsSimulatedSends,
              },
              replay,
            }).pipe(
              Effect.map((replayed) =>
                replayed.map(
                  ({
                    event,
                    outcome,
                    reservationStatusesApproximate,
                  }): AutomationPreviewOutcomeRow => ({
                    ...outcome,
                    dotyposCustomerId: event.dotyposCustomerId,
                    customerEventId: event.id,
                    reservationStatusesApproximate,
                  })
                )
              )
            )
          ).pipe(Effect.map((rows) => rows.flat()));
        }
      ),
      Effect.catchTag("AutomationConditionAudienceMissing", () =>
        Effect.succeed(unavailableRows(job, customers))
      )
    );
  };

  /**
   * Per customer, their latest reservation status change the stored
   * timestamps can't date, for the statuses the plan reads: replayed
   * evaluations before it read those statuses approximately (design §8.2).
   */
  const undatedStatusChanges = (
    plan: AutomationEvaluationPlan,
    customers: readonly DotyposCustomerId[]
  ) => {
    const statuses = audienceReservationStatusesOf(plan.factFilter);
    return statuses.size === 0
      ? Effect.succeed(new Map<DotyposCustomerId, Temporal.Instant>())
      : candidates
          .undatedStatusChanges({ statuses, customers })
          .pipe(Effect.mapError(databaseFailure));
  };

  /** Live runs of the campaign: a customer in one is `already-active` at a fire (D4). */
  const openRunCustomers = (
    campaignId: CampaignId,
    customers: readonly DotyposCustomerId[]
  ): Effect.Effect<
    ReadonlySet<DotyposCustomerId>,
    AutomationUnitFetchFailure
  > =>
    customers.length === 0
      ? Effect.succeed(new Set<DotyposCustomerId>())
      : db
          .selectDistinct({ customerId: runs.dotyposCustomerId })
          .from(runs)
          .where(
            and(
              eq(runs.campaignId, campaignId),
              inArray(runs.dotyposCustomerId, [...customers]),
              ne(runs.status, "ended")
            )
          )
          .pipe(
            Effect.map(
              (rows): ReadonlySet<DotyposCustomerId> =>
                new Set(rows.map(({ customerId }) => customerId))
            ),
            Effect.mapError(databaseFailure)
          );

  /** When Workspace cancelled each reservation, for the pre-submit check. */
  const workspaceCancellations = (
    reservationIds: readonly WorkspaceReservationId[]
  ): Effect.Effect<
    ReadonlyMap<WorkspaceReservationId, Temporal.Instant>,
    AutomationUnitFetchFailure
  > =>
    reservationIds.length === 0
      ? Effect.succeed(new Map<WorkspaceReservationId, Temporal.Instant>())
      : db
          .select({
            id: workspaceReservations.id,
            cancelledAt: workspaceReservations.reservationCancelledAt,
          })
          .from(workspaceReservations)
          .where(inArray(workspaceReservations.id, [...reservationIds]))
          .pipe(
            Effect.map(
              (rows): ReadonlyMap<WorkspaceReservationId, Temporal.Instant> =>
                new Map(
                  rows.flatMap(({ id, cancelledAt }) =>
                    cancelledAt === null ? [] : [[id, cancelledAt] as const]
                  )
                )
            ),
            Effect.mapError(databaseFailure)
          );

  const evaluators = {
    schedule: evaluateScheduleFire,
    replay: evaluateReplay,
  } as const;

  /** A solo unit that kept missing its deadline reports its customers unavailable. */
  const evaluateUnit = (
    job: PreviewJob,
    unit: ClaimedAutomationUnit<PreviewUnitSubject>
  ) =>
    unit.deadlineMisses >= unavailableAfterDeadlineMisses
      ? Effect.succeed(unavailableRows(job, unit.subject.customerIds))
      : evaluators[job.preview.kind](job, unit.subject.customerIds);

  const handler: AutomationUnitHandler<PreviewUnitSubject, PreviewUnitFetch> = {
    kind: "preview",
    subject: previewUnitSubjectSchema,
    fetch: (unit) =>
      loadJob(unit.subject).pipe(
        Effect.flatMap(
          (
            loaded
          ): Effect.Effect<PreviewUnitFetch, AutomationUnitFetchFailure> =>
            Match.value(loaded).pipe(
              Match.tagsExhaustive({
                Closed: (closed) => Effect.succeed(closed),
                Changed: (changed) => Effect.succeed(changed),
                Ready: ({ job }) =>
                  evaluateUnit(job, unit).pipe(
                    Effect.map((rows) => PreviewUnitFetch.Evaluated({ rows }))
                  ),
              })
            )
        )
      ),
    commit: (unit, fetched, at) =>
      lockPreview(unit.subject.previewId).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.void,
            onSome: (preview) =>
              PreviewUnitFetch.$match(fetched, {
                Closed: () => Effect.void,
                Changed: () => supersede({ preview, unitId: unit.id, at }),
                Evaluated: ({ rows }) =>
                  workingCopyOf(preview).pipe(
                    Effect.flatMap(
                      Option.match({
                        onNone: () =>
                          supersede({ preview, unitId: unit.id, at }),
                        onSome: () =>
                          recordPreviewUnit({
                            previewId: preview.id,
                            rows,
                            at,
                          }),
                      })
                    )
                  ),
              }),
          })
        ),
        Effect.as([])
      ),
  };

  return registerAutomationUnitHandler(handler);
});

const selectPreview = (previewId: AutomationPreviewId) =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    db
      .select()
      .from(previews)
      .where(eq(previews.id, previewId))
      .pipe(Effect.map(([preview]) => Option.fromUndefinedOr(preview)))
  );

/** The running dry run, locked against a concurrent supersede (§8). */
const lockPreview = (previewId: AutomationPreviewId) =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    db
      .select()
      .from(previews)
      .where(and(eq(previews.id, previewId), eq(previews.status, "running")))
      .for("update")
      .pipe(Effect.map(([preview]) => Option.fromUndefinedOr(preview)))
  );

const supersede = (input: {
  readonly preview: AutomationPreviewRow;
  readonly unitId: AutomationWorkUnitId;
  readonly at: Temporal.Instant;
}) =>
  closePreview({
    previewId: input.preview.id,
    status: "superseded",
    at: input.at,
    committingUnit: input.unitId,
  }).pipe(Effect.asVoid);

/**
 * The working copy the dry run evaluates, or none once it has changed: a
 * different draft hash, or a campaign whose flow or audience no longer
 * loads.
 */
const workingCopyOf = (
  preview: AutomationPreviewRow
): Effect.Effect<
  Option.Option<Omit<PreviewJob, "preview" | "events">>,
  DatabaseQueryError,
  WorkspaceTransaction
> =>
  loadAutomationWorkingCopy(preview.campaignId).pipe(
    Effect.map((copy) =>
      Option.filter(
        Option.all({
          flow: copy.flow,
          audience: copy.audience,
          draftHash: copy.draftHash,
        }),
        ({ draftHash }) => draftHash === preview.draftHash
      ).pipe(
        Option.map(({ flow, audience }) => ({
          flow,
          audienceFilter: audience.filter,
          purpose: copy.campaign.purpose,
        }))
      )
    ),
    Effect.catchTags({
      CampaignNotFound: () => Effect.succeed(Option.none()),
      CampaignDeliveryMismatch: () => Effect.succeed(Option.none()),
      AutomationFlowInvalid: () => Effect.succeed(Option.none()),
    })
  );

type ConditionStep = Extract<AutomationStep, { readonly _tag: "Condition" }>;

const conditionStepsOf = (flow: AutomationFlow): readonly ConditionStep[] =>
  flow.steps.filter((step): step is ConditionStep => step._tag === "Condition");

/** Every condition step's filter, so one fact plan serves them all. */
export const conditionFilterOf = (
  flow: AutomationFlow
): Option.Option<AutomationConditionFilter> => {
  const steps = conditionStepsOf(flow);
  return steps.length === 0
    ? Option.none()
    : Option.some({
        _tag: "Group",
        operator: "and",
        filters: steps.map(({ filter }) => filter),
      });
};

/**
 * Intake's live re-check of the triggering visit (§5.6), as of the event
 * and at stored precision: a withdrawn trigger withdraws the event, and a
 * moved one is superseded and hidden, because the sweep records the moved
 * visit as a later event. A reservation Workspace cancelled is left to the
 * pre-submit check, which knows when. None when the event stands.
 */
const recheck = (input: {
  readonly kind: AutomationTriggerKind;
  readonly event: ReplayEvent;
  readonly visits: ReadonlyMap<
    WorkspaceReservationId,
    Option.Option<ReservationVisit>
  >;
  readonly cancellations: ReadonlyMap<WorkspaceReservationId, Temporal.Instant>;
}): Option.Option<ReplayedEvent> => {
  const reservationId = input.event.workspaceReservationId;
  if (reservationId === null || input.cancellations.has(reservationId)) {
    return Option.none();
  }
  const verdict = triggeringVisitVerdict({
    kind: input.kind,
    visit: Option.flatten(
      Option.fromUndefinedOr(input.visits.get(reservationId))
    ).pipe(
      Option.map((visit) => ({
        ...visit,
        startsAt: toStoredInstant(visit.startsAt),
        endsAt: toStoredInstant(visit.endsAt),
      }))
    ),
    asOf: toStoredInstant(input.event.occurredAt),
  });
  return Match.value(verdict).pipe(
    Match.when("current", () => Option.none<ReplayedEvent>()),
    Match.when("withdrawn", () =>
      Option.some<ReplayedEvent>({
        _tag: "Withdrawn",
        stepId: Option.none(),
        at: Option.none(),
      })
    ),
    Match.when("moved", () => Option.some<ReplayedEvent>({ _tag: "Hidden" })),
    Match.exhaustive
  );
};

/**
 * The deliver unit's pre-submit check (§5.9): a reservation Workspace
 * cancelled before the send instant withdraws the run then (D28); one
 * cancelled after it was already sent. Runs a cancellation triggered are
 * never withdrawn.
 */
const preSubmit = (input: {
  readonly kind: AutomationTriggerKind;
  readonly event: ReplayEvent;
  readonly end: Extract<ReplayedEvent, { _tag: "Entered" }>["end"];
  readonly cancellations: ReadonlyMap<WorkspaceReservationId, Temporal.Instant>;
}): ReplayedEvent => {
  const cancelledAt = Option.fromNullishOr(
    input.event.workspaceReservationId === null ||
      !withdrawnByCancellation(input.kind)
      ? undefined
      : input.cancellations.get(input.event.workspaceReservationId)
  ).pipe(Option.filter((at) => Temporal.Instant.compare(at, input.end.at) < 0));
  return Option.match(cancelledAt, {
    onNone: () => ({ _tag: "Entered", end: input.end }),
    onSome: (at) => ({
      _tag: "Withdrawn",
      stepId: Option.some(input.end.stepId),
      // On the engine tick that takes the cancellation in.
      at: Option.some(
        automationTickAtOrAfter(
          Temporal.Instant.compare(at, input.event.occurredAt) > 0
            ? at
            : input.event.occurredAt
        )
      ),
    }),
  });
};

/** Rows for customers whose facts can't be read: a schedule's at `F`, a replay's per event. */
const unavailableRows = (
  job: PreviewJob,
  customers: readonly DotyposCustomerId[]
): readonly AutomationPreviewOutcomeRow[] => {
  const unavailable = {
    outcome: "unavailable",
    stepId: null,
    sendAt: null,
    projected: false,
  } as const;
  return job.preview.kind === "schedule"
    ? customers.map((dotyposCustomerId) => ({
        ...unavailable,
        dotyposCustomerId,
        triggerAt: job.preview.asOf,
        customerEventId: null,
      }))
    : job.events.map((event) => ({
        ...unavailable,
        dotyposCustomerId: event.dotyposCustomerId,
        triggerAt: event.occurredAt,
        customerEventId: event.id,
      }));
};
