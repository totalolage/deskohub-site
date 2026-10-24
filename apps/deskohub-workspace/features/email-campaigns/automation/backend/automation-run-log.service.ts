import "server-only";

import { type DotyposCustomerId, DotyposService } from "@deskohub/dotypos";
import {
  AdministrationCampaignRecipientSkipReason,
  type AdministrationCampaignRecipientSkipReasonType,
  type AutomationRunDetailType as AutomationRunDetail,
  AutomationRunId as AutomationRunIdSchema,
  type AutomationRunListInputType as AutomationRunListInput,
  type AutomationRunPageType as AutomationRunPage,
  type AutomationRunStatsType as AutomationRunStats,
  type AutomationRunSummaryType as AutomationRunSummary,
  AutomationRunTimelineEntry,
  type AutomationRunTimelineEntryType,
  automationRunOutcomes,
  automationRunStates,
} from "@deskohub/workspace-admin-api";
import { and, asc, count, desc, eq, lt, or } from "drizzle-orm";
import {
  Array as Arr,
  Context,
  Effect,
  Layer,
  Option,
  Predicate,
  Schema,
} from "effect";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import {
  emailCampaigns,
  emailCampaignAutomationRunEvents as runEvents,
  emailCampaignAutomationRuns as runs,
  emailCampaignAutomationVersions as versions,
} from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { instantStringSchema } from "@/shared/utils/temporal";
import type { CampaignId } from "../../campaign-identifiers";
import type { CampaignDelivery } from "../../campaign-states";
import { CampaignDeliveryMismatch, CampaignNotFound } from "../../errors";
import type { AutomationRunId } from "../automation-identifiers";
import { automationPageCursor } from "../automation-page-cursor";
import type {
  AutomationRunOutcome,
  AutomationRunState,
} from "../automation-states";
import {
  type AutomationPageCursorInvalid,
  AutomationRunNotFound,
  AutomationVersionNotFound,
} from "../errors";
import {
  type AutomationCustomerContact,
  readAutomationCustomerContacts,
} from "./automation-customer-contacts";

interface IAutomationRunLog {
  /**
   * One page of an automated campaign's runs, newest first, narrowed by the
   * optional filters. The cursor is a keyset position, so runs started
   * after the first page never shift later pages.
   */
  readonly listRuns: (
    input: AutomationRunListInput
  ) => Effect.Effect<
    AutomationRunPage,
    | CampaignNotFound
    | CampaignDeliveryMismatch
    | AutomationVersionNotFound
    | AutomationPageCursorInvalid
    | DatabaseQueryError
  >;
  /**
   * One run with its timeline in sequence order. An entry this build can't
   * read decodes as a generic entry instead of failing the run.
   */
  readonly getRun: (input: {
    readonly runId: AutomationRunId;
  }) => Effect.Effect<
    AutomationRunDetail,
    AutomationRunNotFound | DatabaseQueryError
  >;
  /**
   * Run counts of all versions, or of one, by state, by outcome and per
   * step: runs at each step now, and runs that ended at it.
   */
  readonly getRunStats: (input: {
    readonly campaignId: CampaignId;
    readonly versionNumber?: number;
  }) => Effect.Effect<
    AutomationRunStats,
    | CampaignNotFound
    | CampaignDeliveryMismatch
    | AutomationVersionNotFound
    | DatabaseQueryError
  >;
}

/** Runs per page when the caller doesn't say; the contract allows 100. */
const defaultPageSize = 50;

/**
 * Reads automated campaigns' runs for the run log; it never writes. Runs
 * carry their customers' current name and email, read live from Dotypos
 * once per call and never stored.
 */
export class AutomationRunLog extends Context.Service<
  AutomationRunLog,
  IAutomationRunLog
>()("@deskohub-workspace/email-campaigns/AutomationRunLog") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const dotypos = yield* DotyposService;

      /** The rows' customers' live contacts, in one read per call. */
      const contactsOf = (rows: readonly RunRow[]) =>
        readAutomationCustomerContacts(rows.map((row) => row.customerId)).pipe(
          Effect.provideService(DotyposService, dotypos)
        );

      const listRuns = Effect.fn("AutomationRunLog.listRuns")(function* (
        input: AutomationRunListInput
      ) {
        yield* requireAutomatedCampaign(db, input);
        const after = yield* Effect.transposeOption(
          Option.map(Option.fromNullishOr(input.cursor), runCursor.decode)
        );
        const limit = input.limit ?? defaultPageSize;
        const rows = yield* selectRunPage(db, { ...input, after, limit });
        const page = rows.slice(0, limit);
        const last = Arr.last(page);
        const contacts = yield* contactsOf(page);
        return {
          runs: page.map((row) => runSummary(row, contacts)),
          nextCursor:
            rows.length > limit
              ? Option.getOrNull(Option.map(last, runPosition))
              : null,
        } satisfies AutomationRunPage;
      });

      const getRun = Effect.fn("AutomationRunLog.getRun")(function* (input: {
        readonly runId: AutomationRunId;
      }) {
        const [row] = yield* selectRuns(db).where(eq(runs.id, input.runId));
        if (row === undefined) {
          return yield* new AutomationRunNotFound({ runId: input.runId });
        }
        const entries = yield* db
          .select({
            sequence: runEvents.sequence,
            kind: runEvents.kind,
            stepId: runEvents.stepId,
            at: runEvents.at,
            detail: runEvents.detail,
          })
          .from(runEvents)
          .where(eq(runEvents.runId, input.runId))
          .orderBy(asc(runEvents.sequence));
        const contacts = yield* contactsOf([row]);
        const detail: AutomationRunDetail = {
          ...runSummary(row, contacts),
          timeline: entries.map(timelineEntry),
        };
        return detail;
      });

      const getRunStats = Effect.fn("AutomationRunLog.getRunStats")(
        function* (input: {
          readonly campaignId: CampaignId;
          readonly versionNumber?: number;
        }) {
          yield* requireAutomatedCampaign(db, input);
          const groups = yield* db
            .select({
              stepId: runs.stepId,
              state: runs.status,
              outcome: runs.outcome,
              outcomeReason: runs.outcomeReason,
              runs: count(),
            })
            .from(runs)
            .innerJoin(versions, eq(versions.id, runs.versionId))
            .where(
              and(
                eq(runs.campaignId, input.campaignId),
                input.versionNumber === undefined
                  ? undefined
                  : eq(versions.versionNumber, input.versionNumber)
              )
            )
            .groupBy(runs.stepId, runs.status, runs.outcome, runs.outcomeReason)
            .orderBy(asc(runs.stepId));
          const stats: AutomationRunStats = {
            campaignId: input.campaignId,
            versionNumber: input.versionNumber ?? null,
            ...runCounts(groups),
            bySteps: Object.values(
              Arr.groupBy(groups, (group) => group.stepId)
            ).map((stepGroups) => ({
              stepId: stepGroups[0].stepId,
              ...runCounts(stepGroups),
            })),
            bySkipReason: skipReasonCounts(groups),
          };
          return stats;
        }
      );

      return { listRuns, getRun, getRunStats };
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(Layer.merge(WorkspaceDatabase.Default, WorkspaceDotyposLayer))
  );
}

/**
 * Fails unless the campaign exists and is automated, and, when a version
 * number is given, has published that version.
 */
const requireAutomatedCampaign = (
  db: WorkspaceDatabaseClient,
  input: { readonly campaignId: CampaignId; readonly versionNumber?: number }
) =>
  db
    .select({
      delivery: emailCampaigns.delivery,
      versionId: versions.id,
    })
    .from(emailCampaigns)
    .leftJoin(
      versions,
      and(
        eq(versions.campaignId, emailCampaigns.id),
        eq(versions.versionNumber, input.versionNumber ?? 0)
      )
    )
    .where(eq(emailCampaigns.id, input.campaignId))
    .pipe(
      Effect.map(([campaign]) => campaign),
      Effect.filterOrFail(
        (campaign) => campaign !== undefined,
        () => new CampaignNotFound({ campaignId: input.campaignId })
      ),
      Effect.flatMap((campaign) => automatedCampaignVersion(input, campaign))
    );

const automatedCampaignVersion = (
  {
    campaignId,
    versionNumber,
  }: { readonly campaignId: CampaignId; readonly versionNumber?: number },
  campaign: {
    readonly delivery: CampaignDelivery;
    readonly versionId: string | null;
  }
) =>
  Effect.void.pipe(
    Effect.filterOrFail(
      () => campaign.delivery === "automated",
      () =>
        new CampaignDeliveryMismatch({
          campaignId,
          delivery: campaign.delivery,
        })
    ),
    Effect.filterOrFail(
      () => versionNumber === undefined || campaign.versionId !== null,
      () =>
        new AutomationVersionNotFound({
          campaignId,
          versionNumber: versionNumber ?? 0,
        })
    )
  );

/** A position in the newest-first order: after this run's start and id. */
const RunPosition = Schema.Struct({
  startedAt: instantStringSchema,
  runId: AutomationRunIdSchema,
});
type RunPosition = typeof RunPosition.Type;

const runCursor = automationPageCursor(RunPosition);

const runColumns = {
  runId: runs.id,
  campaignId: runs.campaignId,
  versionNumber: versions.versionNumber,
  customerId: runs.dotyposCustomerId,
  triggerKind: runs.triggerKind,
  triggerAt: runs.triggerAt,
  state: runs.status,
  phase: runs.phase,
  stepId: runs.stepId,
  dueAt: runs.dueAt,
  outcome: runs.outcome,
  outcomeReason: runs.outcomeReason,
  sendId: runs.sendId,
  startedAt: runs.startedAt,
  endedAt: runs.endedAt,
};

const selectRuns = (db: WorkspaceDatabaseClient) =>
  db
    .select(runColumns)
    .from(runs)
    .innerJoin(versions, eq(versions.id, runs.versionId))
    .$dynamic();

type RunRow = Effect.Success<ReturnType<typeof selectRuns>>[number];

/** One more row than the page holds, so the caller knows a next page exists. */
const selectRunPage = (
  db: WorkspaceDatabaseClient,
  input: AutomationRunListInput & {
    readonly after: Option.Option<RunPosition>;
    readonly limit: number;
  }
) =>
  selectRuns(db)
    .where(
      and(
        eq(runs.campaignId, input.campaignId),
        input.state === undefined ? undefined : eq(runs.status, input.state),
        input.stepId === undefined ? undefined : eq(runs.stepId, input.stepId),
        input.outcome === undefined
          ? undefined
          : eq(runs.outcome, input.outcome),
        input.skipReason === undefined
          ? undefined
          : and(
              eq(runs.outcome, "skipped"),
              eq(runs.outcomeReason, input.skipReason)
            ),
        input.versionNumber === undefined
          ? undefined
          : eq(versions.versionNumber, input.versionNumber),
        input.customerId === undefined
          ? undefined
          : eq(runs.dotyposCustomerId, input.customerId),
        Option.getOrUndefined(Option.map(input.after, startedBefore))
      )
    )
    .orderBy(desc(runs.startedAt), desc(runs.id))
    .limit(input.limit + 1);

const startedBefore = (position: RunPosition) => {
  const startedAt = Temporal.Instant.from(position.startedAt);
  return or(
    lt(runs.startedAt, startedAt),
    and(eq(runs.startedAt, startedAt), lt(runs.id, position.runId))
  );
};

const runPosition = (row: RunRow) =>
  runCursor.encode({
    startedAt: instantStringSchema.make(row.startedAt.toString()),
    runId: row.runId,
  });

/** The customer's contact fields: unavailable when Dotypos wasn't read. */
const customerContactFields = (
  customerId: DotyposCustomerId,
  contacts: Option.Option<
    ReadonlyMap<DotyposCustomerId, AutomationCustomerContact>
  >
) => {
  if (Option.isNone(contacts)) {
    return {
      customerName: null,
      customerEmail: null,
      customerProfileStatus: "unavailable",
    } as const;
  }
  const contact = contacts.value.get(customerId);
  return contact === undefined
    ? ({
        customerName: null,
        customerEmail: null,
        customerProfileStatus: "not-found",
      } as const)
    : ({
        customerName: contact.name,
        customerEmail: contact.email,
        customerProfileStatus: "found",
      } as const);
};

const runSummary = (
  row: RunRow,
  contacts: Option.Option<
    ReadonlyMap<DotyposCustomerId, AutomationCustomerContact>
  >
): AutomationRunSummary => ({
  runId: row.runId,
  campaignId: row.campaignId,
  versionNumber: row.versionNumber,
  customerId: row.customerId,
  ...customerContactFields(row.customerId, contacts),
  triggerKind: row.triggerKind,
  triggerAt: row.triggerAt.toString(),
  state: row.state,
  phase: row.state === "active" ? row.phase : null,
  stepId: row.stepId,
  dueAt: row.state === "active" ? (row.dueAt?.toString() ?? null) : null,
  outcome: row.outcome,
  outcomeReason: row.outcomeReason,
  sendId: row.sendId,
  startedAt: row.startedAt.toString(),
  endedAt: row.endedAt?.toString() ?? null,
});

type TimelineRow = Omit<typeof runEvents.$inferSelect, "runId">;

const decodeTimelineEntry = Schema.decodeUnknownOption(
  AutomationRunTimelineEntry
);

/**
 * The stored entry as the contract reads it. A kind this build doesn't know,
 * or a detail its kind can't read, becomes a generic entry; a detail that
 * isn't an object reads as empty.
 */
const timelineEntry = (row: TimelineRow): AutomationRunTimelineEntryType => {
  const entry = {
    ...row,
    at: row.at.toString(),
    detail: Predicate.isObject(row.detail) ? row.detail : {},
  };
  return Option.getOrElse(decodeTimelineEntry(entry), () => entry);
};

type RunCountGroup = {
  readonly state: AutomationRunState;
  readonly outcome: AutomationRunOutcome | null;
  readonly runs: number;
};

/** Counts by state and by outcome, every key present. */
const runCounts = (groups: readonly RunCountGroup[]) => ({
  byState: Object.fromEntries(
    automationRunStates.map((state) => [
      state,
      sumRuns(groups.filter((group) => group.state === state)),
    ])
  ) as Record<AutomationRunState, number>,
  byOutcome: Object.fromEntries(
    automationRunOutcomes.map((outcome) => [
      outcome,
      sumRuns(groups.filter((group) => group.outcome === outcome)),
    ])
  ) as Record<AutomationRunOutcome, number>,
});

/** Skipped runs by reason, every reason present. */
const skipReasonCounts = (
  groups: readonly (RunCountGroup & {
    readonly outcomeReason: string | null;
  })[]
) =>
  Object.fromEntries(
    AdministrationCampaignRecipientSkipReason.literals.map((reason) => [
      reason,
      sumRuns(
        groups.filter(
          (group) =>
            group.outcome === "skipped" && group.outcomeReason === reason
        )
      ),
    ])
  ) as Record<AdministrationCampaignRecipientSkipReasonType, number>;

const sumRuns = (groups: readonly RunCountGroup[]) =>
  groups.reduce((total, group) => total + group.runs, 0);
