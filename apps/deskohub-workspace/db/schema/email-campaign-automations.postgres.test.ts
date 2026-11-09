import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import type { PoolClient } from "pg";
import {
  deleteAutomatedCampaigns,
  seedAutomatedCampaign,
  seedAutomatedSend,
  seedAutomationVersion,
  seedCampaignSend,
} from "@/features/email-campaigns/backend/email-campaigns.test-utils";
import type { CampaignId } from "@/features/email-campaigns/campaign-identifiers";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const run = crypto.randomUUID().slice(0, 8);
const customerId = (name: string) =>
  DotyposCustomerIdSchema.make(`automation-schema-${run}-${name}`);

describe.skipIf(!testDatabase)(
  "automated campaign schema on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const { db, pool } = testDatabase;
    const campaignIds: CampaignId[] = [];
    const workUnitKeys: string[] = [];

    afterAll(async () => {
      await pool.query(
        "delete from email_campaign_automation_work_units where key = any($1)",
        [workUnitKeys]
      );
      await deleteAutomatedCampaigns(db, campaignIds);
    });

    const automatedCampaign = async () => {
      const campaignId = await seedAutomatedCampaign(db, {
        purpose: "marketing",
      });
      campaignIds.push(campaignId);
      const versionId = await seedAutomationVersion(db, {
        campaignId,
        purpose: "marketing",
      });
      return { campaignId, versionId };
    };

    /** Runs `write` in a transaction on one connection, then commits. */
    const inTransaction = async (
      write: (client: PoolClient) => Promise<void>
    ) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await write(client);
        await client.query("commit");
      } catch (cause) {
        await client.query("rollback");
        throw cause;
      } finally {
        client.release();
      }
    };

    const insertSendingRun = (
      client: Pick<PoolClient, "query">,
      input: {
        readonly campaignId: CampaignId;
        readonly versionId: string;
        readonly dotyposCustomerId: string;
        readonly sendId: string | null;
      }
    ) =>
      client.query(
        `insert into email_campaign_automation_runs
           (campaign_id, version_id, dotypos_customer_id, trigger_kind, trigger_at, status, step_id, step_entered_at, send_id)
         values ($1, $2, $3, 'account-created', now(), 'sending', 'send', now(), $4)`,
        [
          input.campaignId,
          input.versionId,
          input.dotyposCustomerId,
          input.sendId,
        ]
      );

    test("rejects every update and delete of a published version", async () => {
      const { versionId } = await automatedCampaign();
      const immutable = { code: "55000" };

      await expect(
        pool.query(
          "update email_campaign_automation_versions set draft_hash = 'edited' where id = $1",
          [versionId]
        )
      ).rejects.toMatchObject(immutable);
      await expect(
        pool.query(
          "delete from email_campaign_automation_versions where id = $1",
          [versionId]
        )
      ).rejects.toMatchObject(immutable);
      const { rows } = await pool.query(
        "select draft_hash from email_campaign_automation_versions where id = $1",
        [versionId]
      );
      expect(rows).toEqual([{ draft_hash: "draft-1" }]);
    });

    test("allows many automated sends per campaign but one one-off send", async () => {
      const { campaignId, sendId } = await seedCampaignSend(db, {
        purpose: "marketing",
        status: "sent",
        recipients: [],
      });
      campaignIds.push(campaignId);
      const versionId = await seedAutomationVersion(db, {
        campaignId,
        purpose: "marketing",
      });

      for (const name of ["first", "second"]) {
        await seedAutomatedSend(db, {
          campaignId,
          versionId,
          purpose: "marketing",
          recipients: [{ dotyposCustomerId: customerId(name) }],
        });
      }
      await expect(
        pool.query(
          "insert into email_campaign_sends (campaign_id, audience_filter, content_hash) select campaign_id, audience_filter, content_hash from email_campaign_sends where id = $1",
          [sendId]
        )
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "email_campaign_sends_once_campaign_unique_idx",
      });
      const { rows } = await pool.query(
        "select count(*)::int as sends from email_campaign_sends where campaign_id = $1",
        [campaignId]
      );
      expect(rows).toEqual([{ sends: 3 }]);
    });

    test("checks a run's recipient only when its transaction commits", async () => {
      const { campaignId, versionId } = await automatedCampaign();
      const sendId = await seedAutomatedSend(db, {
        campaignId,
        versionId,
        purpose: "marketing",
        recipients: [],
      });
      const carried = customerId("carried");

      await inTransaction(async (client) => {
        await insertSendingRun(client, {
          campaignId,
          versionId,
          dotyposCustomerId: carried,
          sendId,
        });
        await client.query(
          "insert into email_campaign_recipients (send_id, dotypos_customer_id, locale) values ($1, $2, 'cs-CZ')",
          [sendId, carried]
        );
      });

      await expect(
        inTransaction((client) =>
          insertSendingRun(client, {
            campaignId,
            versionId,
            dotyposCustomerId: customerId("never-carried"),
            sendId,
          }).then(() => {})
        )
      ).rejects.toMatchObject({
        code: "23503",
        constraint: "email_campaign_automation_runs_recipient_fk",
      });
      const { rows } = await pool.query(
        "select dotypos_customer_id from email_campaign_automation_runs where send_id = $1",
        [sendId]
      );
      expect(rows).toEqual([{ dotypos_customer_id: carried }]);
    });

    test("seeds the engine row and both sweep cursors", async () => {
      const engine = await pool.query(
        "select id from email_campaign_automation_engine"
      );
      const sweeps = await pool.query(
        "select source from customer_event_sweeps where source in ('reservation-activity', 'reservation-activity-reconcile') order by source"
      );

      expect(engine.rows).toEqual([{ id: 1 }]);
      expect(sweeps.rows).toEqual([
        { source: "reservation-activity" },
        { source: "reservation-activity-reconcile" },
      ]);
    });

    test("rejects a sending run without a send", async () => {
      const { campaignId, versionId } = await automatedCampaign();

      await expect(
        insertSendingRun(pool, {
          campaignId,
          versionId,
          dotyposCustomerId: customerId("unsent"),
          sendId: null,
        })
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "email_campaign_automation_runs_status_check",
      });
    });

    test("rejects an active run without a phase", async () => {
      const { campaignId, versionId } = await automatedCampaign();

      await expect(
        pool.query(
          `insert into email_campaign_automation_runs
             (campaign_id, version_id, dotypos_customer_id, trigger_kind, trigger_at,
              status, step_id, phase, step_entered_at, due_at)
           values ($1, $2, $3, 'account-created', now(),
              'active', 'delay', null, now(), now() + interval '1 minute')`,
          [campaignId, versionId, customerId("phaseless")]
        )
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "email_campaign_automation_runs_status_check",
      });
    });

    test("rejects a claimed work unit without a claim", async () => {
      const key = `automation-schema-${run}-claimed`;
      workUnitKeys.push(key);

      await expect(
        pool.query(
          `insert into email_campaign_automation_work_units (kind, priority, key, subject, request_cost, status)
           values ('sweep-page', 0, $1, '{}', 0, 'claimed')`,
          [key]
        )
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "email_campaign_automation_work_units_claim_check",
      });
    });
  }
);
