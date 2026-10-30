import "@/shared/polyfills/temporal";

import type { DotyposCustomerId, DotyposService } from "@deskohub/dotypos";
import type { AutomationFlowType as AutomationFlow } from "@deskohub/workspace-admin-api";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Effect, Match, Option, Schema } from "effect";
import { WorkspaceDatabase, WorkspaceTransaction } from "@/db/database.service";
import { customerEvents } from "@/db/schema";
import {
  type ReservationVisit,
  ReservationVisits,
} from "@/features/reservation/backend/reservation-visits.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { CustomerEventId } from "@/shared/backend/customer-events/customer-event";
import {
  currentInstant,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
import {
  AudienceFactSource,
  AudienceScope,
  audienceEvaluationAt,
} from "../../backend/audience-evaluation-context";
import type { AudienceDotyposReads } from "../../backend/audience-facts.service";
import { CampaignRecipientService } from "../../backend/campaign-recipient.service";
import type { AutomationWorkUnitId } from "../automation-identifiers";
import {
  readsTriggeringVisit,
  triggeringVisitVerdict,
  withdrawnByCancellation,
} from "../automation-trigger-verification";
import { versionInForce } from "../automation-versions";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import {
  type IntakeEvent,
  type IntakeMatch,
  intakeEventColumns,
  matchIntakeEvents,
} from "./automation-intake-matching";
import { lockAutomationForEngine } from "./automation-lifecycle-lock";
import {
  type AutomationTriggerOccurrence,
  enterAutomationRuns,
  loadAutomationEntryVersions,
  takenReceiptKeys,
} from "./automation-run-entry";
import { lockTriggeringCustomerEvents } from "./automation-triggering-events";
import { lockTriggeringReservations } from "./automation-triggering-reservations";
import {
  AutomationUnitFetchFailure,
  type AutomationUnitHandler,
  automationUnitDeadlineMissLimit,
  type ClaimedAutomationUnit,
  type PlannedAutomationUnit,
  registerAutomationUnitHandler,
} from "./automation-unit-handler";
import { loadAutomationVersionActivations } from "./automation-version-activations";

const intakeSubjectSchema = Schema.Struct({
  eventIds: Schema.Array(Schema.String),
});
type IntakeSubject = typeof intakeSubjectSchema.Type;

/** Events older than this get `failed` receipts instead of a fetch (§5.2). */
const intakeEventLimit = Temporal.Duration.from({ hours: 24 });

/**
 * The intake unit owning `eventIds`. The key includes the planner instant,
 * so events a dropped unit released are planned again under a new key.
 */
export const plannedIntakeUnit = (
  unit: {
    readonly eventIds: readonly CustomerEventId[];
    readonly requestCost: number;
  },
  at: Temporal.Instant
): PlannedAutomationUnit => ({
  kind: "intake",
  key: `intake:${temporalInstantToIsoString(at)}:${unit.eventIds[0]}`,
  subject: Schema.encodeSync(intakeSubjectSchema)({
    eventIds: [...unit.eventIds],
  }),
  requestCost: unit.requestCost,
});

/** The triggering reservations whose visits intake re-checks, each once. */
export const revisitedReservations = (
  events: readonly IntakeEvent[]
): readonly WorkspaceReservationId[] => [
  ...new Set(
    events.flatMap(({ kind, workspaceReservationId }) =>
      readsTriggeringVisit(kind) && workspaceReservationId !== null
        ? [workspaceReservationId]
        : []
    )
  ),
];

/** What intake decided for one event and one automation. */
type IntakeDecision = IntakeMatch & {
  /** None when the version's flow no longer decodes. */
  readonly flow: Option.Option<AutomationFlow>;
  readonly outcome:
    | "member"
    | "not-in-audience"
    | "withdrawn"
    | "superseded"
    | "failed";
};

/**
 * The live re-check (§5.6, D35) at `now`. A withdrawn trigger withdraws
 * the event (D28). A moved one supersedes it: the sweep records a new
 * event at the visit's new time.
 */
const recheckVisit = (
  event: IntakeEvent,
  visit: Option.Option<ReservationVisit>,
  now: Temporal.Instant
): "withdrawn" | "superseded" | "current" =>
  Match.value(
    triggeringVisitVerdict({ kind: event.kind, visit, asOf: now })
  ).pipe(
    Match.when("current", () => "current" as const),
    Match.when("withdrawn", () => "withdrawn" as const),
    Match.when("moved", () => "superseded" as const),
    Match.exhaustive
  );

const ownedEvents = (
  unitId: AutomationWorkUnitId,
  eventIds: readonly string[]
) =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    db
      .select(intakeEventColumns)
      .from(customerEvents)
      .where(
        and(
          inArray(customerEvents.id, eventIds as CustomerEventId[]),
          eq(customerEvents.automationUnitId, unitId),
          isNull(customerEvents.automationProcessedAt)
        )
      )
      .orderBy(asc(customerEvents.occurredAt), asc(customerEvents.id))
  );

/** A superseded event gets no receipt, so its key stays free (§5.6). */
const isReceipted = (
  decision: IntakeDecision
): decision is IntakeDecision & {
  readonly outcome: Exclude<IntakeDecision["outcome"], "superseded">;
} => decision.outcome !== "superseded";

const occurrenceOf = ({
  event,
  dedupKey,
}: IntakeDecision): AutomationTriggerOccurrence => ({
  dotyposCustomerId: event.dotyposCustomerId,
  dedupKey,
  kind: event.kind,
  at: event.occurredAt,
  eventId: event.id,
  reservationId: event.workspaceReservationId,
});

const isAfterOrAt = (left: Temporal.Instant, right: Temporal.Instant) =>
  Temporal.Instant.compare(left, right) >= 0;

/**
 * Whether a Workspace cancellation of the event's reservation withdraws it
 * (D28): runs triggered by a cancellation are never withdrawn, as in planning.
 */
const isWithdrawable = (decision: IntakeDecision) =>
  decision.outcome !== "failed" && withdrawnByCancellation(decision.event.kind);

/**
 * Writes intake decisions in the caller's transaction. First the events'
 * accounts are locked: an event that no longer triggers, a legacy
 * account's since intake read it (D37), is processed with no receipt. Then
 * one automation at a time under its lifecycle lock (§5.4): a paused or
 * archived automation, or an event before `accepting_since`, processes the
 * event with no receipt; an event whose version in force changed is
 * released for replanning. Then the triggering reservations are locked: an event whose reservation
 * Workspace cancelled is withdrawn, since that cancellation's event may
 * already be processed with no run to withdraw, and a later cancellation
 * waits for the commit and withdraws the runs it wrote (§5.6). Otherwise
 * each receipt key records once, from its earliest event, and members
 * enter. Finally the unit's other events are processed.
 */
const commitIntakeDecisions = Effect.fn("automationIntake.commit")(
  function* (input: {
    readonly unitId: AutomationWorkUnitId;
    readonly eventIds: readonly CustomerEventId[];
    readonly decisions: readonly IntakeDecision[];
    readonly at: Temporal.Instant;
    /** Plans the first step of the runs members start. */
    readonly facts: AutomationEvaluationFacts["Service"];
  }) {
    const { db } = yield* WorkspaceTransaction;
    const released = new Set<CustomerEventId>();
    const retired = yield* lockTriggeringCustomerEvents(
      input.decisions.map(({ event }) => event)
    );
    const byCampaign = [
      ...Map.groupBy(input.decisions, ({ campaignId }) => campaignId),
    ].sort(([left], [right]) => left.localeCompare(right));

    for (const [campaignId, decisions] of byCampaign) {
      const state = yield* lockAutomationForEngine(campaignId);
      const acceptingSince = state.acceptingSince;
      if (state.status !== "active" || acceptingSince === null) continue;
      const versions = yield* loadAutomationVersionActivations(campaignId);
      const accepted = decisions.filter((decision) => {
        if (
          retired.has(decision.event.id) ||
          !isAfterOrAt(decision.event.occurredAt, acceptingSince)
        ) {
          return false;
        }
        const inForce = versionInForce(versions, decision.event.occurredAt);
        if (Option.isSome(inForce) && inForce.value.id === decision.versionId) {
          return true;
        }
        released.add(decision.event.id);
        return false;
      });
      const cancelled = yield* lockTriggeringReservations(
        accepted.flatMap((decision) =>
          isWithdrawable(decision)
            ? [decision.event.workspaceReservationId]
            : []
        )
      );
      const rechecked = accepted.map((decision) =>
        isWithdrawable(decision) &&
        decision.event.workspaceReservationId !== null &&
        cancelled.has(decision.event.workspaceReservationId)
          ? { ...decision, outcome: "withdrawn" as const }
          : decision
      );
      const taken = yield* takenReceiptKeys(
        campaignId,
        rechecked.map(({ dedupKey }) => dedupKey)
      );
      const recorded = new Set(taken);
      const receipted = rechecked
        .filter(isReceipted)
        .toSorted(
          (left, right) =>
            Temporal.Instant.compare(
              left.event.occurredAt,
              right.event.occurredAt
            ) || left.event.id.localeCompare(right.event.id)
        )
        .filter(({ dedupKey }) => {
          if (recorded.has(dedupKey)) return false;
          recorded.add(dedupKey);
          return true;
        });

      // Versions enter in activation order, so D4 holds across them.
      const byVersion = Map.groupBy(receipted, ({ versionId }) => versionId);
      for (const version of versions) {
        const ofVersion = byVersion.get(version.id) ?? [];
        if (ofVersion.length === 0) continue;
        const members = ofVersion.filter(({ outcome }) => outcome === "member");
        const flow = Option.flatMap(
          Option.fromUndefinedOr(members[0]),
          ({ flow }) => flow
        );
        yield* enterAutomationRuns({
          campaignId,
          versionId: version.id,
          ...(Option.isSome(flow) && {
            admitted: {
              flow: flow.value,
              occurrences: members.map(occurrenceOf),
              facts: input.facts,
            },
          }),
          rejected: ofVersion.flatMap((decision) =>
            decision.outcome === "member"
              ? []
              : [{ ...occurrenceOf(decision), disposition: decision.outcome }]
          ),
          at: input.at,
        });
      }
    }

    const processed = input.eventIds.filter((id) => !released.has(id));
    if (processed.length > 0) {
      yield* db
        .update(customerEvents)
        .set({ automationProcessedAt: input.at, automationUnitId: null })
        .where(
          and(
            inArray(customerEvents.id, processed),
            eq(customerEvents.automationUnitId, input.unitId),
            isNull(customerEvents.automationProcessedAt)
          )
        );
    }
    if (released.size > 0) {
      yield* db
        .update(customerEvents)
        .set({ automationUnitId: null })
        .where(
          and(
            inArray(customerEvents.id, [...released]),
            eq(customerEvents.automationUnitId, input.unitId)
          )
        );
    }
  }
);

/** The `intake` unit: re-checks triggering visits live and starts runs for matched events (§5.6). */
export const makeIntakeHandler = Effect.gen(function* () {
  const { transaction } = yield* WorkspaceDatabase;
  const facts = yield* AutomationEvaluationFacts;
  const recipients = yield* CampaignRecipientService;
  const context = yield* Effect.context<WorkspaceDatabase | DotyposService>();

  const databaseFailure = (cause: unknown) =>
    new AutomationUnitFetchFailure({ code: "database", cause });

  /** Each triggering visit, from the gates' visits when they read them. */
  const triggeringVisits = (
    events: readonly IntakeEvent[],
    fetched: AudienceFactSource
  ) => {
    const reservations = revisitedReservations(events);
    const gateVisits = AudienceFactSource.$is("Fetched")(fetched)
      ? fetched.visits
      : Option.none();
    return Option.match(gateVisits, {
      onSome: (byCustomer) => {
        const visits = new Map(
          [...byCustomer.values()]
            .flat()
            .map((visit) => [visit.workspaceReservationId, visit] as const)
        );
        return Effect.succeed(
          new Map(
            reservations.map((id) => [
              id,
              Option.fromUndefinedOr(visits.get(id)),
            ])
          ) as ReadonlyMap<
            WorkspaceReservationId,
            Option.Option<ReservationVisit>
          >
        );
      },
      onNone: () =>
        Effect.flatMap(ReservationVisits, (visits) =>
          visits.ofReservations(reservations)
        ).pipe(
          Effect.provide(ReservationVisits.Default),
          Effect.provideContext(context),
          Effect.mapError(AutomationUnitFetchFailure.fromReservationVisits)
        ),
    });
  };

  const handler: AutomationUnitHandler<
    IntakeSubject,
    readonly IntakeDecision[]
  > = {
    kind: "intake",
    subject: intakeSubjectSchema,
    expire: Effect.fn("intake.expire")(function* (
      unit: ClaimedAutomationUnit<IntakeSubject>,
      at: Temporal.Instant
    ) {
      const events = yield* ownedEvents(unit.id, unit.subject.eventIds);
      const solo =
        new Set(events.map(({ dotyposCustomerId }) => dotyposCustomerId))
          .size === 1 && unit.deadlineMisses >= automationUnitDeadlineMissLimit;
      const limit = at.subtract(intakeEventLimit);
      const expired = solo
        ? events
        : events.filter(
            ({ recordedAt }) => Temporal.Instant.compare(recordedAt, limit) <= 0
          );
      if (expired.length === 0) return "remaining" as const;
      const matches = yield* matchIntakeEvents(expired);
      yield* commitIntakeDecisions({
        unitId: unit.id,
        eventIds: expired.map(({ id }) => id),
        decisions: matches.map((match) => ({
          ...match,
          flow: Option.none(),
          outcome: "failed" as const,
        })),
        at,
        facts,
      }).pipe(Effect.catchTag("AutomationUnitRecheckFailed", Effect.die));
      return expired.length === events.length
        ? ("settled" as const)
        : ("remaining" as const);
    }),
    fetch: Effect.fn("intake.fetch")(function* (
      unit: ClaimedAutomationUnit<IntakeSubject>
    ) {
      const { matches, versions } = yield* transaction(
        ownedEvents(unit.id, unit.subject.eventIds).pipe(
          Effect.flatMap((events) => matchIntakeEvents(events)),
          Effect.flatMap((matches) =>
            loadAutomationEntryVersions(
              matches.map(({ versionId }) => versionId)
            ).pipe(Effect.map((versions) => ({ matches, versions })))
          )
        )
      ).pipe(Effect.mapError(databaseFailure));
      if (matches.length === 0) return [];

      const plannedAt = yield* currentInstant;
      const plans = yield* Effect.forEach(versions.values(), (version) =>
        facts
          .plan({
            filters: { entryAudience: version.audienceFilter },
            context: audienceEvaluationAt(plannedAt),
          })
          .pipe(Effect.orDie)
      );
      const reads: AudienceDotyposReads = {
        visits: plans.some(({ reads }) => reads.visits),
        profiles: plans.some(({ reads }) => reads.profiles),
      };
      const customers: readonly DotyposCustomerId[] = [
        ...new Set(matches.map(({ event }) => event.dotyposCustomerId)),
      ].sort();
      const fetched = yield* facts.fetch({ reads, customers });
      const visits = yield* triggeringVisits(
        matches.map(({ event }) => event),
        fetched
      );
      const now = yield* currentInstant;

      return yield* Effect.forEach(
        matches,
        (match): Effect.Effect<IntakeDecision, AutomationUnitFetchFailure> => {
          const version = versions.get(match.versionId);
          const flow = Option.flatMap(
            Option.fromUndefinedOr(version),
            ({ flow }) => flow
          );
          if (version === undefined || Option.isNone(flow)) {
            return Effect.succeed({
              ...match,
              flow,
              outcome: "failed",
            });
          }
          const visit = Option.flatten(
            Option.fromUndefinedOr(
              match.event.workspaceReservationId === null
                ? undefined
                : visits.get(match.event.workspaceReservationId)
            )
          );
          const recheck = recheckVisit(match.event, visit, now);
          if (recheck !== "current") {
            return Effect.succeed({
              ...match,
              flow,
              outcome: recheck,
            });
          }
          const customer = match.event.dotyposCustomerId;
          return recipients
            .resolve({
              purpose: version.purpose,
              filter: version.audienceFilter,
              scope: AudienceScope.Customers({ ids: [customer] }),
              context: {
                now,
                campaignId: Option.some(match.campaignId),
                trigger: Option.some({
                  kind: match.event.kind,
                  at: match.event.occurredAt,
                  reservationId: Option.fromNullishOr(
                    match.event.workspaceReservationId
                  ),
                }),
              },
              facts: fetched,
            })
            .pipe(
              Effect.mapError(databaseFailure),
              Effect.map(
                (resolution): IntakeDecision => ({
                  ...match,
                  flow,
                  // Unreachable customers still count as members;
                  // reachability is checked at send time (§5.6).
                  outcome: [
                    ...resolution.recipients.map(
                      ({ dotyposCustomerId }) => dotyposCustomerId
                    ),
                    ...resolution.exclusions.map(
                      ({ dotyposCustomerId }) => dotyposCustomerId
                    ),
                    ...resolution.duplicates.flatMap(
                      ({ duplicateCustomerIds }) => duplicateCustomerIds
                    ),
                  ].includes(customer)
                    ? "member"
                    : "not-in-audience",
                })
              )
            );
        }
      );
    }),
    commit: (unit, decisions, at) =>
      commitIntakeDecisions({
        unitId: unit.id,
        eventIds: unit.subject.eventIds as CustomerEventId[],
        decisions,
        at,
        facts,
      }).pipe(Effect.as([])),
  };

  return registerAutomationUnitHandler(handler);
});
