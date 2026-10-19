import "server-only";

import { and, desc, eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type CampaignRow,
  emailCampaignAudiences,
  emailCampaigns,
} from "@/db/schema";
import { currentInstant } from "@/shared/utils/temporal";
import {
  ensureSavedAudienceFilter,
  isSavedAudienceFilter,
} from "../audience-filter-usage";
import {
  CampaignLocalizedContent,
  type CampaignPurpose,
  type CampaignTemplateKey,
} from "../body/campaign-content";
import type { CampaignAudienceId, CampaignId } from "../campaign-identifiers";
import { isOnceCampaign, type OnceCampaignStatus } from "../campaign-states";
import {
  type AudienceFilterContextInvalid,
  CampaignAudienceArchived,
  CampaignAudienceNotFound,
  CampaignContentInvalid,
  CampaignDeliveryMismatch,
  CampaignNotFound,
  CampaignReadOnly,
} from "../errors";

type Campaign = CampaignRow;

/** A campaign that sends once; only these can be sent or duplicated. */
export type OnceCampaign = Campaign & {
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

type CampaignWriteError =
  | CampaignAudienceNotFound
  | CampaignAudienceArchived
  | AudienceFilterContextInvalid
  | CampaignContentInvalid;

type CampaignTransactionError = EffectDrizzleQueryError | SqlError.SqlError;

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
  readonly create: (
    input: CampaignDraftInput
  ) => Effect.Effect<Campaign, CampaignWriteError | CampaignTransactionError>;
  /**
   * Edits a Draft; a campaign that left Draft is read-only. The edit's row
   * update waits on a confirmation's campaign row lock and then rechecks the
   * status, so content can't change between a confirmation's content check
   * and its move to Sending.
   */
  readonly update: (
    input: { readonly campaignId: CampaignId } & Partial<CampaignDraftInput>
  ) => Effect.Effect<
    Campaign,
    | CampaignNotFound
    | CampaignReadOnly
    | CampaignWriteError
    | CampaignTransactionError
  >;
  /** Deletes a Draft; a campaign that left Draft keeps its history. */
  readonly delete: (
    campaignId: CampaignId
  ) => Effect.Effect<
    void,
    CampaignNotFound | CampaignReadOnly | EffectDrizzleQueryError
  >;
  /**
   * Copies a one-off campaign of any status into a new Draft titled "Copy
   * of …". The copy keeps the source's audience only while it exists, isn't
   * archived, and holds a filter a campaign can use; otherwise the admin
   * picks one.
   */
  readonly duplicate: (
    campaignId: CampaignId
  ) => Effect.Effect<
    Campaign,
    CampaignNotFound | CampaignDeliveryMismatch | CampaignTransactionError
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

      const get = (campaignId: CampaignId) =>
        find(campaignId).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(new CampaignNotFound({ campaignId })),
              onSome: Effect.succeed,
            })
          )
        );

      const getOnce = (campaignId: CampaignId) =>
        get(campaignId).pipe(
          Effect.filterOrFail(
            isOnceCampaign,
            ({ delivery }) =>
              new CampaignDeliveryMismatch({ campaignId, delivery })
          )
        );

      /** Explains why a Draft-only write matched no row. */
      const draftWriteRejection = Effect.fn(
        "CampaignService.draftWriteRejection"
      )(function* (campaignId: CampaignId) {
        const { status } = yield* get(campaignId);
        if (status === "draft") {
          return yield* new CampaignNotFound({ campaignId });
        }
        return yield* new CampaignReadOnly({ campaignId, status });
      });

      type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

      /** Keeps the source's audience only if it's still assignable. */
      const insertCopy = Effect.fn("CampaignService.insertCopy")(function* (
        tx: Transaction,
        source: Campaign
      ) {
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
            status: "draft",
          })
          .returning();
        return campaign!;
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

      return {
        list: db
          .select()
          .from(emailCampaigns)
          .orderBy(desc(emailCampaigns.createdAt), desc(emailCampaigns.id))
          .pipe(Effect.withSpan("CampaignService.list")),
        get: Effect.fn("CampaignService.get")(get),
        getOnce: Effect.fn("CampaignService.getOnce")(getOnce),
        create: Effect.fn("CampaignService.create")(function* (input) {
          yield* validateContent(input.content);
          return yield* db.transaction((tx) =>
            lockAssignableAudience(tx, input.audienceId).pipe(
              Effect.andThen(
                tx
                  .insert(emailCampaigns)
                  .values({ ...input, status: "draft" })
                  .returning()
              ),
              Effect.map(([campaign]) => campaign!)
            )
          );
        }),
        update: Effect.fn("CampaignService.update")(function* ({
          campaignId,
          ...changes
        }) {
          yield* validateContent(changes.content);
          const updatedAt = yield* currentInstant;
          const [campaign] = yield* db.transaction((tx) =>
            Effect.andThen(
              changes.audienceId === undefined
                ? Effect.void
                : lockAssignableAudience(tx, changes.audienceId),
              tx
                .update(emailCampaigns)
                .set({ ...changes, updatedAt })
                .where(
                  and(
                    eq(emailCampaigns.id, campaignId),
                    eq(emailCampaigns.status, "draft")
                  )
                )
                .returning()
            )
          );
          return campaign ?? (yield* draftWriteRejection(campaignId));
        }),
        delete: Effect.fn("CampaignService.delete")(function* (campaignId) {
          const deleted = yield* db
            .delete(emailCampaigns)
            .where(
              and(
                eq(emailCampaigns.id, campaignId),
                eq(emailCampaigns.status, "draft")
              )
            )
            .returning({ id: emailCampaigns.id });
          if (deleted.length === 0) {
            return yield* draftWriteRejection(campaignId);
          }
        }),
        duplicate: Effect.fn("CampaignService.duplicate")(
          function* (campaignId) {
            const source = yield* getOnce(campaignId);
            return yield* db.transaction((tx) => insertCopy(tx, source));
          }
        ),
      } satisfies ICampaignService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
