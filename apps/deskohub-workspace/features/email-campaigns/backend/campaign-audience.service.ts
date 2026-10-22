import "server-only";

import {
  type AnyColumn,
  and,
  asc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type CampaignAudienceRow,
  emailCampaignAudiences,
  emailCampaignAutomations,
  emailCampaignAutomationVersions,
  emailCampaigns,
} from "@/db/schema";
import { currentInstant } from "@/shared/utils/temporal";
import type { AudienceFilter } from "../audience-filter";
import {
  audienceFilterUsage,
  ensureSavedAudienceFilter,
} from "../audience-filter-usage";
import type { CampaignAudienceId } from "../campaign-identifiers";
import {
  AudienceFilterCampaignNotFound,
  type AudienceFilterContextInvalid,
  CampaignAudienceInUse,
  CampaignAudienceNotFound,
} from "../errors";

type CampaignAudience = CampaignAudienceRow;

type CampaignAudienceInput = {
  readonly title: string;
  readonly filter: AudienceFilter;
};

export interface ICampaignAudienceService {
  readonly list: (input: {
    readonly includeArchived: boolean;
  }) => Effect.Effect<readonly CampaignAudience[], EffectDrizzleQueryError>;
  readonly get: (
    audienceId: CampaignAudienceId
  ) => Effect.Effect<
    CampaignAudience,
    CampaignAudienceNotFound | EffectDrizzleQueryError
  >;
  readonly create: (
    input: CampaignAudienceInput
  ) => Effect.Effect<
    CampaignAudience,
    | AudienceFilterContextInvalid
    | AudienceFilterCampaignNotFound
    | EffectDrizzleQueryError
  >;
  /** Draft campaigns follow the change; sent campaigns keep their snapshot. */
  readonly update: (
    input: {
      readonly audienceId: CampaignAudienceId;
    } & Partial<CampaignAudienceInput>
  ) => Effect.Effect<
    CampaignAudience,
    | CampaignAudienceNotFound
    | AudienceFilterContextInvalid
    | AudienceFilterCampaignNotFound
    | EffectDrizzleQueryError
  >;
  readonly archive: (
    audienceId: CampaignAudienceId
  ) => Effect.Effect<
    CampaignAudience,
    CampaignAudienceNotFound | EffectDrizzleQueryError
  >;
  /** Makes an archived audience selectable again. */
  readonly unarchive: (
    audienceId: CampaignAudienceId
  ) => Effect.Effect<
    CampaignAudience,
    CampaignAudienceNotFound | EffectDrizzleQueryError
  >;
  /**
   * Deletes an audience no draft campaign uses and no condition of a
   * non-archived automated campaign references, in its working copy or its
   * active version; sent campaigns detach.
   */
  readonly delete: (
    audienceId: CampaignAudienceId
  ) => Effect.Effect<
    void,
    | CampaignAudienceNotFound
    | CampaignAudienceInUse
    | EffectDrizzleQueryError
    | SqlError.SqlError
  >;
}

/** Saved campaign audiences: named filter trees that campaigns select. */
export class CampaignAudienceService extends Context.Service<
  CampaignAudienceService,
  ICampaignAudienceService
>()("@deskohub-workspace/email-campaigns/CampaignAudienceService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const requireUpdated =
        (audienceId: CampaignAudienceId) =>
        (rows: readonly CampaignAudience[]) =>
          rows[0]
            ? Effect.succeed(rows[0])
            : Effect.fail(new CampaignAudienceNotFound({ audienceId }));

      /**
       * A saved audience holds what saved audiences can, and every campaign
       * whose emails it counts exists when it's saved. One deleted later
       * counts no emails.
       */
      const ensureWritableFilter = Effect.fn(
        "CampaignAudienceService.ensureWritableFilter"
      )(function* (filter: AudienceFilter) {
        yield* ensureSavedAudienceFilter(filter);
        const { specificCampaignIds } = audienceFilterUsage(filter);
        if (specificCampaignIds.length === 0) return;
        const found = yield* db
          .select({ id: emailCampaigns.id })
          .from(emailCampaigns)
          .where(inArray(emailCampaigns.id, [...specificCampaignIds]));
        const missing = specificCampaignIds.filter(
          (campaignId) => !found.some(({ id }) => id === campaignId)
        );
        if (missing.length > 0) {
          return yield* new AudienceFilterCampaignNotFound({
            campaignIds: missing,
          });
        }
      });

      type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

      const draftsUsing = (tx: Transaction, audienceId: CampaignAudienceId) =>
        tx
          .select({ id: emailCampaigns.id })
          .from(emailCampaigns)
          .where(
            and(
              eq(emailCampaigns.audienceId, audienceId),
              eq(emailCampaigns.status, "draft")
            )
          )
          .orderBy(asc(emailCampaigns.id));

      /**
       * Non-archived automated campaigns whose working copy or active version
       * has a condition on the audience. Archived ones never evaluate again,
       * and runs of older versions fail the condition once it's gone.
       */
      const automationsReferencing = (
        tx: Transaction,
        audienceId: CampaignAudienceId
      ) => {
        const references = (flow: AnyColumn) =>
          sql`jsonb_path_exists(${flow}, '$.steps[*].filter.** ? (@._tag == "InAudience" && @.audienceId == $id)', jsonb_build_object('id', ${audienceId}::text))`;
        return tx
          .select({ id: emailCampaigns.id })
          .from(emailCampaignAutomations)
          .innerJoin(
            emailCampaigns,
            eq(emailCampaigns.id, emailCampaignAutomations.campaignId)
          )
          .leftJoin(
            emailCampaignAutomationVersions,
            eq(
              emailCampaignAutomationVersions.id,
              emailCampaignAutomations.activeVersionId
            )
          )
          .where(
            and(
              ne(emailCampaigns.status, "archived"),
              or(
                references(emailCampaignAutomations.flow),
                references(emailCampaignAutomationVersions.flow)
              )
            )
          )
          .orderBy(asc(emailCampaigns.id));
      };

      /**
       * Waits for campaigns assigning the audience to commit; they share-lock
       * its row first. Drafts are checked after the lock, so none can slip in
       * and be detached by the delete.
       */
      const deleteUnused = Effect.fn("CampaignAudienceService.deleteUnused")(
        function* (tx: Transaction, audienceId: CampaignAudienceId) {
          const [audience] = yield* tx
            .select({ id: emailCampaignAudiences.id })
            .from(emailCampaignAudiences)
            .where(eq(emailCampaignAudiences.id, audienceId))
            .for("update");
          if (!audience) {
            return yield* new CampaignAudienceNotFound({ audienceId });
          }
          const drafts = yield* draftsUsing(tx, audienceId);
          const automations = yield* automationsReferencing(tx, audienceId);
          if (drafts.length > 0 || automations.length > 0) {
            return yield* new CampaignAudienceInUse({
              audienceId,
              draftCampaignIds: drafts.map(({ id }) => id),
              automationCampaignIds: automations.map(({ id }) => id),
            });
          }
          yield* tx
            .delete(emailCampaignAudiences)
            .where(eq(emailCampaignAudiences.id, audienceId));
        }
      );

      return {
        list: Effect.fn("CampaignAudienceService.list")(function* ({
          includeArchived,
        }) {
          return yield* db
            .select()
            .from(emailCampaignAudiences)
            .where(
              includeArchived
                ? undefined
                : isNull(emailCampaignAudiences.archivedAt)
            )
            .orderBy(
              asc(emailCampaignAudiences.title),
              asc(emailCampaignAudiences.id)
            );
        }),
        get: Effect.fn("CampaignAudienceService.get")(function* (audienceId) {
          return yield* db
            .select()
            .from(emailCampaignAudiences)
            .where(eq(emailCampaignAudiences.id, audienceId))
            .pipe(Effect.flatMap(requireUpdated(audienceId)));
        }),
        create: Effect.fn("CampaignAudienceService.create")(function* (input) {
          yield* ensureWritableFilter(input.filter);
          const [audience] = yield* db
            .insert(emailCampaignAudiences)
            .values({ title: input.title, filter: input.filter })
            .returning();
          return audience!;
        }),
        update: Effect.fn("CampaignAudienceService.update")(function* ({
          audienceId,
          title,
          filter,
        }) {
          if (filter !== undefined) yield* ensureWritableFilter(filter);
          const updatedAt = yield* currentInstant;
          return yield* db
            .update(emailCampaignAudiences)
            .set({ title, filter, updatedAt })
            .where(eq(emailCampaignAudiences.id, audienceId))
            .returning()
            .pipe(Effect.flatMap(requireUpdated(audienceId)));
        }),
        archive: Effect.fn("CampaignAudienceService.archive")(
          function* (audienceId) {
            const archivedAt = yield* currentInstant;
            return yield* db
              .update(emailCampaignAudiences)
              .set({
                archivedAt: sql`coalesce(${emailCampaignAudiences.archivedAt}, ${sql.param(archivedAt, emailCampaignAudiences.archivedAt)})`,
                updatedAt: archivedAt,
              })
              .where(eq(emailCampaignAudiences.id, audienceId))
              .returning()
              .pipe(Effect.flatMap(requireUpdated(audienceId)));
          }
        ),
        unarchive: Effect.fn("CampaignAudienceService.unarchive")(
          function* (audienceId) {
            const updatedAt = yield* currentInstant;
            return yield* db
              .update(emailCampaignAudiences)
              .set({ archivedAt: null, updatedAt })
              .where(eq(emailCampaignAudiences.id, audienceId))
              .returning()
              .pipe(Effect.flatMap(requireUpdated(audienceId)));
          }
        ),
        delete: Effect.fn("CampaignAudienceService.delete")((audienceId) =>
          db.transaction((tx) => deleteUnused(tx, audienceId))
        ),
      } satisfies ICampaignAudienceService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
