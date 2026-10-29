import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  deleteAutomatedCampaigns,
  seedAutomatedCampaign,
  seedAutomationVersion,
} from "@/features/email-campaigns/backend/email-campaigns.test-utils";
import {
  type CampaignId,
  campaignIdSchema,
} from "@/features/email-campaigns/campaign-identifiers";
import {
  holdPostgresTransaction,
  waitForPostgresLockWaiter,
} from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  lockAutomationForEngine,
  lockAutomationForLifecycle,
} from "./automation-lifecycle-lock";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const acceptingSince = "2026-10-01T08:00:00Z";
const resumedAt = "2026-10-05T09:30:00Z";
const nextFireAt = "2026-10-20T07:00:00Z";

const notActive = {
  status: null,
  activeVersionId: null,
  acceptingSince: null,
  resumedAt: null,
  nextFireAt: null,
};

describe.skipIf(!testDatabase)(
  "automation lifecycle lock on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const { db, pool } = testDatabase;
    const campaignIds: CampaignId[] = [];

    afterAll(async () => {
      // The automation row references its active version, which the shared
      // cleanup deletes.
      await pool.query(
        "delete from email_campaign_automations where campaign_id = any($1)",
        [campaignIds]
      );
      await deleteAutomatedCampaigns(db, campaignIds);
    });

    /** An active automation with every lifecycle field set. */
    const activeAutomation = async () => {
      const campaignId = await seedAutomatedCampaign(db, {
        purpose: "marketing",
      });
      campaignIds.push(campaignId);
      const versionId = await seedAutomationVersion(db, {
        campaignId,
        purpose: "marketing",
      });
      await pool.query(
        `insert into email_campaign_automations
           (campaign_id, active_version_id, accepting_since, resumed_at, next_fire_at)
         values ($1, $2, $3, $4, $5)`,
        [campaignId, versionId, acceptingSince, resumedAt, nextFireAt]
      );
      return { campaignId, versionId };
    };

    const engineLock = (campaignId: CampaignId) =>
      Effect.runPromise(
        Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
          transaction(lockAutomationForEngine(campaignId))
        ).pipe(Effect.provide(testDatabase.layer))
      );

    const lifecycleLock = (campaignId: CampaignId) =>
      Effect.runPromise(
        Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
          transaction(lockAutomationForLifecycle(campaignId))
        ).pipe(Effect.provide(testDatabase.layer))
      );

    test("reads the lifecycle the engine rechecks", async () => {
      const { campaignId, versionId } = await activeAutomation();

      for (const state of [
        await engineLock(campaignId),
        await lifecycleLock(campaignId),
      ]) {
        expect({
          ...state,
          acceptingSince: state.acceptingSince?.toString(),
          resumedAt: state.resumedAt?.toString(),
          nextFireAt: state.nextFireAt?.toString(),
        }).toEqual({
          status: "active",
          activeVersionId: versionId,
          acceptingSince,
          resumedAt,
          nextFireAt,
        });
      }
    });

    test("reads a missing automation as not active", async () => {
      const draftWithoutAutomation = await seedAutomatedCampaign(db, {
        purpose: "marketing",
        status: "draft",
      });
      campaignIds.push(draftWithoutAutomation);

      for (const campaignId of [
        draftWithoutAutomation,
        campaignIdSchema.make(crypto.randomUUID()),
      ]) {
        expect(await engineLock(campaignId)).toEqual(notActive);
        expect(await lifecycleLock(campaignId)).toEqual(notActive);
      }
    });

    test("waits for a lifecycle change and reads it whole after the grant", async () => {
      const { campaignId } = await activeAutomation();
      const pause = await pool.connect();
      const {
        rows: [{ pid }],
      } = await pause.query("select pg_backend_pid() as pid");
      await pause.query("begin");
      await pause.query(
        "select 1 from email_campaign_automations where campaign_id = $1 for update",
        [campaignId]
      );
      await pause.query(
        "update email_campaigns set status = 'paused' where id = $1",
        [campaignId]
      );
      await pause.query(
        "update email_campaign_automations set accepting_since = null, paused_at = now() where campaign_id = $1",
        [campaignId]
      );

      const engine = engineLock(campaignId);
      await waitForPostgresLockWaiter(pool, {
        condition: "$1 = any(pg_blocking_pids(pid))",
        values: [pid],
        description: "the engine to wait on the lifecycle lock",
      });
      await pause.query("commit");
      pause.release();

      expect(await engine).toMatchObject({
        status: "paused",
        acceptingSince: null,
      });
    });

    test("takes the lifecycle lock exclusively against a shared engine lock", async () => {
      const { campaignId } = await activeAutomation();
      const engine = await holdPostgresTransaction(
        pool,
        "select 1 from email_campaign_automations where campaign_id = $1 for share",
        [campaignId]
      );

      const lifecycle = lifecycleLock(campaignId);
      await waitForPostgresLockWaiter(pool, {
        condition: "$1 = any(pg_blocking_pids(pid))",
        values: [engine.pid],
        description: "the lifecycle to wait on the engine's shared lock",
      });
      await engine.commit();

      expect((await lifecycle).status).toBe("active");
    });
  }
);
