import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Effect } from "effect";
import {
  linkMigrationsBefore,
  withScratchDatabase,
  workspaceMigrationsFolder,
} from "@/db/migration-scratch-database.test-utils";
import {
  campaignContentFixture,
  everyoneFilter,
} from "@/features/email-campaigns/backend/email-campaigns.test-utils";
import { campaignDeliveryBatchIdempotencyKey } from "@/features/email-campaigns/campaign-delivery-batches";
import { renderCampaignEmailPreview } from "@/features/email-campaigns/campaign-email";

const migration = "20261101154650_perfect_victor_mancha";
const databaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)(
  "email foundation additive migration rehearsal",
  () => {
    test("keeps synthetic legacy rendering, recipient and persisted retry identities unchanged", async () => {
      const folder = await linkMigrationsBefore(migration);
      try {
        await withScratchDatabase(
          databaseUrl!,
          "email_foundation_migration",
          async (pool) => {
            const connection = drizzle({ client: pool });
            await migrate(connection, { migrationsFolder: folder });
            const content = campaignContentFixture("Synthetic legacy message");
            await pool.query(
              "insert into email_campaigns (id, title, purpose, template_key, content, delivery, status) values ('legacy-once', 'Synthetic once', 'operational', 'workspace', $1, 'once', 'sending'), ('legacy-auto', 'Synthetic auto', 'operational', 'workspace', $1, 'automated', 'paused')",
              [content]
            );
            await pool.query(
              "insert into email_campaign_automation_versions (id, campaign_id, version_number, flow, purpose, template_key, content, content_hash, audience_filter, draft_hash) values ('legacy-version', 'legacy-auto', 1, $1, 'operational', 'workspace', $2, 'legacy-content-hash', $3, 'legacy-draft-hash')",
              [
                {
                  trigger: { _tag: "ReservationBooked" },
                  steps: [{ _tag: "Send", id: "send" }],
                },
                content,
                everyoneFilter,
              ]
            );
            await pool.query(
              "insert into email_campaign_sends (id, campaign_id, automation_version_id, audience_filter, content_hash, delivery_attempt, delivery_lease_id, delivery_lease_expires_at) values ('legacy-send', 'legacy-once', null, $1, 'legacy-content-hash', 3, 'legacy-lease', '2027-01-10T12:00:00Z'), ('legacy-auto-send', 'legacy-auto', 'legacy-version', $1, 'legacy-content-hash', 2, null, null)",
              [everyoneFilter]
            );
            await pool.query(
              "insert into email_campaign_recipients (send_id, dotypos_customer_id, locale, status, delivery_attempt) values ('legacy-send', 'synthetic-legacy', 'cs-CZ', 'pending', 3), ('legacy-auto-send', 'synthetic-auto', 'cs-CZ', 'pending', 2)"
            );
            await pool.query(
              "insert into email_campaign_delivery_batches (send_id, delivery_attempt, batch_index, payload_hash, dotypos_customer_ids, status, requested_at) values ('legacy-send', 3, 0, 'legacy-payload-hash', ARRAY['synthetic-legacy'], 'requested', '2027-01-10T11:00:00Z')"
            );
            const capture = async () => ({
              campaigns: (
                await pool.query(
                  "select to_jsonb(t) - 'email_id' as row from email_campaigns t order by id"
                )
              ).rows,
              versions: (
                await pool.query(
                  "select to_jsonb(t) - 'email_id' as row from email_campaign_automation_versions t order by id"
                )
              ).rows,
              sends: (
                await pool.query(
                  "select to_jsonb(t) - 'frozen_email_version_id' as row from email_campaign_sends t order by id"
                )
              ).rows,
              recipients: (
                await pool.query(
                  "select to_jsonb(t) as row from email_campaign_recipients t order by send_id"
                )
              ).rows,
              retryKeys: (
                await pool.query(
                  "select send_id, delivery_attempt, batch_index from email_campaign_delivery_batches order by send_id"
                )
              ).rows.map((row) =>
                campaignDeliveryBatchIdempotencyKey({
                  sendId: row.send_id,
                  deliveryAttempt: row.delivery_attempt,
                  batchIndex: row.batch_index,
                })
              ),
              batches: (
                await pool.query(
                  "select to_jsonb(t) as row from email_campaign_delivery_batches t order by send_id"
                )
              ).rows,
            });
            const render = async () => {
              const campaign = (
                await pool.query(
                  "select template_key, content from email_campaigns where id = 'legacy-once'"
                )
              ).rows[0];
              return Effect.runPromise(
                renderCampaignEmailPreview({
                  templateKey: campaign.template_key,
                  purpose: "operational",
                  locale: "cs-CZ",
                  content: campaign.content["cs-CZ"],
                })
              );
            };
            const before = await capture();
            const renderedBefore = await render();
            await migrate(connection, {
              migrationsFolder: workspaceMigrationsFolder,
            });
            expect(await capture()).toEqual(before);
            expect(await render()).toEqual(renderedBefore);
            expect(
              (
                await pool.query("select email_id from email_campaigns")
              ).rows.every((row) => row.email_id === null)
            ).toBe(true);
            expect(
              (
                await pool.query(
                  "select frozen_email_version_id from email_campaign_sends"
                )
              ).rows.every((row) => row.frozen_email_version_id === null)
            ).toBe(true);
            expect(
              (
                await pool.query(
                  "select count(*)::integer as count from email_preparations"
                )
              ).rows[0].count
            ).toBe(0);
            // A second migration pass leaves persisted provider retry identity alone.
            await migrate(connection, {
              migrationsFolder: workspaceMigrationsFolder,
            });
            expect(await capture()).toEqual(before);
          }
        );
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    });
  }
);
