import "server-only";

import type { CampaignPatchInput } from "@deskohub/workspace-admin-api";
import { and, desc, eq, ne, notExists, or } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type CampaignRow,
  emailCampaignAudiences,
  emailCampaignAutomations,
  emailCampaignAutomationVersions,
  emailCampaigns,
} from "@/db/schema";
import { currentInstant } from "@/shared/utils/temporal";
import {
  ensureSavedAudienceFilter,
  isSavedAudienceFilter,
} from "../audience-filter-usage";
import { validateStoredAutomationFlow } from "../automation/backend/automation-working-copy";
import type {
  AutomationCalendarNeverOccurs,
  AutomationFlowInvalid,
  AutomationScheduleMinutesNotAllowed,
} from "../automation/errors";
import {
  CampaignLocalizedContent,
  type CampaignPurpose,
  type CampaignTemplateKey,
} from "../body/campaign-content";
import {
  type CampaignContentChanges,
  changeCampaignContent,
} from "../body/campaign-content-change";
import type { CampaignAudienceId, CampaignId } from "../campaign-identifiers";
import {
  type CampaignDelivery,
  isOnceCampaign,
  type OnceCampaignStatus,
} from "../campaign-states";
import {
  type AudienceFilterContextInvalid,
  CampaignAudienceArchived,
  CampaignAudienceNotFound,
  type CampaignBodyDocumentInvalid,
  type CampaignBodyMarkdownInvalid,
  CampaignContentInvalid,
  CampaignDeliveryMismatch,
  type CampaignLocaleContentMissing,
  CampaignNotFound,
  CampaignPublished,
  CampaignReadOnly,
} from "../errors";

type Campaign = CampaignRow;

/** A campaign that sends once; only these can be sent or duplicated. */
type OnceCampaign = Campaign & {
  readonly delivery: "once";
  readonly status: OnceCampaignStatus;
};

type CampaignDraftInput = {
  readonly title: string;
  readonly purpose: CampaignPurpose;
  readonly templateKey: CampaignTemplateKey;
  readonly content: CampaignLocalizedContent;
  readonly audienceId: CampaignAudienceId | null;
};

type CampaignEdit = {
  readonly campaignId: CampaignId;
} & Partial<CampaignDraftInput>;

type CampaignWriteError =
  | CampaignAudienceNotFound
  | CampaignAudienceArchived
  | AudienceFilterContextInvalid
  | CampaignContentInvalid;

/** The automation row of an automated campaign, as a copy inherits it. */
type AutomationWorkingCopy = Pick<
  typeof emailCampaignAutomations.$inferSelect,
  "flow"
>;

type CampaignTransactionError = EffectDrizzleQueryError | SqlError.SqlError;

type CampaignEditError =
  | CampaignNotFound
  | CampaignReadOnly
  | CampaignWriteError
  | CampaignTransactionError;

/** One-off campaigns are editable in Draft, automated ones until archived. */
const isEditable = (campaign: Campaign) =>
  campaign.delivery === "automated"
    ? campaign.status !== "archived"
    : campaign.status === "draft";

const editable = or(
  and(eq(emailCampaigns.delivery, "once"), eq(emailCampaigns.status, "draft")),
  and(
    eq(emailCampaigns.delivery, "automated"),
    ne(emailCampaigns.status, "archived")
  )
);

export interface ICampaignService {
  readonly list: Effect.Effect<readonly Campaign[], EffectDrizzleQueryError>;
  readonly get: (
    campaignId: CampaignId
  ) => Effect.Effect<Campaign, CampaignNotFound | EffectDrizzleQueryError>;
  /** Gets a campaign for a one-off operation, refusing an automated one. */
  readonly getOnce: (
    campaignId: CampaignId
  ) => Effect.Effect<
    OnceCampaign,
    CampaignNotFound | CampaignDeliveryMismatch | EffectDrizzleQueryError
  >;
  /**
   * Creates a Draft, `once` unless `delivery` says otherwise. An automated
   * campaign gets its automation row, with no flow yet, in the same
   * transaction.
   */
  readonly create: (
    input: CampaignDraftInput & { readonly delivery?: CampaignDelivery }
  ) => Effect.Effect<Campaign, CampaignWriteError | CampaignTransactionError>;
  /**
   * Edits a one-off Draft or a non-archived automated campaign; any other
   * campaign is read-only. An automated edit changes only the working copy,
   * never the status or a published version, and serializes with lifecycle
   * operations on the automation's lifecycle lock. A one-off edit's row
   * update waits on a confirmation's campaign row lock and then rechecks the
   * status, so content can't change between a confirmation's content check
   * and its move to Sending.
   */
  readonly update: (
    input: CampaignEdit
  ) => Effect.Effect<Campaign, CampaignEditError>;
  /**
   * Edits a campaign as `update` does, merging per-locale text changes with
   * Markdown or document bodies into its current content: omitted locales and fields
   * keep their value, a locale mapped to null loses its content, and a null
   * `operationalReason` restores the default reason line.
   */
  readonly patch: (
    input: CampaignPatchInput
  ) => Effect.Effect<
    Campaign,
    | CampaignEditError
    | CampaignBodyDocumentInvalid
    | CampaignBodyMarkdownInvalid
    | CampaignLocaleContentMissing
  >;
  /**
   * Deletes a Draft that never published: a one-off campaign that left Draft
   * keeps its history, and an automated one that published a version keeps
   * it for its runs and sends.
   */
  readonly delete: (
    campaignId: CampaignId
  ) => Effect.Effect<
    void,
    | CampaignNotFound
    | CampaignReadOnly
    | CampaignPublished
    | CampaignTransactionError
  >;
  /**
   * Copies a campaign of any status into a new Draft titled "Copy of …" with
   * the same delivery mode; an automated copy also gets the working copy of
   * the flow, step ids included, once it passes the rules a save applies.
   * The copy keeps the source's audience only while it exists, isn't
   * archived, and holds a filter a campaign can use; otherwise the admin
   * picks one.
   */
  readonly duplicate: (
    campaignId: CampaignId
  ) => Effect.Effect<
    Campaign,
    | CampaignNotFound
    | AutomationFlowInvalid
    | AutomationScheduleMinutesNotAllowed
    | AutomationCalendarNeverOccurs
    | CampaignTransactionError
  >;
}

/** Campaign drafts and the read-only record of sent campaigns. */
export class CampaignService extends Context.Service<
  CampaignService,
  ICampaignService
>()("@deskohub-workspace/email-campaigns/CampaignService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const find = (campaignId: CampaignId) =>
        db
          .select()
          .from(emailCampaigns)
          .where(eq(emailCampaigns.id, campaignId))
          .pipe(Effect.map((rows) => Option.fromNullishOr(rows[0])));

      const requireFound =
        (campaignId: CampaignId) => (campaign: Option.Option<Campaign>) =>
          Option.match(campaign, {
            onNone: () => Effect.fail(new CampaignNotFound({ campaignId })),
            onSome: Effect.succeed,
          });

      const get = (campaignId: CampaignId) =>
        find(campaignId).pipe(Effect.flatMap(requireFound(campaignId)));

      const getOnce = (campaignId: CampaignId) =>
        get(campaignId).pipe(
          Effect.filterOrFail(
            isOnceCampaign,
            ({ delivery }) =>
              new CampaignDeliveryMismatch({ campaignId, delivery })
          )
        );

      /** Explains why an edit matched no row. */
      const editRejection = Effect.fn("CampaignService.editRejection")(
        function* (campaignId: CampaignId) {
          const campaign = yield* get(campaignId);
          // An editable campaign misses only when it was deleted meanwhile.
          if (campaign.status === "draft" || isEditable(campaign)) {
            return yield* new CampaignNotFound({ campaignId });
          }
          return yield* new CampaignReadOnly({
            campaignId,
            status: campaign.status,
          });
        }
      );

      /** Explains why a deletion matched no row. */
      const deleteRejection = Effect.fn("CampaignService.deleteRejection")(
        function* (campaignId: CampaignId) {
          const campaign = yield* get(campaignId);
          if (campaign.status !== "draft") {
            return yield* new CampaignReadOnly({
              campaignId,
              status: campaign.status,
            });
          }
          if (campaign.delivery === "automated") {
            return yield* new CampaignPublished({ campaignId });
          }
          return yield* new CampaignNotFound({ campaignId });
        }
      );

      type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

      /**
       * Takes an automated campaign's lifecycle lock for the rest of the
       * transaction; a one-off campaign has no row to lock. Lifecycle
       * operations take it first too, so writes serialize with activation.
       */
      const lockAutomation = (
        tx: Transaction,
        campaignId: CampaignId,
        strength: "update" | "share"
      ) =>
        tx
          .select({ flow: emailCampaignAutomations.flow })
          .from(emailCampaignAutomations)
          .where(eq(emailCampaignAutomations.campaignId, campaignId))
          .for(strength)
          .pipe(Effect.map((rows) => Option.fromNullishOr(rows[0])));

      /**
       * Share-locks the audience row for the rest of the transaction, so the
       * audience can't be archived or deleted before the campaign that
       * references it commits.
       */
      const lockAudience = (tx: Transaction, audienceId: CampaignAudienceId) =>
        tx
          .select({
            archivedAt: emailCampaignAudiences.archivedAt,
            filter: emailCampaignAudiences.filter,
          })
          .from(emailCampaignAudiences)
          .where(eq(emailCampaignAudiences.id, audienceId))
          .for("share")
          .pipe(Effect.map((rows) => Option.fromNullishOr(rows[0])));

      const lockAssignableAudience = Effect.fn(
        "CampaignService.lockAssignableAudience"
      )(function* (tx: Transaction, audienceId: CampaignAudienceId | null) {
        if (audienceId === null) return;
        const audience = yield* lockAudience(tx, audienceId);
        if (Option.isNone(audience)) {
          return yield* new CampaignAudienceNotFound({ audienceId });
        }
        if (audience.value.archivedAt !== null) {
          return yield* new CampaignAudienceArchived({ audienceId });
        }
        yield* ensureSavedAudienceFilter(audience.value.filter);
      });

      /**
       * Keeps the source's audience only if it's still assignable; its flow
       * must pass the rules a save applies.
       */
      const insertCopy = Effect.fn("CampaignService.insertCopy")(function* (
        tx: Transaction,
        source: Campaign,
        automation: Option.Option<AutomationWorkingCopy>
      ) {
        const flow = yield* validateStoredAutomationFlow(
          automation.pipe(
            Option.map(({ flow }) => flow),
            Option.getOrNull
          )
        );
        const audience =
          source.audienceId === null
            ? Option.none()
            : yield* lockAudience(tx, source.audienceId);
        const assignable = Option.exists(
          audience,
          ({ archivedAt, filter }) =>
            archivedAt === null && isSavedAudienceFilter(filter)
        );
        const [campaign] = yield* tx
          .insert(emailCampaigns)
          .values({
            title: `Copy of ${source.title}`,
            purpose: source.purpose,
            templateKey: source.templateKey,
            content: source.content,
            audienceId: assignable ? source.audienceId : null,
            delivery: source.delivery,
            status: "draft",
          })
          .returning();
        if (source.delivery === "automated") {
          yield* tx.insert(emailCampaignAutomations).values({
            campaignId: campaign!.id,
            flow: Option.getOrNull(flow),
          });
        }
        return campaign!;
      });

      /** Copies the source as it stands once its working copy is locked. */
      const copyCampaign = Effect.fn("CampaignService.copyCampaign")(function* (
        tx: Transaction,
        campaignId: CampaignId
      ) {
        const automation = yield* lockAutomation(tx, campaignId, "share");
        const source = yield* tx
          .select()
          .from(emailCampaigns)
          .where(eq(emailCampaigns.id, campaignId))
          .pipe(
            Effect.map((rows) => Option.fromNullishOr(rows[0])),
            Effect.flatMap(requireFound(campaignId))
          );
        return yield* insertCopy(tx, source, automation);
      });

      const validateContent = (
        content: CampaignLocalizedContent | undefined
      ) =>
        content === undefined
          ? Effect.void
          : Schema.decodeEffect(CampaignLocalizedContent)(content).pipe(
              Effect.asVoid,
              Effect.mapError((cause) => new CampaignContentInvalid({ cause }))
            );

      /** Inserts a Draft, and an automated one's automation row with no flow. */
      const insertDraft = Effect.fn("CampaignService.insertDraft")(function* (
        tx: Transaction,
        input: CampaignDraftInput & { readonly delivery: CampaignDelivery }
      ) {
        yield* lockAssignableAudience(tx, input.audienceId);
        const [campaign] = yield* tx
          .insert(emailCampaigns)
          .values({ ...input, status: "draft" })
          .returning();
        if (input.delivery === "automated") {
          yield* tx
            .insert(emailCampaignAutomations)
            .values({ campaignId: campaign!.id, flow: null });
        }
        return campaign!;
      });

      /** Writes an edit if the campaign is still editable once locked. */
      const writeEdit = Effect.fn("CampaignService.writeEdit")(function* (
        tx: Transaction,
        { campaignId, ...changes }: CampaignEdit
      ) {
        if (changes.audienceId !== undefined) {
          yield* lockAssignableAudience(tx, changes.audienceId);
        }
        const updatedAt = yield* currentInstant;
        const [campaign] = yield* tx
          .update(emailCampaigns)
          .set({ ...changes, updatedAt })
          .where(and(eq(emailCampaigns.id, campaignId), editable))
          .returning();
        return Option.fromNullishOr(campaign);
      });

      const requireEdited =
        (campaignId: CampaignId) => (campaign: Option.Option<Campaign>) =>
          Option.match(campaign, {
            onNone: () => editRejection(campaignId),
            onSome: Effect.succeed,
          });

      const update = Effect.fn("CampaignService.update")(function* (
        edit: CampaignEdit
      ) {
        yield* validateContent(edit.content);
        return yield* db
          .transaction((tx) =>
            lockAutomation(tx, edit.campaignId, "update").pipe(
              Effect.andThen(writeEdit(tx, edit))
            )
          )
          .pipe(Effect.flatMap(requireEdited(edit.campaignId)));
      });

      /**
       * Merges the content changes into the content as it stands once the
       * campaign is locked, so no concurrent edit is lost.
       */
      const patchContent = Effect.fn("CampaignService.patchContent")(function* (
        tx: Transaction,
        {
          content: changes,
          ...edit
        }: CampaignPatchInput & {
          readonly content: CampaignContentChanges;
        }
      ) {
        yield* lockAutomation(tx, edit.campaignId, "update");
        const current = yield* tx
          .select({ content: emailCampaigns.content })
          .from(emailCampaigns)
          .where(eq(emailCampaigns.id, edit.campaignId))
          .for("update")
          .pipe(Effect.map((rows) => Option.fromNullishOr(rows[0])));
        if (Option.isNone(current)) return Option.none<Campaign>();
        const content = yield* changeCampaignContent({
          campaignId: edit.campaignId,
          current: current.value.content,
          changes,
        });
        yield* validateContent(content);
        return yield* writeEdit(tx, { ...edit, content });
      });

      return {
        list: db
          .select()
          .from(emailCampaigns)
          .orderBy(desc(emailCampaigns.createdAt), desc(emailCampaigns.id))
          .pipe(Effect.withSpan("CampaignService.list")),
        get: Effect.fn("CampaignService.get")(get),
        getOnce: Effect.fn("CampaignService.getOnce")(getOnce),
        create: Effect.fn("CampaignService.create")(function* ({
          delivery = "once",
          ...input
        }) {
          yield* validateContent(input.content);
          return yield* db.transaction((tx) =>
            insertDraft(tx, { ...input, delivery })
          );
        }),
        update,
        patch: Effect.fn("CampaignService.patch")(function* ({
          content,
          ...edit
        }) {
          if (content === undefined) return yield* update(edit);
          return yield* db
            .transaction((tx) => patchContent(tx, { ...edit, content }))
            .pipe(Effect.flatMap(requireEdited(edit.campaignId)));
        }),
        delete: Effect.fn("CampaignService.delete")(function* (campaignId) {
          const deleted = yield* db.transaction((tx) =>
            lockAutomation(tx, campaignId, "update").pipe(
              Effect.andThen(
                tx
                  .delete(emailCampaigns)
                  .where(
                    and(
                      eq(emailCampaigns.id, campaignId),
                      eq(emailCampaigns.status, "draft"),
                      notExists(
                        tx
                          .select({
                            id: emailCampaignAutomationVersions.id,
                          })
                          .from(emailCampaignAutomationVersions)
                          .where(
                            eq(
                              emailCampaignAutomationVersions.campaignId,
                              emailCampaigns.id
                            )
                          )
                      )
                    )
                  )
                  .returning({ id: emailCampaigns.id })
              )
            )
          );
          if (deleted.length === 0) {
            return yield* deleteRejection(campaignId);
          }
        }),
        duplicate: Effect.fn("CampaignService.duplicate")(
          function* (campaignId) {
            return yield* db.transaction((tx) => copyCampaign(tx, campaignId));
          }
        ),
      } satisfies ICampaignService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
