import "server-only";

import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  DotyposService,
  dotyposIdFilterBatchSize,
} from "@deskohub/dotypos";
import type {
  AutomationFlowType as AutomationFlow,
  AutomationPreviewRefType as AutomationPreviewRef,
  AutomationPreviewStatusType as AutomationPreviewStatus,
  AutomationDryRunType as DryRunReport,
} from "@deskohub/workspace-admin-api";
import { and, asc, desc, eq, gt, inArray, or } from "drizzle-orm";
import { Array as Arr, Context, Effect, Layer, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  emailCampaignAutomationPreviewRows as previewRows,
  emailCampaignAutomationPreviews as previews,
} from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import {
  nextStart,
  nextStartWithinHorizon,
} from "@/shared/utils/calendar-expression";
import { currentInstant, instantStringSchema } from "@/shared/utils/temporal";
import type { AudienceFilter } from "../../audience-filter";
import type { AudienceEvaluationContext } from "../../backend/audience-evaluation-context";
import { CampaignCandidateRepository } from "../../backend/campaign-candidate.repository";
import { renderCampaignEmailPreview } from "../../body/render-campaign-email-preview";
import type { CampaignId } from "../../campaign-identifiers";
import {
  CampaignAudienceMissing,
  type CampaignDeliveryMismatch,
  type CampaignNotFound,
} from "../../errors";
import { campaignLocales } from "../../recipient-locale";
import type { AutomationDraftHash } from "../automation-draft-hash";
import { automationPageCursor } from "../automation-page-cursor";
import { automationTickAtOrAfter } from "../automation-ticks";
import {
  automationTriggerKind,
  automationTriggerSummary,
} from "../automation-triggers";
import {
  AutomationArchived,
  AutomationCalendarNeverOccurs,
  type AutomationConditionAudienceMissing,
  AutomationFlowInvalid,
  type AutomationPageCursorInvalid,
  AutomationPreviewNotFound,
} from "../errors";
import { readAutomationCustomerContacts } from "./automation-customer-contacts";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import { lockAutomationForLifecycle } from "./automation-lifecycle-lock";
import {
  conditionFilterOf,
  plannedPreviewUnit,
  rechecksVisit,
} from "./automation-preview-unit";
import {
  type AutomationPreviewRow,
  closePreview,
  countReplayEvents,
  failStalledPreview,
  previewCounts,
  replayEventLimit,
  replayEventScope,
  selectReplayEvents,
} from "./automation-previews";
import type { AutomationEngineTransaction } from "./automation-unit-handler";
import { planAutomationUnits } from "./automation-unit-planning";
import {
  type AutomationWorkingCopy,
  loadAutomationWorkingCopy,
} from "./automation-working-copy";

/** How many next fires a schedule's dry run shows (§8.1). */
const previewedFires = 5;

/** Rows per page, and so the most customers one response hydrates. */
const maxPageRows = 200;

type AutomationDryRunStartError =
  | CampaignNotFound
  | CampaignDeliveryMismatch
  | AutomationFlowInvalid
  | CampaignAudienceMissing
  | AutomationArchived
  | AutomationCalendarNeverOccurs
  | AutomationConditionAudienceMissing
  | DatabaseQueryError;

type AutomationDryRunReadError =
  | AutomationPreviewNotFound
  | AutomationPageCursorInvalid
  | DatabaseQueryError;

interface IAutomationDryRun {
  /**
   * Starts a dry run of the campaign's working copy (D6, D20), or returns
   * the running or completed one of its current draft. Starting one
   * supersedes the campaign's running dry run of an older draft. Units
   * evaluate its customers asynchronously; a run with nobody to evaluate
   * completes at once.
   */
  readonly start: (
    campaignId: CampaignId
  ) => Effect.Effect<AutomationPreviewStatus, AutomationDryRunStartError>;
  /**
   * A dry run's progress, counts and one page of rows, with what's
   * computed per response: a schedule's next fires and frequency, the
   * working copy's email in each covered locale, and the page's customers'
   * names and emails read live from Dotypos and never stored (D35). A dry
   * run that made no progress for an hour reads, and stays, failed.
   */
  readonly get: (
    input: AutomationPreviewRef
  ) => Effect.Effect<DryRunReport, AutomationDryRunReadError>;
}

/** The keyset position after a page's last row. */
const rowCursor = automationPageCursor(
  Schema.Struct({
    triggerAt: instantStringSchema,
    customerId: DotyposCustomerIdSchema,
  })
);

export class AutomationDryRun extends Context.Service<
  AutomationDryRun,
  IAutomationDryRun
>()("@deskohub-workspace/email-campaigns/AutomationDryRun") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const facts = yield* AutomationEvaluationFacts;
      const candidates = yield* CampaignCandidateRepository;
      const dotypos = yield* DotyposService;

      /** The draft a dry run evaluates: refused while it can't be activated as is. */
      const draftOf = (copy: AutomationWorkingCopy) =>
        Effect.Do.pipe(
          Effect.tap(() =>
            copy.campaign.status === "archived"
              ? Effect.fail(
                  new AutomationArchived({ campaignId: copy.campaign.id })
                )
              : Effect.void
          ),
          Effect.bind("flow", () =>
            Option.match(copy.flow, {
              onNone: () =>
                Effect.fail(
                  new AutomationFlowInvalid({
                    message: "Save a flow before you dry-run the automation.",
                  })
                ),
              onSome: Effect.succeed,
            })
          ),
          Effect.bind("audience", () =>
            Option.match(copy.audience, {
              onNone: () =>
                Effect.fail(
                  new CampaignAudienceMissing({ campaignId: copy.campaign.id })
                ),
              onSome: Effect.succeed,
            })
          ),
          // Both exist, so the hash does too.
          Effect.let("draftHash", () => Option.getOrThrow(copy.draftHash)),
          Effect.map(({ flow, audience, draftHash }) => ({
            copy,
            flow,
            audienceFilter: audience.filter,
            draftHash,
          }))
        );

      /**
       * The latest running or completed dry run of this draft, after
       * failing a running one that stalled.
       */
      const reusablePreview = (
        tx: AutomationEngineTransaction,
        input: {
          readonly campaignId: CampaignId;
          readonly draftHash: AutomationDraftHash;
          readonly now: Temporal.Instant;
        }
      ) =>
        tx
          .select()
          .from(previews)
          .where(
            and(
              eq(previews.campaignId, input.campaignId),
              inArray(previews.status, ["running", "completed"])
            )
          )
          .orderBy(desc(previews.createdAt))
          .pipe(
            Effect.flatMap((rows) =>
              Effect.forEach(rows, (row) =>
                failStalledPreview(tx, row, input.now)
              )
            ),
            Effect.map((rows) =>
              Arr.findFirst(
                rows,
                (row) =>
                  row.draftHash === input.draftHash &&
                  (row.status === "running" || row.status === "completed")
              )
            )
          );

      /** The campaign's running dry run of another draft gives way (§8). */
      const supersedeRunning = (
        tx: AutomationEngineTransaction,
        input: {
          readonly campaignId: CampaignId;
          readonly now: Temporal.Instant;
        }
      ) =>
        tx
          .select({ id: previews.id })
          .from(previews)
          .where(
            and(
              eq(previews.campaignId, input.campaignId),
              eq(previews.status, "running")
            )
          )
          .pipe(
            Effect.flatMap((running) =>
              Effect.forEach(
                running,
                ({ id }) =>
                  closePreview(tx, {
                    previewId: id,
                    status: "superseded",
                    at: input.now,
                  }),
                { discard: true }
              )
            )
          );

      /**
       * A schedule's next fire `F`, and its pool chunked like the fire's:
       * the one-off pool rules (consent included), in id order (§5.7).
       */
      const planScheduleFire = (
        input: AutomationPlanInput & {
          readonly calendar: Extract<
            AutomationFlow["trigger"],
            { readonly _tag: "Schedule" }
          >["calendar"];
        }
      ) =>
        Effect.Do.pipe(
          Effect.bind("fireAt", () =>
            nextStart(input.calendar, input.now).pipe(
              Effect.map(automationTickAtOrAfter),
              Effect.mapError(
                (cause) =>
                  new AutomationCalendarNeverOccurs({
                    location: { _tag: "Trigger" },
                    cause,
                  })
              )
            )
          ),
          Effect.bind("pool", () =>
            candidates
              .listCandidates({ purpose: input.copy.campaign.purpose })
              .pipe(
                Effect.map((rows) =>
                  rows
                    .map(({ dotyposCustomerId }) => dotyposCustomerId)
                    .toSorted()
                )
              )
          ),
          Effect.bind("plan", ({ fireAt }) =>
            facts.plan({
              filters: {
                entryAudience: input.audienceFilter,
                reachability: true,
                ...conditionFilters(input.flow),
              },
              context: {
                now: input.now,
                campaignId: Option.some(input.campaignId),
                trigger: Option.some({
                  kind: "schedule",
                  at: fireAt,
                  reservationId: Option.none(),
                }),
              },
            })
          ),
          Effect.bind("chunks", ({ plan, pool }) =>
            facts.pack({ reads: plan.reads, customers: pool })
          ),
          Effect.map(({ fireAt, chunks }) => ({
            kind: "schedule" as const,
            asOf: fireAt,
            eventsTotal: null,
            chunks,
          }))
        );

      /**
       * An event trigger's replay: the latest 1,000 events of the last 30
       * days, their distinct customers chunked in id order, each chunk
       * also paying for the live re-check of its events' visits (§8.2).
       */
      const planReplay = (
        tx: AutomationEngineTransaction,
        input: {
          readonly campaignId: CampaignId;
          readonly flow: AutomationFlow;
          readonly audienceFilter: AutomationPlanInput["audienceFilter"];
          readonly now: Temporal.Instant;
        }
      ) => {
        const kind = automationTriggerKind(input.flow.trigger);
        const context: AudienceEvaluationContext = {
          now: input.now,
          campaignId: Option.some(input.campaignId),
          trigger: Option.some({
            kind,
            at: input.now,
            reservationId: Option.none(),
          }),
        };
        return Option.match(
          replayEventScope(input.flow.trigger, {
            asOf: input.now,
            createdAt: input.now,
          }),
          {
            onNone: () =>
              Effect.die(new Error("A schedule trigger has no replay")),
            onSome: (scope) =>
              Effect.Do.pipe(
                Effect.bind("eventsTotal", () => countReplayEvents(tx, scope)),
                Effect.bind("events", () => selectReplayEvents(tx, scope)),
                Effect.bind("plan", () =>
                  facts.plan({
                    filters: {
                      entryAudience: input.audienceFilter,
                      reachability: false,
                      ...conditionFilters(input.flow),
                    },
                    context,
                  })
                ),
                Effect.bind("chunks", ({ plan, events }) =>
                  facts.pack({
                    reads: plan.reads,
                    customers: [
                      ...new Set(
                        events.map(({ dotyposCustomerId }) => dotyposCustomerId)
                      ),
                    ].toSorted(),
                  })
                ),
                Effect.map(({ eventsTotal, events, chunks }) => ({
                  kind: "replay" as const,
                  asOf: input.now,
                  eventsTotal,
                  chunks: chunks.map((chunk) => ({
                    ...chunk,
                    requestCost:
                      chunk.requestCost +
                      (rechecksVisit(kind)
                        ? recheckCost(events, chunk.customers)
                        : 0),
                  })),
                }))
              ),
          }
        );
      };

      const createPreview = (
        tx: AutomationEngineTransaction,
        input: AutomationPlanInput
      ) =>
        Effect.Do.pipe(
          Effect.bind(
            "planned",
            (): Effect.Effect<PlannedPreview, AutomationDryRunStartError> =>
              input.flow.trigger._tag === "Schedule"
                ? planScheduleFire({
                    ...input,
                    calendar: input.flow.trigger.calendar,
                  })
                : planReplay(tx, input)
          ),
          Effect.tap(() =>
            supersedeRunning(tx, {
              campaignId: input.campaignId,
              now: input.now,
            })
          ),
          Effect.bind("preview", ({ planned }) =>
            tx
              .insert(previews)
              .values({
                campaignId: input.campaignId,
                draftHash: input.draftHash,
                kind: planned.kind,
                status: planned.chunks.length === 0 ? "completed" : "running",
                asOf: planned.asOf,
                unitsTotal: planned.chunks.length,
                eventsTotal: planned.eventsTotal,
                createdAt: input.now,
                completedAt: planned.chunks.length === 0 ? input.now : null,
              })
              .returning()
              .pipe(Effect.map(([row]) => row!))
          ),
          Effect.tap(({ planned, preview }) =>
            planAutomationUnits(
              tx,
              planned.chunks.map((chunk, index) =>
                plannedPreviewUnit({
                  previewId: preview.id,
                  campaignId: input.campaignId,
                  index,
                  customers: chunk.customers,
                  requestCost: chunk.requestCost,
                })
              ),
              input.now
            )
          ),
          Effect.map(({ preview }) => preview)
        );

      const start: IAutomationDryRun["start"] = Effect.fn(
        "AutomationDryRun.start"
      )(function* (campaignId) {
        const now = yield* currentInstant;
        return yield* db.transaction((tx) =>
          Effect.Do.pipe(
            // Serialises concurrent starts, and with activation and archive.
            Effect.tap(() => lockAutomationForLifecycle(tx, campaignId)),
            Effect.bind("copy", () =>
              loadAutomationWorkingCopy(tx, campaignId)
            ),
            Effect.bind("draft", ({ copy }) => draftOf(copy)),
            Effect.bind("reusable", ({ draft }) =>
              reusablePreview(tx, {
                campaignId,
                draftHash: draft.draftHash,
                now,
              })
            ),
            Effect.flatMap(({ draft, reusable }) =>
              Option.match(reusable, {
                onSome: Effect.succeed,
                onNone: () =>
                  createPreview(tx, {
                    campaignId,
                    copy: draft.copy,
                    flow: draft.flow,
                    audienceFilter: draft.audienceFilter,
                    draftHash: draft.draftHash,
                    now,
                  }),
              })
            ),
            Effect.map(previewStatus)
          )
        );
      });

      /** Names and emails of the page's customers, read live and never stored. */
      const hydrate = (customers: readonly DotyposCustomerId[]) =>
        readAutomationCustomerContacts(customers).pipe(
          Effect.provideService(DotyposService, dotypos),
          Effect.map((contacts) =>
            customers.map((customerId) => {
              const contact = Option.getOrUndefined(contacts)?.get(customerId);
              return {
                customerId,
                name: contact?.name ?? null,
                email: contact?.email ?? null,
              };
            })
          )
        );

      /** The working copy's email in each locale it has content for, Czech first. */
      const renderEmails = (
        copy: Option.Option<AutomationWorkingCopy>
      ): Effect.Effect<
        DryRunReport["emails"],
        Effect.Error<ReturnType<typeof renderCampaignEmailPreview>>
      > =>
        Option.match(copy, {
          onNone: () => Effect.succeed([]),
          onSome: ({ campaign }) =>
            Effect.forEach(
              campaignLocales.flatMap((locale) => {
                const content = campaign.content[locale];
                return content === undefined ? [] : [{ locale, content }];
              }),
              ({ locale, content }) =>
                renderCampaignEmailPreview({
                  templateKey: campaign.templateKey,
                  purpose: campaign.purpose,
                  locale,
                  content,
                }).pipe(
                  Effect.map(({ subject, html, text }) => ({
                    locale,
                    subject,
                    html,
                    text,
                  }))
                )
            ),
        });

      const get: IAutomationDryRun["get"] = Effect.fn("AutomationDryRun.get")(
        function* (input) {
          const now = yield* currentInstant;
          const limit = input.limit ?? maxPageRows;
          const position = yield* Effect.transposeOption(
            Option.map(Option.fromUndefinedOr(input.cursor), rowCursor.decode)
          );
          const { preview, rows, copy } = yield* db.transaction((tx) =>
            Effect.Do.pipe(
              Effect.bind("stored", () =>
                tx
                  .select()
                  .from(previews)
                  .where(eq(previews.id, input.previewId))
                  .pipe(
                    Effect.flatMap(([row]) =>
                      row === undefined
                        ? Effect.fail(
                            new AutomationPreviewNotFound({
                              previewId: input.previewId,
                            })
                          )
                        : Effect.succeed(row)
                    )
                  )
              ),
              Effect.bind("preview", ({ stored }) =>
                failStalledPreview(tx, stored, now)
              ),
              Effect.bind("rows", ({ preview }) =>
                tx
                  .select()
                  .from(previewRows)
                  .where(
                    and(
                      eq(previewRows.previewId, preview.id),
                      Option.match(position, {
                        onNone: () => undefined,
                        onSome: ({ triggerAt, customerId }) => {
                          const after = Temporal.Instant.from(triggerAt);
                          return or(
                            gt(previewRows.triggerAt, after),
                            and(
                              eq(previewRows.triggerAt, after),
                              gt(previewRows.dotyposCustomerId, customerId)
                            )
                          );
                        },
                      })
                    )
                  )
                  .orderBy(
                    asc(previewRows.triggerAt),
                    asc(previewRows.dotyposCustomerId)
                  )
                  .limit(limit + 1)
              ),
              Effect.bind("copy", ({ preview }) =>
                loadAutomationWorkingCopy(tx, preview.campaignId).pipe(
                  Effect.map(Option.some),
                  Effect.catchTags({
                    CampaignNotFound: () => Effect.succeed(Option.none()),
                    CampaignDeliveryMismatch: () =>
                      Effect.succeed(Option.none()),
                    AutomationFlowInvalid: () => Effect.succeed(Option.none()),
                  })
                )
              )
            )
          );
          const page = rows.slice(0, limit);
          const last = page.at(-1);
          const schedule = Option.flatMap(copy, ({ flow }) =>
            Option.filter(flow, ({ trigger }) => trigger._tag === "Schedule")
          );
          const emails = yield* renderEmails(copy).pipe(
            Effect.tapError((error) =>
              Effect.logError("Dry run email failed to render", error)
            ),
            Effect.orElseSucceed(() => [])
          );
          const customers = yield* hydrate([
            ...new Set(page.map(({ dotyposCustomerId }) => dotyposCustomerId)),
          ]);
          const dryRun: DryRunReport = {
            ...previewStatus(preview),
            nextFires: Option.match(schedule, {
              onNone: () => [],
              onSome: ({ trigger }) =>
                trigger._tag === "Schedule"
                  ? nextFires(trigger.calendar, now).map(String)
                  : [],
            }),
            frequency: Option.match(schedule, {
              onNone: () => null,
              onSome: ({ trigger }) =>
                automationTriggerSummary(trigger).frequency,
            }),
            counts: previewCounts(preview.counts),
            eventsTotal: preview.eventsTotal,
            truncated:
              preview.eventsTotal !== null &&
              preview.eventsTotal > replayEventLimit,
            rows: page.map((row) => ({
              triggerAt: row.triggerAt.toString(),
              customerId: row.dotyposCustomerId,
              customerEventId: row.customerEventId,
              outcome: row.outcome,
              stepId: row.stepId,
              sendAt: row.sendAt?.toString() ?? null,
              projected: row.projected,
              reservationStatusesApproximate:
                row.reservationStatusesApproximate,
            })),
            nextCursor:
              rows.length > limit && last !== undefined
                ? rowCursor.encode({
                    triggerAt: instantStringSchema.make(
                      last.triggerAt.toString({ smallestUnit: "microsecond" })
                    ),
                    customerId: last.dotyposCustomerId,
                  })
                : null,
            customers,
            profileFactsAreCurrent: true,
            emails,
          };
          return dryRun;
        }
      );

      return { start, get } satisfies IAutomationDryRun;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        AutomationEvaluationFacts.Live,
        CampaignCandidateRepository.Live,
        WorkspaceDotyposLayer
      )
    )
  );
}

/** What a new dry run evaluates, before its row exists. */
type PlannedPreview = {
  readonly kind: "schedule" | "replay";
  readonly asOf: Temporal.Instant;
  readonly eventsTotal: number | null;
  readonly chunks: readonly {
    readonly customers: readonly DotyposCustomerId[];
    readonly requestCost: number;
  }[];
};

type AutomationPlanInput = {
  readonly campaignId: CampaignId;
  readonly copy: AutomationWorkingCopy;
  readonly flow: AutomationFlow;
  readonly audienceFilter: AudienceFilter;
  readonly draftHash: AutomationDraftHash;
  readonly now: Temporal.Instant;
};

/** The condition steps' filters for a fact plan, when the flow has any. */
const conditionFilters = (flow: AutomationFlow) =>
  Option.match(conditionFilterOf(flow), {
    onNone: () => ({}),
    onSome: (condition) => ({ condition }),
  });

/** One Dotypos request per 50 of the chunk's replayed reservations. */
const recheckCost = (
  events: readonly {
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly workspaceReservationId: string | null;
  }[],
  customers: readonly DotyposCustomerId[]
) => {
  const chunk = new Set(customers);
  const reservations = new Set(
    events.flatMap(({ dotyposCustomerId, workspaceReservationId }) =>
      chunk.has(dotyposCustomerId) && workspaceReservationId !== null
        ? [workspaceReservationId]
        : []
    )
  );
  return Math.ceil(reservations.size / dotyposIdFilterBatchSize);
};

/**
 * `f₁ = nextStart(C, now)`, `fᵢ₊₁ = nextStart(C, fᵢ)`, within the horizon
 * (§8.1), each on the engine tick it fires on. Saved schedules fire only on
 * ticks, so rounding changes none of theirs.
 */
const nextFires = (
  calendar: Extract<
    AutomationFlow["trigger"],
    { readonly _tag: "Schedule" }
  >["calendar"],
  now: Temporal.Instant
): readonly Temporal.Instant[] => {
  const fires: Temporal.Instant[] = [];
  let after = now;
  while (fires.length < previewedFires) {
    const next = nextStartWithinHorizon(calendar, after);
    if (Option.isNone(next)) break;
    fires.push(automationTickAtOrAfter(next.value));
    after = next.value;
  }
  return fires;
};

const previewStatus = (
  preview: AutomationPreviewRow
): AutomationPreviewStatus => ({
  previewId: preview.id,
  campaignId: preview.campaignId,
  draftHash: preview.draftHash,
  kind: preview.kind,
  status: preview.status,
  asOf: preview.asOf.toString(),
  unitsDone: preview.unitsDone,
  unitsTotal: preview.unitsTotal,
  errorCode: preview.errorCode,
  createdAt: preview.createdAt.toString(),
  completedAt: preview.completedAt?.toString() ?? null,
});
