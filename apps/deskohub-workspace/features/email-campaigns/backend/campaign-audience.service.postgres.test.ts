import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Layer, Schema } from "effect";
import {
  holdPostgresTransaction,
  waitForPostgresLockWaiter,
} from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { type AudienceFilter, audienceFilterSchema } from "../audience-filter";
import type { AudienceFilterUses } from "../audience-filter-usage";
import {
  type CampaignAudienceId,
  type CampaignId,
  campaignIdSchema,
} from "../campaign-identifiers";
import { CampaignService } from "./campaign.service";
import { CampaignAudienceService } from "./campaign-audience.service";
import {
  audienceConditionFlowFixture,
  campaignContentFixture,
  deleteAutomatedCampaigns,
  everyoneFilter,
  seedAutomationVersion,
} from "./email-campaigns.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "CampaignAudienceService on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const audienceIds: CampaignAudienceId[] = [];
    const campaignIds: CampaignId[] = [];

    afterAll(async () => {
      await deleteAutomatedCampaigns(testDatabase.db, campaignIds);
      await testDatabase.pool.query(
        "delete from email_campaign_audiences where id = any($1)",
        [audienceIds]
      );
    });

    const run = <A, E>(
      effect: Effect.Effect<A, E, CampaignAudienceService | CampaignService>
    ) =>
      Effect.runPromiseExit(
        effect.pipe(
          Effect.provide(
            Layer.mergeAll(
              CampaignAudienceService.Default,
              CampaignService.Default
            ).pipe(Layer.provide(testDatabase.layer))
          )
        )
      );

    const failure = (exit: Exit.Exit<unknown, unknown>) =>
      Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

    const createAudience = async (
      title: string,
      filter: AudienceFilter = everyoneFilter
    ) => {
      const exit = await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.create({ title, filter }))
        )
      );
      if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
      audienceIds.push(exit.value.id);
      return exit.value;
    };

    const createCampaign = async (audienceId: CampaignAudienceId) => {
      const exit = await run(
        CampaignService.pipe(
          Effect.flatMap((campaigns) =>
            campaigns.create({
              title: "Spring news",
              purpose: "marketing",
              templateKey: "workspace",
              content: campaignContentFixture(),
              audienceId,
            })
          )
        )
      );
      if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
      campaignIds.push(exit.value.id);
      return exit.value;
    };

    test("blocks deleting an audience a draft uses, but allows archiving it", async () => {
      const audience = await createAudience("Regulars");
      const draft = await createCampaign(audience.id);

      const deletion = await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.delete(audience.id))
        )
      );
      expect(failure(deletion)).toMatchObject({
        _tag: "CampaignAudienceInUse",
        draftCampaignIds: [draft.id],
        automationCampaignIds: [],
      });

      const archived = await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.archive(audience.id))
        )
      );
      expect(
        Exit.isSuccess(archived) && archived.value.archivedAt
      ).toBeTruthy();

      const listed = await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) =>
            audiences.list({ includeArchived: false })
          )
        )
      );
      expect(
        Exit.isSuccess(listed) &&
          listed.value.some(({ id }) => id === audience.id)
      ).toBe(false);
    });

    test("refuses to assign an archived audience to a campaign", async () => {
      const audience = await createAudience("Former members");
      await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.archive(audience.id))
        )
      );
      const creation = await run(
        CampaignService.pipe(
          Effect.flatMap((campaigns) =>
            campaigns.create({
              title: "Win-back",
              purpose: "operational",
              templateKey: "workspace",
              content: campaignContentFixture(),
              audienceId: audience.id,
            })
          )
        )
      );
      expect(failure(creation)).toMatchObject({
        _tag: "CampaignAudienceArchived",
      });
    });

    const unarchiveAudience = (audienceId: CampaignAudienceId) =>
      run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.unarchive(audienceId))
        )
      );

    test("unarchives an audience so new campaigns can select it again", async () => {
      const audience = await createAudience("Returning members");
      await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.archive(audience.id))
        )
      );

      const unarchived = await unarchiveAudience(audience.id);
      expect(Exit.isSuccess(unarchived) && unarchived.value.archivedAt).toBe(
        null
      );
      const listed = await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) =>
            audiences.list({ includeArchived: false })
          )
        )
      );
      expect(
        Exit.isSuccess(listed) &&
          listed.value.some(({ id }) => id === audience.id)
      ).toBe(true);
      const draft = await createCampaign(audience.id);
      expect(draft.audienceId).toBe(audience.id);
    });

    test("reports a missing audience to unarchive", async () => {
      const missing = await createAudience("Gone before unarchive");
      await testDatabase.pool.query(
        "delete from email_campaign_audiences where id = $1",
        [missing.id]
      );

      expect(failure(await unarchiveAudience(missing.id))).toMatchObject({
        _tag: "CampaignAudienceNotFound",
      });
    });

    test("deletes an audience only sent campaigns used and keeps their snapshot", async () => {
      const audience = await createAudience("One-off");
      const campaign = await createCampaign(audience.id);
      await testDatabase.pool.query(
        "update email_campaigns set status = 'sent' where id = $1",
        [campaign.id]
      );
      await testDatabase.pool.query(
        "insert into email_campaign_sends (campaign_id, audience_id, audience_filter, content_hash) values ($1, $2, $3, 'hash')",
        [campaign.id, audience.id, JSON.stringify(everyoneFilter)]
      );

      const deletion = await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.delete(audience.id))
        )
      );
      expect(Exit.isSuccess(deletion)).toBe(true);
      const { rows } = await testDatabase.pool.query(
        "select audience_id, audience_filter from email_campaign_sends where campaign_id = $1",
        [campaign.id]
      );
      expect(rows).toEqual([
        { audience_id: null, audience_filter: everyoneFilter },
      ]);
      await testDatabase.pool.query(
        "delete from email_campaign_sends where campaign_id = $1",
        [campaign.id]
      );
    });

    const createDraftWithoutAudience = async () => {
      const exit = await run(
        CampaignService.pipe(
          Effect.flatMap((campaigns) =>
            campaigns.create({
              title: "Unassigned",
              purpose: "marketing",
              templateKey: "workspace",
              content: campaignContentFixture(),
              audienceId: null,
            })
          )
        )
      );
      if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
      campaignIds.push(exit.value.id);
      return exit.value;
    };

    const storedAudienceId = async (campaignId: CampaignId) => {
      const { rows } = await testDatabase.pool.query(
        "select audience_id from email_campaigns where id = $1",
        [campaignId]
      );
      return rows[0]?.audience_id as CampaignAudienceId | null;
    };

    /** Holds `sql` uncommitted until `action` waits on its locks. */
    const raceBehind = async <A>(
      held: { readonly sql: string; readonly values: readonly unknown[] },
      action: () => Promise<A>
    ) => {
      const blocker = await holdPostgresTransaction(
        testDatabase.pool,
        held.sql,
        held.values
      );
      const pending = action();
      await waitForPostgresLockWaiter(testDatabase.pool, {
        condition: "$1 = any(pg_blocking_pids(pid))",
        values: [blocker.pid],
        description: "the service call to wait on the held transaction",
      });
      await blocker.commit();
      return { result: await pending, heldRows: blocker.rows };
    };

    const deleteAudience = (audienceId: CampaignAudienceId) =>
      run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.delete(audienceId))
        )
      );

    test("refuses a deletion that waited on a new draft using the audience", async () => {
      const audience = await createAudience("Racing insert");
      const { result, heldRows } = await raceBehind(
        {
          sql: `insert into email_campaigns (title, purpose, template_key, audience_id)
                values ('Racing', 'marketing', 'workspace', $1) returning id`,
          values: [audience.id],
        },
        () => deleteAudience(audience.id)
      );
      const draftId = heldRows[0].id as CampaignId;
      campaignIds.push(draftId);

      expect(failure(result)).toMatchObject({
        _tag: "CampaignAudienceInUse",
        draftCampaignIds: [draftId],
      });
      expect(await storedAudienceId(draftId)).toBe(audience.id);
    });

    test("refuses a deletion that waited on a draft moving to the audience", async () => {
      const audience = await createAudience("Racing update");
      const draft = await createDraftWithoutAudience();
      const { result } = await raceBehind(
        {
          sql: "update email_campaigns set audience_id = $2 where id = $1",
          values: [draft.id, audience.id],
        },
        () => deleteAudience(audience.id)
      );

      expect(failure(result)).toMatchObject({
        _tag: "CampaignAudienceInUse",
        draftCampaignIds: [draft.id],
      });
      expect(await storedAudienceId(draft.id)).toBe(audience.id);
    });

    const createAutomation = async () => {
      const exit = await run(
        CampaignService.pipe(
          Effect.flatMap((campaigns) =>
            campaigns.create({
              title: "Come back soon",
              purpose: "marketing",
              templateKey: "workspace",
              content: campaignContentFixture(),
              audienceId: null,
              delivery: "automated",
            })
          )
        )
      );
      if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
      campaignIds.push(exit.value.id);
      return exit.value.id;
    };

    const setWorkingFlow = (
      campaignId: CampaignId,
      flow: ReturnType<typeof audienceConditionFlowFixture>
    ) =>
      testDatabase.pool.query(
        "update email_campaign_automations set flow = $2 where campaign_id = $1",
        [campaignId, flow]
      );

    /** Publishes version `versionNumber` with `flow` and makes it active. */
    const activateVersion = async (
      campaignId: CampaignId,
      input: { readonly versionNumber: number; readonly flow?: unknown }
    ) => {
      const versionId = await seedAutomationVersion(testDatabase.db, {
        campaignId,
        purpose: "marketing",
        ...input,
      });
      await testDatabase.pool.query(
        "update email_campaign_automations set active_version_id = $2 where campaign_id = $1",
        [campaignId, versionId]
      );
    };

    const setStatus = (campaignId: CampaignId, status: string) =>
      testDatabase.pool.query(
        "update email_campaigns set status = $2 where id = $1",
        [campaignId, status]
      );

    test("blocks deleting an audience an automation's working copy references", async () => {
      const audience = await createAudience("Loyal guests");
      const campaignId = await createAutomation();
      await setWorkingFlow(
        campaignId,
        audienceConditionFlowFixture(audience.id)
      );

      expect(failure(await deleteAudience(audience.id))).toMatchObject({
        _tag: "CampaignAudienceInUse",
        draftCampaignIds: [],
        automationCampaignIds: [campaignId],
      });
    });

    test("blocks deleting an audience an automation's active version references", async () => {
      const audience = await createAudience("Weekend guests");
      const campaignId = await createAutomation();
      await activateVersion(campaignId, {
        versionNumber: 1,
        flow: audienceConditionFlowFixture(audience.id),
      });
      await setStatus(campaignId, "paused");

      expect(failure(await deleteAudience(audience.id))).toMatchObject({
        _tag: "CampaignAudienceInUse",
        draftCampaignIds: [],
        automationCampaignIds: [campaignId],
      });
    });

    test("deletes an audience only archived automations and superseded versions reference", async () => {
      const audience = await createAudience("Former regulars");
      const flow = audienceConditionFlowFixture(audience.id);

      const archivedId = await createAutomation();
      await setWorkingFlow(archivedId, flow);
      await activateVersion(archivedId, { versionNumber: 1, flow });
      await setStatus(archivedId, "archived");

      // Runs pinned to version 1 fail its condition once the audience is gone.
      const supersededId = await createAutomation();
      await activateVersion(supersededId, { versionNumber: 1, flow });
      await activateVersion(supersededId, { versionNumber: 2 });
      await setStatus(supersededId, "active");

      expect(Exit.isSuccess(await deleteAudience(audience.id))).toBe(true);
    });

    test("unarchives after waiting on an archive that holds the audience row", async () => {
      const audience = await createAudience("Archived under unarchive");
      const { result } = await raceBehind(
        {
          sql: "update email_campaign_audiences set archived_at = now() where id = $1",
          values: [audience.id],
        },
        () => unarchiveAudience(audience.id)
      );

      expect(Exit.isSuccess(result) && result.value.archivedAt).toBe(null);
      const { rows } = await testDatabase.pool.query(
        "select archived_at from email_campaign_audiences where id = $1",
        [audience.id]
      );
      expect(rows).toEqual([{ archived_at: null }]);
    });

    const heldDeletion = (audienceId: CampaignAudienceId) => ({
      sql: "delete from email_campaign_audiences where id = $1",
      values: [audienceId],
    });

    test("reports a missing audience to a draft created behind its deletion", async () => {
      const audience = await createAudience("Deleted under create");
      const { result } = await raceBehind(heldDeletion(audience.id), () =>
        run(
          CampaignService.pipe(
            Effect.flatMap((campaigns) =>
              campaigns.create({
                title: "Too late",
                purpose: "marketing",
                templateKey: "workspace",
                content: campaignContentFixture(),
                audienceId: audience.id,
              })
            )
          )
        )
      );
      if (Exit.isSuccess(result)) campaignIds.push(result.value.id);

      expect(failure(result)).toMatchObject({
        _tag: "CampaignAudienceNotFound",
      });
    });

    test("reports a missing audience to a draft moved to it behind its deletion", async () => {
      const audience = await createAudience("Deleted under update");
      const draft = await createDraftWithoutAudience();
      const { result } = await raceBehind(heldDeletion(audience.id), () =>
        run(
          CampaignService.pipe(
            Effect.flatMap((campaigns) =>
              campaigns.update({
                campaignId: draft.id,
                audienceId: audience.id,
              })
            )
          )
        )
      );

      expect(failure(result)).toMatchObject({
        _tag: "CampaignAudienceNotFound",
      });
      expect(await storedAudienceId(draft.id)).toBeNull();
    });

    test("duplicates a sent campaign without the audience deleted under it", async () => {
      const audience = await createAudience("Deleted under duplicate");
      const sent = await createCampaign(audience.id);
      await testDatabase.pool.query(
        "update email_campaigns set status = 'sent' where id = $1",
        [sent.id]
      );
      const { result } = await raceBehind(heldDeletion(audience.id), () =>
        run(
          CampaignService.pipe(
            Effect.flatMap((campaigns) => campaigns.duplicate(sent.id))
          )
        )
      );
      if (Exit.isSuccess(result)) campaignIds.push(result.value.id);

      expect(Exit.isSuccess(result) && result.value.audienceId).toBeNull();
    });

    const duplicate = (campaignId: CampaignId) =>
      run(
        CampaignService.pipe(
          Effect.flatMap((campaigns) => campaigns.duplicate(campaignId))
        )
      ).then((exit) => {
        if (Exit.isSuccess(exit)) campaignIds.push(exit.value.id);
        return exit;
      });

    test("duplicates a draft without its archived audience", async () => {
      const audience = await createAudience("Archived before duplicate");
      const draft = await createCampaign(audience.id);
      await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.archive(audience.id))
        )
      );

      const copy = await duplicate(draft.id);
      expect(Exit.isSuccess(copy) && copy.value.audienceId).toBeNull();
      expect(await storedAudienceId(draft.id)).toBe(audience.id);
    });

    test("duplicates a draft without the audience archived under it", async () => {
      const audience = await createAudience("Archived under duplicate");
      const draft = await createCampaign(audience.id);
      const { result } = await raceBehind(
        {
          sql: "update email_campaign_audiences set archived_at = now() where id = $1",
          values: [audience.id],
        },
        () => duplicate(draft.id)
      );

      expect(Exit.isSuccess(result) && result.value.audienceId).toBeNull();
    });

    test("refuses a draft created behind the audience's archiving", async () => {
      const audience = await createAudience("Archived under create");
      const { result } = await raceBehind(
        {
          sql: "update email_campaign_audiences set archived_at = now() where id = $1",
          values: [audience.id],
        },
        () =>
          run(
            CampaignService.pipe(
              Effect.flatMap((campaigns) =>
                campaigns.create({
                  title: "Too late",
                  purpose: "marketing",
                  templateKey: "workspace",
                  content: campaignContentFixture(),
                  audienceId: audience.id,
                })
              )
            )
          )
      );
      if (Exit.isSuccess(result)) campaignIds.push(result.value.id);

      expect(failure(result)).toMatchObject({
        _tag: "CampaignAudienceArchived",
      });
    });

    const noUses: AudienceFilterUses = {
      attributes: [],
      periods: [],
      campaignSources: [],
    };
    const automationOnlyUses: readonly {
      readonly use: string;
      readonly filter: AudienceFilter;
      readonly uses: AudienceFilterUses;
    }[] = [
      {
        use: "a trigger window",
        filter: {
          attribute: "reservationCount",
          _tag: "Condition",
          params: {
            dateBasis: "visit",
            period: {
              _tag: "TriggerWindow",
              side: "before",
              count: 7,
              unit: "day",
            },
          },
          operator: "gt",
          value: 0,
        },
        uses: { ...noUses, periods: ["TriggerWindow"] },
      },
      {
        use: "this campaign's emails",
        filter: {
          attribute: "campaignEmailCount",
          _tag: "Condition",
          params: {
            purpose: "any",
            period: { _tag: "AnyTime" },
            campaign: { _tag: "This" },
          },
          operator: "eq",
          value: 0,
        },
        uses: { ...noUses, campaignSources: ["This"] },
      },
    ];
    const everyAutomationOnlyUse: AudienceFilter = {
      _tag: "Group",
      operator: "or",
      filters: automationOnlyUses.map(({ filter }) => filter),
    };

    const firstVisitPastAndSpecificCampaignFilter = (
      campaignId: CampaignId
    ): AudienceFilter => ({
      _tag: "Group",
      operator: "and",
      filters: [
        { attribute: "firstVisit", _tag: "Condition", operator: "none" },
        {
          attribute: "lastVisit",
          _tag: "Condition",
          operator: "in",
          value: { _tag: "Past" },
        },
        {
          attribute: "campaignEmailCount",
          _tag: "Condition",
          params: {
            purpose: "any",
            period: { _tag: "AnyTime" },
            campaign: { _tag: "Specific", campaignId },
          },
          operator: "eq",
          value: 0,
        },
      ],
    });

    const countAudiencesTitled = async (title: string) => {
      const result = (await testDatabase.pool.query(
        "select count(*)::int as count from email_campaign_audiences where title = $1",
        [title]
      )) as { rows: Array<{ count: number }> };
      return result.rows[0]?.count;
    };

    /** Stores a filter the way only SQL can while writes reject it. */
    const insertAudienceBySql = async (
      title: string,
      filter: AudienceFilter
    ) => {
      const result = (await testDatabase.pool.query(
        "insert into email_campaign_audiences (title, filter) values ($1, $2::jsonb) returning id",
        [title, JSON.stringify(filter)]
      )) as { rows: Array<{ id: CampaignAudienceId }> };
      const id = result.rows[0]!.id;
      audienceIds.push(id);
      return id;
    };

    test.each(automationOnlyUses)(
      "refuses to create an audience with $use and stores nothing",
      async ({ use, filter, uses }) => {
        const title = `Upcoming ${use} ${crypto.randomUUID()}`;
        const creation = await run(
          CampaignAudienceService.pipe(
            Effect.flatMap((audiences) => audiences.create({ title, filter }))
          )
        );
        if (Exit.isSuccess(creation)) audienceIds.push(creation.value.id);

        expect(failure(creation)).toMatchObject({
          _tag: "AudienceFilterContextInvalid",
          uses,
        });
        expect(await countAudiencesTitled(title)).toBe(0);
      }
    );

    test.each(automationOnlyUses)(
      "refuses to change an audience's filter to $use and keeps the stored one",
      async ({ filter, uses }) => {
        const audience = await createAudience("Upcoming shape update");
        const update = await run(
          CampaignAudienceService.pipe(
            Effect.flatMap((audiences) =>
              audiences.update({
                audienceId: audience.id,
                title: "Renamed by a refused update",
                filter,
              })
            )
          )
        );
        expect(failure(update)).toMatchObject({
          _tag: "AudienceFilterContextInvalid",
          uses,
        });

        const stored = await run(
          CampaignAudienceService.pipe(
            Effect.flatMap((audiences) => audiences.get(audience.id))
          )
        );
        expect(Exit.isSuccess(stored) && stored.value).toMatchObject({
          title: "Upcoming shape update",
          filter: everyoneFilter,
        });
      }
    );

    test("creates and updates an audience with first visit, Past, and a specific campaign", async () => {
      const sourceCampaign = await createCampaign(
        (await createAudience("Specific campaign filter source")).id
      );
      const filter = firstVisitPastAndSpecificCampaignFilter(sourceCampaign.id);
      const created = await createAudience("Supported audience filter", filter);

      const storedAfterCreate = await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.get(created.id))
        )
      );
      expect(
        Exit.isSuccess(storedAfterCreate) && storedAfterCreate.value.filter
      ).toEqual(filter);

      const updated = await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) =>
            audiences.update({
              audienceId: created.id,
              title: "Updated supported audience filter",
              filter,
            })
          )
        )
      );
      expect(Exit.isSuccess(updated) && updated.value.filter).toEqual(filter);

      const storedAfterUpdate = await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.get(created.id))
        )
      );
      expect(
        Exit.isSuccess(storedAfterUpdate) && storedAfterUpdate.value
      ).toMatchObject({
        title: "Updated supported audience filter",
        filter,
      });
    });

    test("rejects a missing specific campaign when creating or updating an audience", async () => {
      const missingCampaignId = campaignIdSchema.make(crypto.randomUUID());
      const filter = firstVisitPastAndSpecificCampaignFilter(missingCampaignId);
      const title = `Missing campaign ${crypto.randomUUID()}`;
      const creation = await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.create({ title, filter }))
        )
      );
      if (Exit.isSuccess(creation)) audienceIds.push(creation.value.id);
      expect(failure(creation)).toMatchObject({
        _tag: "AudienceFilterCampaignNotFound",
        campaignIds: [missingCampaignId],
      });
      expect(await countAudiencesTitled(title)).toBe(0);

      const audience = await createAudience("Missing campaign filter update");
      const update = await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) =>
            audiences.update({
              audienceId: audience.id,
              title: "Renamed by a refused update",
              filter,
            })
          )
        )
      );
      expect(failure(update)).toMatchObject({
        _tag: "AudienceFilterCampaignNotFound",
        campaignIds: [missingCampaignId],
      });

      const stored = await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.get(audience.id))
        )
      );
      expect(Exit.isSuccess(stored) && stored.value).toMatchObject({
        title: "Missing campaign filter update",
        filter: everyoneFilter,
      });
    });

    test("assigns an audience with a specific campaign filter to a campaign", async () => {
      const sourceCampaign = await createCampaign(
        (await createAudience("Specific assignment source")).id
      );
      const audience = await createAudience(
        "Specific assignment target",
        firstVisitPastAndSpecificCampaignFilter(sourceCampaign.id)
      );

      const createdDraft = await createCampaign(audience.id);
      expect(createdDraft.audienceId).toBe(audience.id);

      const draftToMove = await createCampaign(
        (await createAudience("Specific assignment before move")).id
      );
      const moved = await run(
        CampaignService.pipe(
          Effect.flatMap((campaigns) =>
            campaigns.update({
              campaignId: draftToMove.id,
              audienceId: audience.id,
            })
          )
        )
      );
      expect(Exit.isSuccess(moved) && moved.value.audienceId).toBe(audience.id);
      expect(await storedAudienceId(draftToMove.id)).toBe(audience.id);
    });

    test("reads, decodes, and renames an audience that already holds automation-only shapes", async () => {
      const audienceId = await insertAudienceBySql(
        "Stored upcoming shapes",
        everyAutomationOnlyUse
      );

      const read = await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) =>
            Effect.all([
              audiences.get(audienceId),
              audiences.list({ includeArchived: false }),
            ])
          )
        )
      );
      if (Exit.isFailure(read)) throw Cause.squash(read.cause);
      const [audience, listed] = read.value;
      expect(listed.some(({ id }) => id === audienceId)).toBe(true);
      expect(
        Schema.decodeUnknownSync(audienceFilterSchema)(audience.filter)
      ).toEqual(everyAutomationOnlyUse);

      const renamed = await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) =>
            audiences.update({ audienceId, title: "Renamed upcoming shapes" })
          )
        )
      );
      expect(Exit.isSuccess(renamed) && renamed.value).toMatchObject({
        title: "Renamed upcoming shapes",
        filter: everyAutomationOnlyUse,
      });
    });

    test("refuses to assign an audience holding upcoming uses to a campaign", async () => {
      const audienceId = await insertAudienceBySql(
        "Stored upcoming uses for campaigns",
        everyAutomationOnlyUse
      );
      const allUses = {
        attributes: [],
        periods: ["TriggerWindow"],
        campaignSources: ["This"],
      };

      const creation = await run(
        CampaignService.pipe(
          Effect.flatMap((campaigns) =>
            campaigns.create({
              title: "Upcoming uses draft",
              purpose: "marketing",
              templateKey: "workspace",
              content: campaignContentFixture(),
              audienceId,
            })
          )
        )
      );
      if (Exit.isSuccess(creation)) campaignIds.push(creation.value.id);
      expect(failure(creation)).toMatchObject({
        _tag: "AudienceFilterContextInvalid",
        uses: allUses,
      });

      const draft = await createCampaign(
        (await createAudience("Assignable before the move")).id
      );
      const move = await run(
        CampaignService.pipe(
          Effect.flatMap((campaigns) =>
            campaigns.update({ campaignId: draft.id, audienceId })
          )
        )
      );
      expect(failure(move)).toMatchObject({
        _tag: "AudienceFilterContextInvalid",
        uses: allUses,
      });
      expect(await storedAudienceId(draft.id)).toBe(draft.audienceId);
    });

    test("duplicates a draft without an audience that came to hold upcoming shapes", async () => {
      const audience = await createAudience(
        "Automation-only uses after assignment"
      );
      const draft = await createCampaign(audience.id);
      await testDatabase.pool.query(
        "update email_campaign_audiences set filter = $2::jsonb where id = $1",
        [audience.id, JSON.stringify(everyAutomationOnlyUse)]
      );

      const copy = await duplicate(draft.id);
      expect(Exit.isSuccess(copy) && copy.value.audienceId).toBeNull();
      expect(await storedAudienceId(draft.id)).toBe(audience.id);
    });

    test("reports a missing audience", async () => {
      const deletion = await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) =>
            audiences.delete("missing" as CampaignAudienceId)
          )
        )
      );
      expect(failure(deletion)).toMatchObject({
        _tag: "CampaignAudienceNotFound",
      });
    });
  }
);
