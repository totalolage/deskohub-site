import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposService,
  dotyposIdReadRequests,
} from "@deskohub/dotypos";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Array as Arr, Effect, Match, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  emailCampaignSends,
  emailCampaignAutomationRuns as runs,
  emailCampaignAutomationWorkUnits as units,
  emailCampaignAutomationVersions as versions,
} from "@/db/schema";
import { isDatabaseQueryError } from "@/db/sql-constraint";
import type { Locale } from "@/features/i18n";
import {
  type ReservationVisit,
  ReservationVisits,
} from "@/features/reservation/backend/reservation-visits.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { temporalInstantToIsoString } from "@/shared/utils/temporal";
import { CampaignCandidateRepository } from "../../backend/campaign-candidate.repository";
import { CampaignDeliveryService } from "../../backend/campaign-delivery.service";
import type { CampaignId, CampaignSendId } from "../../campaign-identifiers";
import {
  campaignFallbackLocale,
  resolveRecipientLocale,
} from "../../recipient-locale";
import { automationFlowSchema } from "../automation-flow";
import {
  type AutomationRunId,
  type AutomationStepId,
  type AutomationVersionId,
  type AutomationWorkUnitId,
  automationRunIdSchema,
  automationVersionIdSchema,
} from "../automation-identifiers";
import type { AutomationTriggerKind } from "../automation-states";
import { automationTickAtOrBefore } from "../automation-ticks";
import {
  readsTriggeringVisit,
  triggeringVisitVerdict,
  withdrawnByCancellation,
} from "../automation-trigger-verification";
import { lockAutomationForEngine } from "./automation-lifecycle-lock";
import { appendAutomationRunProgress } from "./automation-run-timeline";
import { AutomationRunTransitions } from "./automation-run-transitions";
import { lockTriggeringReservations } from "./automation-triggering-reservations";
import {
  AutomationUnitFetchFailure,
  type AutomationUnitHandler,
  AutomationUnitRecheckFailed,
  type ClaimedAutomationUnit,
  type PlannedAutomationUnit,
  registerAutomationUnitHandler,
} from "./automation-unit-handler";

/** A deliver unit holds at most this many runs of one version (§1.2.13). */
export const deliverUnitRunLimit = 100;

/**
 * A deferred run is verified live again this long after the tick that
 * deferred it (§5.9), however late in that tick its unit committed.
 */
const deferredRecheck = { minutes: 15 } as const;

const deliverSubjectSchema = Schema.Struct({
  versionId: automationVersionIdSchema,
  runIds: Schema.Array(automationRunIdSchema).check(
    Schema.isMaxLength(deliverUnitRunLimit)
  ),
});
type DeliverSubject = typeof deliverSubjectSchema.Type;

/**
 * The deliver unit of send-ready runs of one version. Its key is unique per
 * planning, so runs a settled unit released are planned afresh.
 */
export const plannedDeliverUnit = (input: {
  readonly campaignId: CampaignId;
  readonly versionId: AutomationVersionId;
  readonly runIds: readonly AutomationRunId[];
  /** Triggering reservations to verify. */
  readonly reservations: number;
  readonly customers: number;
  readonly at: Temporal.Instant;
}): PlannedAutomationUnit => ({
  kind: "deliver",
  key: `deliver:${input.versionId}:${temporalInstantToIsoString(input.at)}:${input.runIds[0]}`,
  campaignId: input.campaignId,
  subject: Schema.encodeSync(deliverSubjectSchema)({
    versionId: input.versionId,
    runIds: input.runIds,
  }),
  requestCost: deliverRequestCost(input),
});

/**
 * The unit's Dotypos requests: one reservation page per 100 triggering
 * reservations, and one profile page per 100 customers for the recheck.
 */
const deliverRequestCost = (input: {
  readonly reservations: number;
  readonly customers: number;
}) =>
  dotyposIdReadRequests(input.reservations) +
  dotyposIdReadRequests(input.customers);

type DeliverRun = {
  readonly id: AutomationRunId;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly triggerKind: AutomationTriggerKind;
  readonly triggerReservationId: WorkspaceReservationId | null;
};

/** What a deliver unit read live, outside any transaction (§5.9 step 1). */
type DeliverFacts = {
  readonly campaignId: CampaignId;
  /** None when the version's flow no longer decodes or has no send. */
  readonly sendStepId: Option.Option<AutomationStepId>;
  readonly runs: readonly DeliverRun[];
  readonly visits: ReadonlyMap<
    WorkspaceReservationId,
    Option.Option<ReservationVisit>
  >;
  readonly profiles: ReadonlyMap<DotyposCustomerId, DotyposCustomer>;
  readonly locales: ReadonlyMap<DotyposCustomerId, Locale>;
};

const decodeFlow = Schema.decodeUnknownOption(automationFlowSchema);

/**
 * Verifies, persists, submits and settles one batch of send-ready runs in
 * one invocation (§5.9), so no batch reaches the provider on an older
 * verification. Once its commit sets the unit's `send_id`, the unit is the
 * batch's only way to settle and replays it until it does.
 */
export const makeDeliverHandler = Effect.gen(function* () {
  const { db } = yield* WorkspaceDatabase;
  const dotypos = yield* DotyposService;
  const candidates = yield* CampaignCandidateRepository;
  const delivery = yield* CampaignDeliveryService;
  const context = yield* Effect.context<WorkspaceDatabase | DotyposService>();

  /** The unit's runs still open at their send step and owned by it. */
  const loadRuns = (unit: ClaimedAutomationUnit<DeliverSubject>) =>
    db
      .select({
        id: runs.id,
        dotyposCustomerId: runs.dotyposCustomerId,
        triggerKind: runs.triggerKind,
        triggerReservationId: runs.triggerReservationId,
      })
      .from(runs)
      .where(
        and(
          inArray(runs.id, [...unit.subject.runIds]),
          eq(runs.versionId, unit.subject.versionId),
          eq(runs.workUnitId, unit.id),
          eq(runs.status, "active"),
          eq(runs.phase, "ready")
        )
      )
      .orderBy(asc(runs.id));

  const loadVersion = (versionId: AutomationVersionId) =>
    db
      .select({
        campaignId: versions.campaignId,
        purpose: versions.purpose,
        flow: versions.flow,
      })
      .from(versions)
      .where(eq(versions.id, versionId))
      .pipe(Effect.map(([version]) => Option.fromNullishOr(version)));

  const readVisits = (open: readonly DeliverRun[]) =>
    Effect.flatMap(ReservationVisits, (visits) =>
      visits.ofReservations(
        open.flatMap((run) =>
          run.triggerReservationId !== null &&
          readsTriggeringVisit(run.triggerKind)
            ? [run.triggerReservationId]
            : []
        )
      )
    ).pipe(
      Effect.provide(ReservationVisits.Default),
      Effect.provideContext(context),
      Effect.mapError(AutomationUnitFetchFailure.fromReservationVisits)
    );

  // One page at a time: a unit's requests are sequential (§5.3).
  const readProfiles = (customerIds: readonly DotyposCustomerId[]) =>
    dotypos
      .getCustomersByIds(customerIds, { concurrency: 1 })
      .pipe(Effect.mapError(AutomationUnitFetchFailure.fromDotypos));

  const fetch = (unit: ClaimedAutomationUnit<DeliverSubject>) =>
    Effect.Do.pipe(
      Effect.bind("version", () =>
        loadVersion(unit.subject.versionId).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  new AutomationUnitFetchFailure({ code: "version-missing" })
                ),
              onSome: Effect.succeed,
            })
          )
        )
      ),
      Effect.bind("runs", () => loadRuns(unit)),
      Effect.let("customerIds", ({ runs: open }) =>
        open.map((run) => run.dotyposCustomerId)
      ),
      Effect.bind("visits", ({ runs: open }) => readVisits(open)),
      Effect.bind("profiles", ({ customerIds }) => readProfiles(customerIds)),
      Effect.bind("locales", ({ version, customerIds }) =>
        candidates
          .listCandidates({ purpose: version.purpose, ids: customerIds })
          .pipe(
            Effect.map(
              (facts) =>
                new Map(
                  facts.map((fact) => [
                    fact.dotyposCustomerId,
                    resolveRecipientLocale(fact),
                  ])
                )
            )
          )
      ),
      Effect.map(
        ({ version, runs: open, visits, profiles, locales }): DeliverFacts => ({
          campaignId: version.campaignId,
          sendStepId: Option.flatMap(decodeFlow(version.flow), (flow) =>
            Option.fromNullishOr(
              flow.steps.find((step) => step._tag === "Send")?.id
            )
          ),
          runs: open,
          visits,
          profiles,
          locales,
        })
      ),
      Effect.catchIf(isDatabaseQueryError, (cause) =>
        Effect.fail(new AutomationUnitFetchFailure({ code: "database", cause }))
      )
    );

  const commit = (
    unit: ClaimedAutomationUnit<DeliverSubject>,
    facts: DeliverFacts,
    at: Temporal.Instant
  ) =>
    lockAutomationForEngine(facts.campaignId).pipe(
      Effect.filterOrFail(
        (lifecycle) => lifecycle.status === "active",
        (lifecycle) =>
          new AutomationUnitRecheckFailed({
            code: `automation-${lifecycle.status ?? "missing"}`,
          })
      ),
      Effect.andThen(
        Option.match(facts.sendStepId, {
          onNone: () => failUndeliverable(unit, facts, at).pipe(Effect.asVoid),
          onSome: (sendStepId) =>
            persist({ unit, facts, sendStepId, at }).pipe(Effect.asVoid),
        })
      ),
      Effect.as<ReadonlyArray<PlannedAutomationUnit>>([])
    );

  /** A flow that no longer decodes can't send: its runs end failed. */
  const failUndeliverable = (
    unit: ClaimedAutomationUnit<DeliverSubject>,
    facts: DeliverFacts,
    at: Temporal.Instant
  ) =>
    AutomationRunTransitions.end({
      runIds: facts.runs.map((run) => run.id),
      expect: { status: "active", phase: "ready", workUnitId: unit.id },
      outcome: "failed",
      reason: "evaluation-unavailable",
      at,
    });

  /**
   * §5.9 step 2: under the lifecycle lock and the triggering reservations'
   * share locks, ends withdrawn runs, defers runs whose trigger moved later,
   * and persists the rest as one send with batch 0, recording the send on
   * the unit.
   */
  const persist = (input: {
    readonly unit: ClaimedAutomationUnit<DeliverSubject>;
    readonly facts: DeliverFacts;
    readonly sendStepId: AutomationStepId;
    readonly at: Temporal.Instant;
  }) =>
    Effect.Do.pipe(
      Effect.bind("cancelled", () =>
        lockTriggeringReservations(
          input.facts.runs.map((run) => run.triggerReservationId)
        )
      ),
      Effect.let("verdicts", ({ cancelled }) =>
        Arr.groupBy(input.facts.runs, (run) =>
          verdictOf({ run, facts: input.facts, cancelled, at: input.at })
        )
      ),
      Effect.let(
        "expect",
        () =>
          ({
            status: "active",
            stepId: input.sendStepId,
            phase: "ready",
            workUnitId: input.unit.id,
          }) as const
      ),
      Effect.tap(({ verdicts, expect }) =>
        AutomationRunTransitions.end({
          runIds: (verdicts.withdraw ?? []).map((run) => run.id),
          expect,
          outcome: "withdrawn",
          at: input.at,
        }).pipe(Effect.when(Effect.succeed(verdicts.withdraw !== undefined)))
      ),
      Effect.tap(({ verdicts }) =>
        defer({ ...input, deferred: verdicts.defer ?? [] }).pipe(
          Effect.when(Effect.succeed(verdicts.defer !== undefined))
        )
      ),
      Effect.tap(({ verdicts }) =>
        persistSend({ ...input, sendable: verdicts.send ?? [] }).pipe(
          Effect.when(Effect.succeed(verdicts.send !== undefined))
        )
      )
    );

  const defer = (input: {
    readonly unit: ClaimedAutomationUnit<DeliverSubject>;
    readonly sendStepId: AutomationStepId;
    readonly deferred: readonly DeliverRun[];
    readonly at: Temporal.Instant;
  }) => {
    const recheckAt = automationTickAtOrBefore(input.at).add(deferredRecheck);
    return db
      .update(runs)
      .set({
        phase: "waiting",
        dueAt: recheckAt,
        workUnitId: null,
        updatedAt: input.at,
      })
      .where(
        and(
          inArray(
            runs.id,
            input.deferred.map((run) => run.id)
          ),
          eq(runs.status, "active"),
          eq(runs.stepId, input.sendStepId),
          eq(runs.phase, "ready"),
          eq(runs.workUnitId, input.unit.id)
        )
      )
      .returning({ id: runs.id })
      .pipe(
        Effect.flatMap((deferred) =>
          appendAutomationRunProgress(
            deferred.map(({ id }) => ({
              runId: id,
              kind: "deferred" as const,
              stepId: input.sendStepId,
              at: input.at,
              detail: {
                cause: "trigger-not-reached" as const,
                recheckAt: temporalInstantToIsoString(recheckAt),
              },
            }))
          ).pipe(Effect.when(Effect.succeed(deferred.length > 0)))
        )
      );
  };

  /**
   * Creates the send, moves the runs to `sending` and freezes their
   * recipients from the runs that moved, then persists batch 0 and records
   * the send on the unit, all before any request.
   */
  const persistSend = (input: {
    readonly unit: ClaimedAutomationUnit<DeliverSubject>;
    readonly facts: DeliverFacts;
    readonly sendStepId: AutomationStepId;
    readonly sendable: readonly DeliverRun[];
    readonly at: Temporal.Instant;
  }) =>
    delivery
      .createAutomatedSend({
        campaignId: input.facts.campaignId,
        versionId: input.unit.subject.versionId,
        at: input.at,
      })
      .pipe(
        Effect.bindTo("sendId"),
        Effect.bind("sending", ({ sendId }) =>
          db
            .update(runs)
            .set({
              status: "sending",
              phase: null,
              dueAt: null,
              sendId,
              updatedAt: input.at,
            })
            .where(
              and(
                inArray(
                  runs.id,
                  input.sendable.map((run) => run.id)
                ),
                eq(runs.status, "active"),
                eq(runs.stepId, input.sendStepId),
                eq(runs.phase, "ready"),
                eq(runs.workUnitId, input.unit.id)
              )
            )
            .returning({
              id: runs.id,
              dotyposCustomerId: runs.dotyposCustomerId,
            })
        ),
        Effect.tap(({ sendId, sending }) =>
          sending.length === 0
            ? // No run moved (only possible for a commit about to lose its
              // claim): the empty send goes.
              db
                .delete(emailCampaignSends)
                .where(eq(emailCampaignSends.id, sendId))
            : delivery
                .persistAutomatedBatch({
                  sendId,
                  recipients: sending.map(({ dotyposCustomerId }) => ({
                    dotyposCustomerId,
                    locale:
                      input.facts.locales.get(dotyposCustomerId) ??
                      campaignFallbackLocale,
                  })),
                  profiles: input.facts.profiles,
                  at: input.at,
                })
                .pipe(
                  Effect.andThen(
                    appendAutomationRunProgress(
                      sending.map(({ id }) => ({
                        runId: id,
                        kind: "send-queued" as const,
                        stepId: input.sendStepId,
                        at: input.at,
                        detail: { sendId },
                      }))
                    )
                  ),
                  Effect.andThen(
                    recordUnitSend({ unitId: input.unit.id, sendId })
                  )
                )
        )
      );

  const recordUnitSend = (input: {
    readonly unitId: AutomationWorkUnitId;
    readonly sendId: CampaignSendId;
  }) =>
    db
      .update(units)
      .set({ sendId: input.sendId })
      .where(and(eq(units.id, input.unitId), isNull(units.sendId)));

  const handler: AutomationUnitHandler<DeliverSubject, DeliverFacts> = {
    kind: "deliver",
    subject: deliverSubjectSchema,
    fetch,
    commit,
    submit: (unit, facts) =>
      delivery
        .submitAutomatedSend({
          sendId: unit.sendId,
          profiles: Option.map(facts, ({ profiles }) => profiles),
        })
        .pipe(
          Effect.map(
            (settlement) => (at: Temporal.Instant) =>
              // Serialises the settlement with archive (§5.4).
              Effect.forEach(
                Option.toArray(Option.fromNullishOr(unit.campaignId)),
                (campaignId) => lockAutomationForEngine(campaignId)
              ).pipe(Effect.andThen(settlement(at)))
          ),
          Effect.catchTag("CampaignDeliveryIncomplete", (cause) =>
            Effect.fail(
              new AutomationUnitFetchFailure({
                code: "delivery-incomplete",
                cause,
              })
            )
          )
        ),
  };

  return registerAutomationUnitHandler(handler);
});

/**
 * What the pre-submit check (§5.9) makes of one run at the send instant:
 * `send`, `withdraw` because its reservation was cancelled or is gone
 * (D28), or `defer` because Dotypos moved its visit so the trigger hasn't
 * happened yet.
 */
const verdictOf = (input: {
  readonly run: DeliverRun;
  readonly facts: DeliverFacts;
  readonly cancelled: ReadonlySet<WorkspaceReservationId>;
  readonly at: Temporal.Instant;
}): "send" | "withdraw" | "defer" => {
  const { run } = input;
  const reservation = run.triggerReservationId;
  if (reservation === null) return "send";
  if (
    withdrawnByCancellation(run.triggerKind) &&
    input.cancelled.has(reservation)
  ) {
    return "withdraw";
  }
  return Match.value(
    triggeringVisitVerdict({
      kind: run.triggerKind,
      visit: Option.flatten(
        Option.fromNullishOr(input.facts.visits.get(reservation))
      ),
      asOf: input.at,
    })
  ).pipe(
    Match.when("current", () => "send" as const),
    Match.when("withdrawn", () => "withdraw" as const),
    Match.when("moved", () => "defer" as const),
    Match.exhaustive
  );
};
