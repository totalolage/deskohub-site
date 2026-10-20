import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { AutomationFlowType as AutomationFlow } from "@deskohub/workspace-admin-api";
import { and, eq, sql } from "drizzle-orm";
import { Effect, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { emailCampaignAutomationScheduleFires as fires } from "@/db/schema";
import { currentInstant } from "@/shared/utils/temporal";
import {
  AudienceScope,
  audienceEvaluationAt,
} from "../../backend/audience-evaluation-context";
import { CampaignRecipientService } from "../../backend/campaign-recipient.service";
import type { CampaignId } from "../../campaign-identifiers";
import type { AutomationVersionId } from "../automation-identifiers";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import { lockAutomationForEngine } from "./automation-lifecycle-lock";
import {
  type AutomationTriggerOccurrence,
  enterAutomationRuns,
  loadAutomationEntryVersions,
} from "./automation-run-entry";
import {
  enterScheduleFire,
  type FireChunkSubject,
  fireChunkSubjectSchema,
  lockScheduleFireEntry,
  planNextFire,
  scheduleDedupKey,
} from "./automation-schedule-fires";
import {
  type AutomationEngineTransaction,
  AutomationUnitDefect,
  AutomationUnitFetchFailure,
  type AutomationUnitHandler,
  AutomationUnitRecheckFailed,
  automationUnitDeadlineMissLimit,
  type ClaimedAutomationUnit,
  registerAutomationUnitHandler,
} from "./automation-unit-handler";
import { loadAutomationVersionActivations } from "./automation-version-activations";

/** What a chunk's fetch found: its entrants, or why it enters nobody. */
type FireChunkEvaluation =
  | {
      readonly _tag: "Evaluated";
      readonly versionId: AutomationVersionId;
      readonly flow: AutomationFlow;
      readonly entrants: readonly DotyposCustomerId[];
    }
  /** The fire's version flow no longer decodes: the fire fails (§1.2.8). */
  | { readonly _tag: "Undecodable" }
  /** The fire isn't entering any more; the commit's recheck drops the unit. */
  | { readonly _tag: "Stale" };

const campaignOf = (unit: ClaimedAutomationUnit<FireChunkSubject>) =>
  unit.campaignId === null
    ? Effect.fail(new AutomationUnitDefect({ code: "campaign-missing" }))
    : Effect.succeed(unit.campaignId);

/**
 * The §5.4 fire recheck under the fire-entry and lifecycle locks: the
 * automation is active, the fire falls at or after `accepting_since`, and
 * it is still `entering`. Returns the fire's version and every activation.
 */
const recheckFire = Effect.fn("automationSchedules.recheckFire")(function* (
  tx: AutomationEngineTransaction,
  campaignId: CampaignId,
  fireAt: Temporal.Instant
) {
  yield* lockScheduleFireEntry(tx, campaignId);
  const state = yield* lockAutomationForEngine(tx, campaignId);
  if (
    state.status !== "active" ||
    state.acceptingSince === null ||
    Temporal.Instant.compare(fireAt, state.acceptingSince) < 0
  ) {
    return Option.none();
  }
  const [fire] = yield* tx
    .select({ versionId: fires.versionId })
    .from(fires)
    .where(
      and(
        eq(fires.campaignId, campaignId),
        eq(fires.fireAt, fireAt),
        eq(fires.status, "entering")
      )
    )
    .for("update");
  if (fire === undefined) return Option.none();
  const versions = yield* loadAutomationVersionActivations(tx, campaignId);
  return Option.some({ versionId: fire.versionId, versions });
});

/** The `fire-chunk` unit: evaluates one chunk of a schedule fire's pool and enters its customers (§5.7). */
export const makeFireChunkHandler = Effect.gen(function* () {
  const { db } = yield* WorkspaceDatabase;
  const facts = yield* AutomationEvaluationFacts;
  const recipients = yield* CampaignRecipientService;

  /**
   * Counts the chunk done. The commit completing the fire's last chunk
   * marks it `entered`, advances `next_fire_at` and plans the next due fire.
   */
  const completeChunk = (
    tx: AutomationEngineTransaction,
    input: {
      readonly campaignId: CampaignId;
      readonly fireAt: Temporal.Instant;
      readonly entered: number;
      readonly versions: Parameters<typeof enterScheduleFire>[1]["versions"];
      readonly at: Temporal.Instant;
    }
  ) =>
    tx
      .update(fires)
      .set({
        chunksDone: sql`${fires.chunksDone} + 1`,
        enteredCount: sql`${fires.enteredCount} + ${input.entered}`,
      })
      .where(
        and(
          eq(fires.campaignId, input.campaignId),
          eq(fires.fireAt, input.fireAt),
          eq(fires.status, "entering")
        )
      )
      .returning({ done: fires.chunksDone, total: fires.chunksTotal })
      .pipe(
        Effect.flatMap(([fire]) =>
          fire === undefined || fire.done < fire.total
            ? Effect.void
            : enterScheduleFire(tx, { ...input, status: "entered" }).pipe(
                Effect.andThen(planNextFire(tx, input.campaignId, input.at)),
                Effect.provideService(AutomationEvaluationFacts, facts),
                Effect.asVoid
              )
        )
      );

  const handler: AutomationUnitHandler<FireChunkSubject, FireChunkEvaluation> =
    {
      kind: "fire-chunk",
      subject: fireChunkSubjectSchema,
      // Fire chunks never expire (D34); only a solo chunk that keeps missing
      // its deadline counts as unavailable, so it can't block the fire.
      expire: Effect.fn("fireChunk.expire")(function* (
        tx: AutomationEngineTransaction,
        unit: ClaimedAutomationUnit<FireChunkSubject>,
        at: Temporal.Instant
      ) {
        const { fireAt, customerIds } = unit.subject;
        if (
          customerIds.length !== 1 ||
          unit.deadlineMisses < automationUnitDeadlineMissLimit
        ) {
          return "remaining" as const;
        }
        const campaignId = yield* campaignOf(unit);
        const fire = yield* recheckFire(tx, campaignId, fireAt);
        if (Option.isNone(fire)) return "settled" as const;
        yield* enterAutomationRuns(tx, {
          campaignId,
          versionId: fire.value.versionId,
          rejected: customerIds.map((customerId) => ({
            ...occurrenceOf(fireAt, customerId as DotyposCustomerId),
            disposition: "failed" as const,
          })),
          at,
        }).pipe(Effect.catchTag("AutomationUnitRecheckFailed", Effect.die));
        yield* completeChunk(tx, {
          campaignId,
          fireAt,
          entered: 0,
          versions: fire.value.versions,
          at,
        });
        return "settled" as const;
      }),
      fetch: Effect.fn("fireChunk.fetch")(function* (
        unit: ClaimedAutomationUnit<FireChunkSubject>
      ) {
        const campaignId = yield* campaignOf(unit);
        const { fireAt } = unit.subject;
        const customers = unit.subject.customerIds as DotyposCustomerId[];
        const [fire] = yield* db
          .select({ versionId: fires.versionId })
          .from(fires)
          .where(
            and(
              eq(fires.campaignId, campaignId),
              eq(fires.fireAt, fireAt),
              eq(fires.status, "entering")
            )
          )
          .pipe(Effect.mapError(databaseFailure));
        if (fire === undefined) return { _tag: "Stale" } as const;
        const version = (yield* db
          .transaction((tx) =>
            loadAutomationEntryVersions(tx, [fire.versionId])
          )
          .pipe(Effect.mapError(databaseFailure))).get(fire.versionId);
        if (version === undefined || Option.isNone(version.flow)) {
          return { _tag: "Undecodable" } as const;
        }

        // Profiles always: reachability and per-chunk email dedup.
        const { reads } = yield* facts
          .plan({
            filters: {
              entryAudience: version.audienceFilter,
              reachability: true,
            },
            context: audienceEvaluationAt(fireAt),
          })
          .pipe(Effect.orDie);
        const fetched = yield* facts.fetch({ reads, customers });
        const now = yield* currentInstant;
        const resolution = yield* recipients
          .resolve({
            purpose: version.purpose,
            filter: version.audienceFilter,
            scope: AudienceScope.Customers({ ids: customers }),
            context: {
              now,
              campaignId: Option.some(campaignId),
              trigger: Option.some({
                kind: "schedule" as const,
                at: fireAt,
                reservationId: Option.none(),
              }),
            },
            facts: fetched,
          })
          .pipe(Effect.mapError(databaseFailure));
        return {
          _tag: "Evaluated",
          versionId: version.id,
          flow: version.flow.value,
          entrants: resolution.recipients.map(
            ({ dotyposCustomerId }) => dotyposCustomerId
          ),
        } as const;
      }),
      commit: Effect.fn("fireChunk.commit")(function* (
        tx: AutomationEngineTransaction,
        unit: ClaimedAutomationUnit<FireChunkSubject>,
        evaluation: FireChunkEvaluation,
        at: Temporal.Instant
      ) {
        const campaignId = yield* campaignOf(unit);
        const { fireAt } = unit.subject;
        const fire = yield* recheckFire(tx, campaignId, fireAt);
        if (Option.isNone(fire) || evaluation._tag === "Stale") {
          return yield* new AutomationUnitRecheckFailed({
            code: "fire-not-entering",
          });
        }
        const { versions } = fire.value;
        if (evaluation._tag === "Undecodable") {
          // The next fire proceeds; the fire's other chunks drop at their
          // recheck.
          yield* enterScheduleFire(tx, {
            campaignId,
            fireAt,
            status: "failed",
            versions,
            at,
          });
          yield* planNextFire(tx, campaignId, at).pipe(
            Effect.provideService(AutomationEvaluationFacts, facts)
          );
          return [];
        }
        const entry = yield* enterAutomationRuns(tx, {
          campaignId,
          versionId: evaluation.versionId,
          admitted: {
            flow: evaluation.flow,
            occurrences: evaluation.entrants.map((customerId) =>
              occurrenceOf(fireAt, customerId)
            ),
            facts,
          },
          rejected: [],
          at,
        });
        yield* completeChunk(tx, {
          campaignId,
          fireAt,
          entered: entry.started + entry.alreadyActive,
          versions,
          at,
        });
        return [];
      }),
    };

  return registerAutomationUnitHandler(handler);
});

const databaseFailure = (cause: unknown) =>
  new AutomationUnitFetchFailure({ code: "database", cause });

const occurrenceOf = (
  fireAt: Temporal.Instant,
  customerId: DotyposCustomerId
): AutomationTriggerOccurrence => ({
  dotyposCustomerId: customerId,
  dedupKey: scheduleDedupKey(fireAt, customerId),
  kind: "schedule",
  at: fireAt,
  eventId: null,
  reservationId: null,
});
