import "server-only";

import {
  type AutomationActivationType as AutomationActivation,
  type AutomationDetailType as AutomationDetail,
  type AutomationFlowType as AutomationFlow,
  type AutomationVersionDetailType as AutomationVersionDetail,
  type AutomationVersionSummaryType as AutomationVersionSummary,
  AutomationFlow as automationFlowContractSchema,
} from "@deskohub/workspace-admin-api";
import { and, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { toStoredInstant } from "@/db/instant";
import {
  emailCampaignAudiences,
  emailCampaignAutomationPreviews,
  emailCampaignAutomationRuns,
  emailCampaignAutomationScheduleFires,
  emailCampaignAutomations,
  emailCampaignAutomationVersionProvenance,
  emailCampaignAutomationVersions,
  emailCampaignAutomationWorkUnits,
  emailCampaigns,
} from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { currentInstant } from "@/shared/utils/temporal";
import type { AudienceFilter } from "../../audience-filter";
import { ensureSavedAudienceFilter } from "../../audience-filter-usage";
import { campaignBodyToMarkdown } from "../../body/campaign-body-markdown";
import type {
  CampaignLocalizedContent,
  CampaignPurpose,
  CampaignTemplateKey,
} from "../../body/campaign-content";
import { hashCampaignContent } from "../../body/campaign-content-hash";
import type {
  CampaignAudienceId,
  CampaignId,
} from "../../campaign-identifiers";
import {
  type AudienceFilterContextInvalid,
  CampaignAudienceArchived,
  type CampaignDeliveryMismatch,
  CampaignFallbackContentMissing,
  type CampaignNotFound,
} from "../../errors";
import { campaignContentCoversAudience } from "../../recipient-locale";
import type { AutomationDraftHash } from "../automation-draft-hash";
import {
  automationFlowReferences,
  validateAutomationFlow,
} from "../automation-flow";
import type {
  AutomationPreviewId,
  AutomationVersionId,
} from "../automation-identifiers";
import { automationTriggerSummary } from "../automation-triggers";
import { nextFireAfter } from "../automation-versions";
import {
  AutomationArchived,
  type AutomationCalendarNeverOccurs,
  AutomationDraftChanged,
  AutomationFlowInvalid,
  AutomationPreviewRequired,
  type AutomationScheduleMinutesNotAllowed,
  AutomationStatusConflict,
  AutomationVersionNotFound,
} from "../errors";
import { lockAutomationForLifecycle } from "./automation-lifecycle-lock";
import { closePreview } from "./automation-previews";
import { AutomationRunTransitions } from "./automation-run-transitions";
import type { AutomationEngineTransaction } from "./automation-unit-handler";
import { releaseAutomationUnitSubjects } from "./automation-unit-planning";
import { loadAutomationVersionActivations } from "./automation-version-activations";
import {
  type AutomationWorkingCopy,
  loadAutomationWorkingCopy,
} from "./automation-working-copy";

type WorkingCopyError =
  | CampaignNotFound
  | CampaignDeliveryMismatch
  | AutomationFlowInvalid
  | DatabaseQueryError;

type FlowValidationError =
  | AutomationFlowInvalid
  | AutomationScheduleMinutesNotAllowed
  | AutomationCalendarNeverOccurs;

type AutomationActivationError =
  | WorkingCopyError
  | FlowValidationError
  | AutomationArchived
  | AutomationPreviewRequired
  | AutomationDraftChanged
  | CampaignAudienceArchived
  | AudienceFilterContextInvalid
  | CampaignFallbackContentMissing;

export interface IAutomationLifecycle {
  /** The automation's lifecycle, working copy and activation readiness. */
  readonly get: (
    campaignId: CampaignId
  ) => Effect.Effect<AutomationDetail, WorkingCopyError>;
  /**
   * Replaces the working copy with the validated, canonical flow. Any
   * status but archived can be edited; published versions never change.
   */
  readonly updateFlow: (input: {
    readonly campaignId: CampaignId;
    readonly flow: AutomationFlow;
  }) => Effect.Effect<
    AutomationDetail,
    WorkingCopyError | FlowValidationError | AutomationArchived
  >;
  /**
   * Publishes the working copy that a completed dry run of this campaign
   * evaluated (design §7.5). A retry returns the version it published.
   */
  readonly activate: (input: {
    readonly campaignId: CampaignId;
    readonly previewId: AutomationPreviewId;
    /** The administrator activating; null when the account is unknown. */
    readonly activatedBy: CustomerAccountId | null;
  }) => Effect.Effect<AutomationVersionSummary, AutomationActivationError>;
  /** Active → paused (D12); repeating it returns the current state. */
  readonly pause: (
    campaignId: CampaignId
  ) => Effect.Effect<
    AutomationDetail,
    WorkingCopyError | AutomationArchived | AutomationStatusConflict
  >;
  /** Paused → active (D12); repeating it returns the current state. */
  readonly resume: (
    campaignId: CampaignId
  ) => Effect.Effect<
    AutomationDetail,
    WorkingCopyError | AutomationArchived | AutomationStatusConflict
  >;
  /**
   * Any status → archived, for good (D12); active runs end `archived`.
   * Repeating it returns the current state.
   */
  readonly archive: (
    campaignId: CampaignId
  ) => Effect.Effect<AutomationDetail, WorkingCopyError>;
  /** Published versions, newest first. */
  readonly listVersions: (
    campaignId: CampaignId
  ) => Effect.Effect<readonly AutomationVersionSummary[], WorkingCopyError>;
  readonly getVersion: (input: {
    readonly campaignId: CampaignId;
    readonly versionNumber: number;
  }) => Effect.Effect<
    AutomationVersionDetail,
    WorkingCopyError | AutomationVersionNotFound
  >;
}

/**
 * The lifecycle of automated campaigns: edits to the working copy,
 * activation behind the dry-run gate, pause, resume and archive. It's the
 * only writer of an automated campaign's `status`, always under the
 * lifecycle lock (§5.4).
 */
export class AutomationLifecycle extends Context.Service<
  AutomationLifecycle,
  IAutomationLifecycle
>()("@deskohub-workspace/email-campaigns/AutomationLifecycle") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const get = Effect.fn("AutomationLifecycle.get")(function* (
        campaignId: CampaignId
      ) {
        return yield* db.transaction((tx) => readDetail(tx, campaignId));
      });

      const updateFlow = Effect.fn("AutomationLifecycle.updateFlow")(
        function* (input: {
          readonly campaignId: CampaignId;
          readonly flow: AutomationFlow;
        }) {
          return yield* db.transaction((tx) =>
            Effect.Do.pipe(
              Effect.tap(() =>
                lockAutomationForLifecycle(tx, input.campaignId)
              ),
              Effect.bind("copy", () =>
                loadAutomationWorkingCopy(tx, input.campaignId)
              ),
              Effect.tap(({ copy }) => ensureNotArchived(copy)),
              Effect.bind("flow", () =>
                validatePublishableFlow(tx, input.flow)
              ),
              Effect.tap(({ flow }) =>
                tx
                  .update(emailCampaignAutomations)
                  .set({ flow, updatedAt: sql`now()` })
                  .where(
                    eq(emailCampaignAutomations.campaignId, input.campaignId)
                  )
              ),
              Effect.flatMap(() => readDetail(tx, input.campaignId))
            )
          );
        }
      );

      const activate = Effect.fn("AutomationLifecycle.activate")(
        function* (input: {
          readonly campaignId: CampaignId;
          readonly previewId: AutomationPreviewId;
          readonly activatedBy: CustomerAccountId | null;
        }) {
          return yield* db.transaction((tx) => activateIn(tx, input));
        }
      );

      const transition = <E>(
        name: string,
        apply: (
          tx: AutomationEngineTransaction,
          input: TransitionInput
        ) => Effect.Effect<void, DatabaseQueryError | E>
      ) =>
        Effect.fn(name)(function* (campaignId: CampaignId) {
          return yield* db.transaction((tx) =>
            Effect.Do.pipe(
              Effect.tap(() => lockAutomationForLifecycle(tx, campaignId)),
              // Sampled under the lock, so no engine commit that held it
              // first can postdate the operation (§5.4).
              Effect.bind("now", () => lifecycleInstant),
              Effect.bind("copy", () =>
                loadAutomationWorkingCopy(tx, campaignId)
              ),
              Effect.tap(({ copy, now }) => apply(tx, { copy, now })),
              Effect.flatMap(() => readDetail(tx, campaignId))
            )
          );
        });

      const listVersions = Effect.fn("AutomationLifecycle.listVersions")(
        function* (campaignId: CampaignId) {
          return yield* db.transaction((tx) =>
            loadAutomationWorkingCopy(tx, campaignId).pipe(
              Effect.flatMap((copy) =>
                selectVersions(tx, {
                  campaignId,
                  activeVersionId: copy.automation.activeVersionId,
                })
              ),
              Effect.map((versions) => versions.map(toVersionSummary))
            )
          );
        }
      );

      const getVersion = Effect.fn("AutomationLifecycle.getVersion")(
        function* (input: {
          readonly campaignId: CampaignId;
          readonly versionNumber: number;
        }) {
          return yield* db.transaction((tx) =>
            loadAutomationWorkingCopy(tx, input.campaignId).pipe(
              Effect.flatMap((copy) =>
                selectVersions(tx, {
                  campaignId: input.campaignId,
                  activeVersionId: copy.automation.activeVersionId,
                  versionNumber: input.versionNumber,
                })
              ),
              Effect.flatMap(([version]) =>
                version === undefined
                  ? Effect.fail(new AutomationVersionNotFound(input))
                  : Effect.succeed(toVersionDetail(version))
              )
            )
          );
        }
      );

      return {
        get,
        updateFlow,
        activate,
        pause: transition("AutomationLifecycle.pause", pauseIn),
        resume: transition("AutomationLifecycle.resume", resumeIn),
        archive: transition("AutomationLifecycle.archive", archiveIn),
        listVersions,
        getVersion,
      } satisfies IAutomationLifecycle;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}

/** The instant a lifecycle operation records, at microsecond precision. */
const lifecycleInstant = Effect.map(currentInstant, toStoredInstant);

// --- Activation (§7.5) ------------------------------------------------------

const activateIn = (
  tx: AutomationEngineTransaction,
  input: {
    readonly campaignId: CampaignId;
    readonly previewId: AutomationPreviewId;
    readonly activatedBy: CustomerAccountId | null;
  }
) =>
  Effect.Do.pipe(
    // 1. The lifecycle lock, then the instant and working copy as of its
    // grant: an occurrence a unit committed under v1 while this waited
    // precedes `activated_at` (§5.10).
    Effect.tap(() => lockAutomationForLifecycle(tx, input.campaignId)),
    Effect.bind("now", () => lifecycleInstant),
    Effect.bind("copy", () => loadAutomationWorkingCopy(tx, input.campaignId)),
    Effect.tap(({ copy }) => ensureNotArchived(copy)),
    // 2. A completed dry run of this campaign.
    Effect.bind("previewHash", () => completedPreviewHash(tx, input)),
    // 3. Of the current draft.
    Effect.bind("publishable", ({ copy, previewHash }) =>
      currentPublishable(copy).pipe(
        Option.filter(({ draftHash }) => draftHash === previewHash),
        Option.match({
          onNone: () =>
            Effect.fail(
              new AutomationDraftChanged({
                campaignId: input.campaignId,
                previewId: input.previewId,
              })
            ),
          onSome: Effect.succeed,
        })
      )
    ),
    // 4. Still publishable.
    Effect.bind("flow", ({ copy, publishable }) =>
      validateActivation(tx, { copy, publishable })
    ),
    // 5. A retry returns the version it published.
    Effect.bind("latest", () => latestVersion(tx, input.campaignId)),
    Effect.flatMap(({ copy, publishable, flow, latest, now }) =>
      latest.pipe(
        Option.filter(({ draftHash }) => draftHash === publishable.draftHash),
        Option.match({
          onSome: ({ id }) => Effect.succeed(id),
          onNone: () =>
            publishVersion(tx, {
              copy,
              publishable,
              flow,
              latest,
              activatedBy: input.activatedBy,
              now,
            }),
        })
      )
    ),
    Effect.flatMap((versionId) =>
      selectVersions(tx, {
        campaignId: input.campaignId,
        activeVersionId: versionId,
        versionId,
      })
    ),
    Effect.flatMap(([version]) =>
      version === undefined
        ? Effect.die(
            new Error("The activated version vanished in its transaction.")
          )
        : Effect.succeed(toVersionSummary(version))
    )
  );

/** The draft hash of the named dry run, if it's a completed one of this campaign. */
const completedPreviewHash = (
  tx: AutomationEngineTransaction,
  input: {
    readonly campaignId: CampaignId;
    readonly previewId: AutomationPreviewId;
  }
) =>
  tx
    .select({ draftHash: emailCampaignAutomationPreviews.draftHash })
    .from(emailCampaignAutomationPreviews)
    .where(
      and(
        eq(emailCampaignAutomationPreviews.id, input.previewId),
        eq(emailCampaignAutomationPreviews.campaignId, input.campaignId),
        eq(emailCampaignAutomationPreviews.status, "completed")
      )
    )
    .pipe(
      Effect.flatMap(([preview]) =>
        preview === undefined
          ? Effect.fail(new AutomationPreviewRequired(input))
          : Effect.succeed(preview.draftHash)
      )
    );

type Publishable = {
  readonly flow: AutomationFlow;
  readonly audience: NonNullable<
    Option.Option.Value<AutomationWorkingCopy["audience"]>
  >;
  readonly draftHash: AutomationDraftHash;
};

const currentPublishable = (
  copy: AutomationWorkingCopy
): Option.Option<Publishable> =>
  Option.all({
    flow: copy.flow,
    audience: copy.audience,
    draftHash: copy.draftHash,
  });

/**
 * Step 4: a non-archived audience, content covering it with the one-off
 * rules, a valid flow whose calendars occur, and every referenced audience
 * and campaign present. Returns the canonical flow to publish.
 */
const validateActivation = (
  tx: AutomationEngineTransaction,
  input: {
    readonly copy: AutomationWorkingCopy;
    readonly publishable: Publishable;
  }
) =>
  Effect.Do.pipe(
    Effect.tap(() =>
      input.publishable.audience.archivedAt === null
        ? Effect.void
        : Effect.fail(
            new CampaignAudienceArchived({
              audienceId: input.publishable.audience.id,
            })
          )
    ),
    Effect.tap(() =>
      ensureSavedAudienceFilter(input.publishable.audience.filter)
    ),
    Effect.tap(() =>
      campaignContentCoversAudience({
        content: input.copy.campaign.content,
        audienceFilter: Option.some(input.publishable.audience.filter),
      })
        ? Effect.void
        : Effect.fail(
            new CampaignFallbackContentMissing({
              campaignId: input.copy.campaign.id,
            })
          )
    ),
    Effect.flatMap(() => validatePublishableFlow(tx, input.publishable.flow))
  );

/** The flow rules (§2, §3.3, §4.5) plus the database check of its references. */
const validatePublishableFlow = (
  tx: AutomationEngineTransaction,
  flow: AutomationFlow
) =>
  validateAutomationFlow(flow).pipe(
    Effect.tap((validated) => ensureReferencesExist(tx, validated))
  );

const ensureReferencesExist = (
  tx: AutomationEngineTransaction,
  flow: AutomationFlow
) => {
  const { savedAudienceIds, campaignIds } = automationFlowReferences(flow);
  return Effect.all(
    {
      audiences:
        savedAudienceIds.length === 0
          ? Effect.succeed([])
          : tx
              .select({ id: emailCampaignAudiences.id })
              .from(emailCampaignAudiences)
              .where(inArray(emailCampaignAudiences.id, [...savedAudienceIds]))
              // Held until commit, so deleting a referenced audience waits
              // for this write and then sees the reference (audience-in-use).
              .for("share"),
      campaigns:
        campaignIds.length === 0
          ? Effect.succeed([])
          : tx
              .select({ id: emailCampaigns.id })
              .from(emailCampaigns)
              .where(inArray(emailCampaigns.id, [...campaignIds])),
    },
    { concurrency: "inherit" }
  ).pipe(
    Effect.flatMap(({ audiences, campaigns }) => {
      const missingAudiences = missingIds(savedAudienceIds, audiences);
      const missingCampaigns = missingIds(campaignIds, campaigns);
      return missingAudiences.length === 0 && missingCampaigns.length === 0
        ? Effect.void
        : Effect.fail(
            new AutomationFlowInvalid({
              message: [
                missingAudiences.length > 0 &&
                  `The flow's conditions name saved audiences that don't exist: ${missingAudiences.join(", ")}.`,
                missingCampaigns.length > 0 &&
                  `The flow's conditions name campaigns that don't exist: ${missingCampaigns.join(", ")}.`,
              ]
                .filter(Boolean)
                .join(" "),
            })
          );
    })
  );
};

const missingIds = <Id extends string>(
  wanted: readonly Id[],
  found: readonly { readonly id: Id }[]
) => {
  const present = new Set<string>(found.map(({ id }) => id));
  return wanted.filter((id) => !present.has(id));
};

const latestVersion = (
  tx: AutomationEngineTransaction,
  campaignId: CampaignId
) =>
  tx
    .select({
      id: emailCampaignAutomationVersions.id,
      versionNumber: emailCampaignAutomationVersions.versionNumber,
      draftHash: emailCampaignAutomationVersions.draftHash,
      activatedAt: emailCampaignAutomationVersions.activatedAt,
    })
    .from(emailCampaignAutomationVersions)
    .where(eq(emailCampaignAutomationVersions.campaignId, campaignId))
    .orderBy(desc(emailCampaignAutomationVersions.versionNumber))
    .limit(1)
    .pipe(Effect.map(([version]) => Option.fromNullishOr(version)));

/**
 * Steps 6 and 7: inserts version n + 1 with its provenance, points the
 * automation at it, and applies the status and schedule rules.
 */
const publishVersion = (
  tx: AutomationEngineTransaction,
  input: {
    readonly copy: AutomationWorkingCopy;
    readonly publishable: Publishable;
    readonly flow: AutomationFlow;
    readonly latest: Option.Option<
      Option.Option.Value<Effect.Success<ReturnType<typeof latestVersion>>>
    >;
    readonly activatedBy: CustomerAccountId | null;
    readonly now: Temporal.Instant;
  }
) => {
  const { campaign, automation } = input.copy;
  // `activated_at` orders versions, so it's strictly after the previous one's.
  const activatedAt = input.latest.pipe(
    Option.filter(
      ({ activatedAt }) => Temporal.Instant.compare(activatedAt, input.now) >= 0
    ),
    Option.match({
      onNone: () => input.now,
      onSome: ({ activatedAt }) => activatedAt.add({ microseconds: 1 }),
    })
  );
  return Effect.Do.pipe(
    Effect.bind("versionId", () =>
      tx
        .insert(emailCampaignAutomationVersions)
        .values({
          campaignId: campaign.id,
          versionNumber: Option.match(input.latest, {
            onNone: () => 1,
            onSome: ({ versionNumber }) => versionNumber + 1,
          }),
          flow: input.flow,
          purpose: campaign.purpose,
          templateKey: campaign.templateKey,
          content: campaign.content,
          contentHash: hashCampaignContent({
            purpose: campaign.purpose,
            templateKey: campaign.templateKey,
            locales: campaign.content,
          }),
          audienceFilter: input.publishable.audience.filter,
          draftHash: input.publishable.draftHash,
          activatedAt,
        })
        .returning({ id: emailCampaignAutomationVersions.id })
        .pipe(
          Effect.flatMap(([version]) =>
            version === undefined
              ? Effect.die(new Error("The version insert returned no row."))
              : Effect.succeed(version.id)
          )
        )
    ),
    Effect.tap(({ versionId }) =>
      tx.insert(emailCampaignAutomationVersionProvenance).values({
        versionId,
        audienceId: input.publishable.audience.id,
        activatedByAccountId: input.activatedBy,
      })
    ),
    Effect.bind("nextFireAt", () =>
      loadAutomationVersionActivations(tx, campaign.id).pipe(
        Effect.map((versions) =>
          nextFireAt({
            status: campaign.status,
            currentNextFireAt: automation.nextFireAt,
            fireAfter: (after) => nextFireAfter(versions, after),
            now: activatedAt,
          })
        )
      )
    ),
    Effect.tap(({ versionId, nextFireAt }) =>
      tx
        .update(emailCampaignAutomations)
        .set({
          activeVersionId: versionId,
          nextFireAt,
          ...(campaign.status === "draft" && { acceptingSince: activatedAt }),
          updatedAt: sql`now()`,
        })
        .where(eq(emailCampaignAutomations.campaignId, campaign.id))
    ),
    Effect.tap(() =>
      campaign.status === "draft"
        ? tx
            .update(emailCampaigns)
            .set({ status: "active", updatedAt: sql`now()` })
            .where(eq(emailCampaigns.id, campaign.id))
            .pipe(Effect.asVoid)
        : Effect.void
    ),
    Effect.map(({ versionId }) => versionId)
  );
};

/**
 * The schedule rule of activation (§5.10, §7.5 step 7). A first activation
 * schedules the next fire; a paused automation keeps none until it resumes;
 * an active one keeps a due backlog, whose fires switch calendars at the
 * new activation, and otherwise follows the new version from now.
 */
const nextFireAt = (input: {
  readonly status: AutomationWorkingCopy["campaign"]["status"];
  readonly currentNextFireAt: Temporal.Instant | null;
  readonly fireAfter: (
    after: Temporal.Instant
  ) => Option.Option<Temporal.Instant>;
  readonly now: Temporal.Instant;
}): Temporal.Instant | null => {
  if (input.status === "paused") return null;
  if (
    input.status === "active" &&
    input.currentNextFireAt !== null &&
    Temporal.Instant.compare(input.currentNextFireAt, input.now) <= 0
  ) {
    return input.currentNextFireAt;
  }
  return Option.getOrNull(input.fireAfter(input.now));
};

// --- Pause, resume, archive (§5.10) -----------------------------------------

type TransitionInput = {
  readonly copy: AutomationWorkingCopy;
  readonly now: Temporal.Instant;
};

type TransitionError =
  | DatabaseQueryError
  | AutomationArchived
  | AutomationStatusConflict;

const ensureNotArchived = (copy: AutomationWorkingCopy) =>
  copy.campaign.status === "archived"
    ? Effect.fail(new AutomationArchived({ campaignId: copy.campaign.id }))
    : Effect.void;

const statusConflict = (
  copy: AutomationWorkingCopy,
  operation: "pause" | "resume"
) =>
  new AutomationStatusConflict({
    campaignId: copy.campaign.id,
    operation,
    status: copy.campaign.status,
  });

const pauseIn = (
  tx: AutomationEngineTransaction,
  { copy, now }: TransitionInput
): Effect.Effect<void, TransitionError> => {
  const campaignId = copy.campaign.id;
  switch (copy.campaign.status) {
    case "paused":
      return Effect.void;
    case "archived":
      return Effect.fail(new AutomationArchived({ campaignId }));
    case "draft":
      return Effect.fail(statusConflict(copy, "pause"));
    case "active":
      return Effect.all(
        [
          tx
            .update(emailCampaigns)
            .set({ status: "paused", updatedAt: sql`now()` })
            .where(eq(emailCampaigns.id, campaignId)),
          tx
            .update(emailCampaignAutomations)
            .set({
              pausedAt: now,
              acceptingSince: null,
              nextFireAt: null,
              updatedAt: sql`now()`,
            })
            .where(eq(emailCampaignAutomations.campaignId, campaignId)),
          dropEnteringFire(tx, { campaignId, now }),
          // A dry run doesn't depend on the status, so pause leaves it running.
          stopUnits(tx, { campaignId, now, exceptPreviews: true }),
        ],
        { discard: true }
      );
  }
};

const resumeIn = (
  tx: AutomationEngineTransaction,
  { copy, now }: TransitionInput
): Effect.Effect<void, TransitionError> => {
  const campaignId = copy.campaign.id;
  switch (copy.campaign.status) {
    case "active":
      return Effect.void;
    case "archived":
      return Effect.fail(new AutomationArchived({ campaignId }));
    case "draft":
      return Effect.fail(statusConflict(copy, "resume"));
    case "paused":
      return loadAutomationVersionActivations(tx, campaignId).pipe(
        Effect.flatMap((versions) =>
          Effect.all(
            [
              tx
                .update(emailCampaigns)
                .set({ status: "active", updatedAt: sql`now()` })
                .where(eq(emailCampaigns.id, campaignId)),
              tx
                .update(emailCampaignAutomations)
                .set({
                  resumedAt: now,
                  acceptingSince: now,
                  // Fires that fell due while paused are never entered (D12).
                  nextFireAt: Option.getOrNull(nextFireAfter(versions, now)),
                  updatedAt: sql`now()`,
                })
                .where(eq(emailCampaignAutomations.campaignId, campaignId)),
            ],
            { discard: true }
          )
        )
      );
  }
};

const archiveIn = (
  tx: AutomationEngineTransaction,
  { copy, now }: TransitionInput
): Effect.Effect<void, DatabaseQueryError> => {
  const campaignId = copy.campaign.id;
  return copy.campaign.status === "archived"
    ? Effect.void
    : Effect.all(
        [
          tx
            .update(emailCampaigns)
            .set({ status: "archived", updatedAt: sql`now()` })
            .where(eq(emailCampaigns.id, campaignId)),
          tx
            .update(emailCampaignAutomations)
            .set({
              archivedAt: now,
              acceptingSince: null,
              nextFireAt: null,
              updatedAt: sql`now()`,
            })
            .where(eq(emailCampaignAutomations.campaignId, campaignId)),
          dropEnteringFire(tx, { campaignId, now }),
          // Runs before units, in the lock order of §5.4.
          endActiveRuns(tx, { campaignId, now }),
          stopUnits(tx, { campaignId, now, exceptPreviews: false }),
          closeRunningPreview(tx, { campaignId, now }),
        ],
        { discard: true }
      );
};

/** An archived automation can't activate, so its running dry run ends. */
const closeRunningPreview = (
  tx: AutomationEngineTransaction,
  input: { readonly campaignId: CampaignId; readonly now: Temporal.Instant }
): Effect.Effect<void, DatabaseQueryError> =>
  tx
    .select({ id: emailCampaignAutomationPreviews.id })
    .from(emailCampaignAutomationPreviews)
    .where(
      and(
        eq(emailCampaignAutomationPreviews.campaignId, input.campaignId),
        eq(emailCampaignAutomationPreviews.status, "running")
      )
    )
    .pipe(
      Effect.flatMap((running) =>
        Effect.forEach(running, ({ id }) =>
          closePreview(tx, {
            previewId: id,
            status: "failed",
            errorCode: AutomationArchived.code,
            at: input.now,
          })
        )
      ),
      Effect.asVoid
    );

/** Pause and archive close the fire being entered; runs it started keep going. */
const dropEnteringFire = (
  tx: AutomationEngineTransaction,
  input: { readonly campaignId: CampaignId; readonly now: Temporal.Instant }
) =>
  tx
    .update(emailCampaignAutomationScheduleFires)
    .set({ status: "dropped", settledAt: input.now })
    .where(
      and(
        eq(emailCampaignAutomationScheduleFires.campaignId, input.campaignId),
        eq(emailCampaignAutomationScheduleFires.status, "entering")
      )
    );

/**
 * Drops the automation's planned units, which hold no slot, after
 * releasing their subjects for replanning; marks its enqueued and claimed
 * units for cancellation, which frees no slot until their claimant or the
 * reaper settles them and releases their subjects (§5.10). A deliver unit
 * with a persisted batch is never touched: it's the batch's only recovery
 * path (§5.9). Lifecycle-owned units are campaign-scoped, so sweep pages
 * and intake units are never touched either.
 */
const stopUnits = (
  tx: AutomationEngineTransaction,
  input: {
    readonly campaignId: CampaignId;
    readonly now: Temporal.Instant;
    readonly exceptPreviews: boolean;
  }
): Effect.Effect<void, DatabaseQueryError> => {
  const owned = and(
    eq(emailCampaignAutomationWorkUnits.campaignId, input.campaignId),
    isNull(emailCampaignAutomationWorkUnits.sendId),
    input.exceptPreviews
      ? ne(emailCampaignAutomationWorkUnits.kind, "preview")
      : undefined
  );
  return Effect.Do.pipe(
    Effect.bind("planned", () =>
      tx
        .select({
          id: emailCampaignAutomationWorkUnits.id,
          subject: emailCampaignAutomationWorkUnits.subject,
        })
        .from(emailCampaignAutomationWorkUnits)
        .where(
          and(owned, eq(emailCampaignAutomationWorkUnits.status, "planned"))
        )
    ),
    Effect.tap(({ planned }) => releaseAutomationUnitSubjects(tx, planned)),
    Effect.tap(({ planned }) =>
      planned.length === 0
        ? Effect.void
        : tx
            .update(emailCampaignAutomationWorkUnits)
            .set({ status: "dropped", settledAt: input.now })
            .where(
              and(
                inArray(
                  emailCampaignAutomationWorkUnits.id,
                  planned.map(({ id }) => id)
                ),
                eq(emailCampaignAutomationWorkUnits.status, "planned")
              )
            )
            .pipe(Effect.asVoid)
    ),
    Effect.tap(() =>
      tx
        .update(emailCampaignAutomationWorkUnits)
        .set({ cancelRequestedAt: input.now })
        .where(
          and(
            owned,
            inArray(emailCampaignAutomationWorkUnits.status, [
              "enqueued",
              "claimed",
            ]),
            isNull(emailCampaignAutomationWorkUnits.cancelRequestedAt)
          )
        )
    ),
    Effect.asVoid
  );
};

/** Archive ends every active run; sending runs settle with their batch. */
const endActiveRuns = (
  tx: AutomationEngineTransaction,
  input: { readonly campaignId: CampaignId; readonly now: Temporal.Instant }
): Effect.Effect<void, DatabaseQueryError> =>
  tx
    .select({ id: emailCampaignAutomationRuns.id })
    .from(emailCampaignAutomationRuns)
    .where(
      and(
        eq(emailCampaignAutomationRuns.campaignId, input.campaignId),
        eq(emailCampaignAutomationRuns.status, "active")
      )
    )
    .pipe(
      Effect.flatMap((runs) =>
        runs.length === 0
          ? Effect.void
          : AutomationRunTransitions.end(tx, {
              runIds: runs.map(({ id }) => id),
              expect: { status: "active" },
              outcome: "archived",
              at: input.now,
            })
      ),
      Effect.asVoid
    );

// --- Reads ------------------------------------------------------------------

const readDetail = (
  tx: AutomationEngineTransaction,
  campaignId: CampaignId
): Effect.Effect<AutomationDetail, WorkingCopyError> =>
  Effect.Do.pipe(
    Effect.bind("copy", () => loadAutomationWorkingCopy(tx, campaignId)),
    Effect.bind("activeVersion", ({ copy }) =>
      copy.automation.activeVersionId === null
        ? Effect.succeed(Option.none<VersionRow>())
        : selectVersions(tx, {
            campaignId,
            activeVersionId: copy.automation.activeVersionId,
            versionId: copy.automation.activeVersionId,
          }).pipe(Effect.map(([version]) => Option.fromNullishOr(version)))
    ),
    Effect.bind("versionCount", () =>
      tx
        .select({ versions: count() })
        .from(emailCampaignAutomationVersions)
        .where(eq(emailCampaignAutomationVersions.campaignId, campaignId))
        .pipe(Effect.map(([row]) => row?.versions ?? 0))
    ),
    Effect.bind("activation", ({ copy, activeVersion }) =>
      activationOf(tx, { copy, activeVersion })
    ),
    Effect.map(
      ({
        copy,
        activeVersion,
        versionCount,
        activation,
      }): AutomationDetail => ({
        campaignId,
        status: copy.campaign.status,
        flow: Option.getOrNull(copy.flow),
        trigger: copy.flow.pipe(
          Option.map(({ trigger }) => automationTriggerSummary(trigger)),
          Option.getOrNull
        ),
        activeVersion: activeVersion.pipe(
          Option.map(toVersionSummary),
          Option.getOrNull
        ),
        versionCount,
        pendingChanges: Option.exists(
          activeVersion,
          ({ draftHash }) => !Option.contains(copy.draftHash, draftHash)
        ),
        activation,
        acceptingSince: copy.automation.acceptingSince?.toString() ?? null,
        pausedAt: copy.automation.pausedAt?.toString() ?? null,
        archivedAt: copy.automation.archivedAt?.toString() ?? null,
        nextFireAt: copy.automation.nextFireAt?.toString() ?? null,
        updatedAt: copy.automation.updatedAt.toString(),
      })
    )
  );

/**
 * The activation rule as adapters gate on it (§7.5): published when the
 * working copy equals the active version, else the latest dry run of the
 * current draft, running or completed. An archived automation is never
 * ready.
 */
const activationOf = (
  tx: AutomationEngineTransaction,
  input: {
    readonly copy: AutomationWorkingCopy;
    readonly activeVersion: Option.Option<VersionRow>;
  }
): Effect.Effect<AutomationActivation, DatabaseQueryError> => {
  const { draftHash } = input.copy;
  if (
    Option.exists(input.activeVersion, (version) =>
      Option.contains(draftHash, version.draftHash)
    )
  ) {
    return Effect.succeed({ _tag: "Published" });
  }
  if (Option.isNone(draftHash) || input.copy.campaign.status === "archived") {
    return Effect.succeed({ _tag: "PreviewRequired" });
  }
  return tx
    .select({
      id: emailCampaignAutomationPreviews.id,
      status: emailCampaignAutomationPreviews.status,
      unitsDone: emailCampaignAutomationPreviews.unitsDone,
      unitsTotal: emailCampaignAutomationPreviews.unitsTotal,
    })
    .from(emailCampaignAutomationPreviews)
    .where(
      and(
        eq(emailCampaignAutomationPreviews.campaignId, input.copy.campaign.id),
        eq(emailCampaignAutomationPreviews.draftHash, draftHash.value),
        inArray(emailCampaignAutomationPreviews.status, [
          "running",
          "completed",
        ])
      )
    )
    .orderBy(desc(emailCampaignAutomationPreviews.createdAt))
    .limit(1)
    .pipe(
      Effect.map(([preview]): AutomationActivation => {
        if (preview === undefined) return { _tag: "PreviewRequired" };
        return preview.status === "completed"
          ? {
              _tag: "Ready",
              previewId: preview.id,
              draftHash: draftHash.value,
            }
          : {
              _tag: "PreviewRunning",
              previewId: preview.id,
              unitsDone: preview.unitsDone,
              unitsTotal: preview.unitsTotal,
            };
      })
    );
};

const selectVersions = (
  tx: AutomationEngineTransaction,
  input: {
    readonly campaignId: CampaignId;
    readonly activeVersionId: AutomationVersionId | null;
    readonly versionId?: AutomationVersionId;
    readonly versionNumber?: number;
  }
) => {
  return tx
    .select({
      id: emailCampaignAutomationVersions.id,
      campaignId: emailCampaignAutomationVersions.campaignId,
      versionNumber: emailCampaignAutomationVersions.versionNumber,
      flow: emailCampaignAutomationVersions.flow,
      purpose: emailCampaignAutomationVersions.purpose,
      templateKey: emailCampaignAutomationVersions.templateKey,
      content: emailCampaignAutomationVersions.content,
      audienceFilter: emailCampaignAutomationVersions.audienceFilter,
      draftHash: emailCampaignAutomationVersions.draftHash,
      activatedAt: emailCampaignAutomationVersions.activatedAt,
      audienceId: emailCampaignAutomationVersionProvenance.audienceId,
      activatedByEmail: authUser.email,
    })
    .from(emailCampaignAutomationVersions)
    .leftJoin(
      emailCampaignAutomationVersionProvenance,
      eq(
        emailCampaignAutomationVersionProvenance.versionId,
        emailCampaignAutomationVersions.id
      )
    )
    .leftJoin(
      authUser,
      eq(
        authUser.id,
        emailCampaignAutomationVersionProvenance.activatedByAccountId
      )
    )
    .where(
      and(
        eq(emailCampaignAutomationVersions.campaignId, input.campaignId),
        input.versionId === undefined
          ? undefined
          : eq(emailCampaignAutomationVersions.id, input.versionId),
        input.versionNumber === undefined
          ? undefined
          : eq(
              emailCampaignAutomationVersions.versionNumber,
              input.versionNumber
            )
      )
    )
    .orderBy(desc(emailCampaignAutomationVersions.versionNumber))
    .pipe(
      // Versions were validated when published, so an undecodable flow is a defect.
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) =>
          decodeVersionFlow(row.flow).pipe(
            Effect.orDie,
            Effect.map(
              (flow): VersionRow => ({
                ...row,
                flow,
                active: row.id === input.activeVersionId,
              })
            )
          )
        )
      )
    );
};

type VersionRow = {
  readonly id: AutomationVersionId;
  readonly campaignId: CampaignId;
  readonly versionNumber: number;
  readonly flow: AutomationFlow;
  readonly purpose: CampaignPurpose;
  readonly templateKey: CampaignTemplateKey;
  readonly content: CampaignLocalizedContent;
  readonly audienceFilter: AudienceFilter;
  readonly draftHash: string;
  readonly activatedAt: Temporal.Instant;
  readonly audienceId: CampaignAudienceId | null;
  readonly activatedByEmail: string | null;
  readonly active: boolean;
};

const decodeVersionFlow = Schema.decodeUnknownEffect(
  automationFlowContractSchema
);

const toVersionSummary = (version: VersionRow): AutomationVersionSummary => ({
  campaignId: version.campaignId,
  versionNumber: version.versionNumber,
  trigger: automationTriggerSummary(version.flow.trigger),
  draftHash: version.draftHash,
  activatedAt: version.activatedAt.toString(),
  audienceId: version.audienceId,
  activatedByEmail: version.activatedByEmail,
  active: version.active,
});

const toVersionDetail = (version: VersionRow): AutomationVersionDetail => ({
  ...toVersionSummary(version),
  flow: version.flow,
  purpose: version.purpose,
  templateKey: version.templateKey,
  content: Object.fromEntries(
    Object.entries(version.content).map(([locale, { body, ...texts }]) => [
      locale,
      { ...texts, bodyMarkdown: campaignBodyToMarkdown(body) },
    ])
  ),
  audienceFilter: version.audienceFilter,
});
