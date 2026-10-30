import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  deleteAutomatedCampaigns,
  seedAutomatedCampaign,
  seedAutomatedSend,
  seedAutomationVersion,
} from "@/features/email-campaigns/backend/email-campaigns.test-utils";
import type {
  CampaignId,
  CampaignSendId,
} from "@/features/email-campaigns/campaign-identifiers";
import type { CampaignRecipientStatus } from "@/features/email-campaigns/campaign-states";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { AutomationRunSettlement } from "./automation-run-settlement.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const suite = crypto.randomUUID().slice(0, 8);
const customerId = (name: string) =>
  DotyposCustomerIdSchema.make(`automation-settlement-${suite}-${name}`);

const settledAt = Temporal.Instant.from("2026-10-19T12:00:00Z");

/** Each recipient status with the run outcome and reason it settles to. */
const recipients: readonly {
  readonly status: CampaignRecipientStatus;
  readonly skipReason?: string;
  readonly outcome: string;
  readonly reason: string | null;
}[] = [
  { status: "sent", outcome: "sent", reason: null },
  { status: "delivered", outcome: "sent", reason: null },
  { status: "complained", outcome: "sent", reason: null },
  { status: "bounced", outcome: "sent", reason: null },
  { status: "unconfirmed", outcome: "unconfirmed", reason: null },
  {
    status: "skipped",
    skipReason: "outside-test-domain",
    outcome: "skipped",
    reason: "outside-test-domain",
  },
  {
    status: "skipped",
    skipReason: "consent-withdrawn",
    outcome: "skipped",
    reason: "consent-withdrawn",
  },
  { status: "failed", outcome: "failed", reason: "delivery-refused" },
];

describe.skipIf(!testDatabase)(
  "automation run settlement on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const { db, pool } = testDatabase;
    const campaignIds: CampaignId[] = [];

    afterAll(() => deleteAutomatedCampaigns(db, campaignIds));

    const automation = async () => {
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

    /** Seeds a send whose runs are `sending`, one per recipient. */
    const seedSendingRuns = async (
      input: Awaited<ReturnType<typeof automation>> & {
        readonly name: string;
        readonly recipients: readonly {
          readonly status: CampaignRecipientStatus;
          readonly skipReason?: string;
        }[];
      }
    ) => {
      const customers = input.recipients.map((_, index) =>
        customerId(`${input.name}-${index}`)
      );
      const sendId = await seedAutomatedSend(db, {
        ...input,
        purpose: "marketing",
        recipients: input.recipients.map((recipient, index) => ({
          dotyposCustomerId: customers[index]!,
          status:
            recipient.skipReason === undefined ? recipient.status : "pending",
        })),
      });
      for (const [index, recipient] of input.recipients.entries()) {
        if (recipient.skipReason === undefined) continue;
        await pool.query(
          `update email_campaign_recipients set status = 'skipped', skip_reason = $3
           where send_id = $1 and dotypos_customer_id = $2`,
          [sendId, customers[index], recipient.skipReason]
        );
      }
      for (const customer of customers) {
        await pool.query(
          `insert into email_campaign_automation_runs
             (campaign_id, version_id, dotypos_customer_id, trigger_kind, trigger_at, status, step_id, step_entered_at, send_id)
           values ($1, $2, $3, 'account-created', now(), 'sending', 'send', now(), $4)`,
          [input.campaignId, input.versionId, customer, sendId]
        );
      }
      return { sendId, customers };
    };

    const settle = (sendId: CampaignSendId) =>
      Effect.runPromise(
        Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
          transaction(
            Effect.gen(function* () {
              const settlement = yield* AutomationRunSettlement;
              yield* settlement.settle({ sendId, at: settledAt });
            })
          )
        ).pipe(
          Effect.provide(
            Layer.mergeAll(AutomationRunSettlement.Default, testDatabase.layer)
          )
        )
      );

    const runsOf = async (sendId: CampaignSendId) => {
      const { rows } = await pool.query(
        `select r.dotypos_customer_id, r.status, r.outcome, r.outcome_reason,
                r.ended_at = $2::timestamptz as ended_at_settled,
                coalesce(json_agg(json_build_object('kind', e.kind, 'step', e.step_id, 'detail', e.detail)
                  order by e.sequence) filter (where e.run_id is not null), '[]') as timeline
         from email_campaign_automation_runs r
         left join email_campaign_automation_run_events e on e.run_id = r.id
         where r.send_id = $1
         group by r.id order by r.dotypos_customer_id`,
        [sendId, settledAt.toString()]
      );
      return Object.fromEntries(
        rows.map(({ dotypos_customer_id, ...run }) => [
          dotypos_customer_id,
          run,
        ])
      );
    };

    test("ends each sending run from its recipient's settled status", async () => {
      const seeded = await automation();
      const { sendId, customers } = await seedSendingRuns({
        ...seeded,
        name: "statuses",
        recipients,
      });

      await settle(sendId);

      expect(await runsOf(sendId)).toEqual(
        Object.fromEntries(
          recipients.map((recipient, index) => [
            customers[index],
            {
              status: "ended",
              outcome: recipient.outcome,
              outcome_reason: recipient.reason,
              ended_at_settled: true,
              timeline: [
                {
                  kind: recipient.outcome,
                  step: "send",
                  detail:
                    recipient.reason === null
                      ? {}
                      : { reason: recipient.reason },
                },
              ],
            },
          ])
        )
      );
    });

    test("leaves a pending recipient's run sending and other sends' runs alone", async () => {
      const seeded = await automation();
      const settled = await seedSendingRuns({
        ...seeded,
        name: "pending",
        recipients: [{ status: "sent" }, { status: "pending" }],
      });
      const other = await seedSendingRuns({
        ...seeded,
        name: "other",
        recipients: [{ status: "sent" }],
      });

      await settle(settled.sendId);

      const runs = await runsOf(settled.sendId);
      expect(runs[settled.customers[0]!]).toMatchObject({
        status: "ended",
        outcome: "sent",
      });
      expect(runs[settled.customers[1]!]).toMatchObject({
        status: "sending",
        outcome: null,
        timeline: [],
      });
      expect((await runsOf(other.sendId))[other.customers[0]!]).toMatchObject({
        status: "sending",
        timeline: [],
      });
    });

    test("ends nothing when the send's runs already settled", async () => {
      const seeded = await automation();
      const { sendId, customers } = await seedSendingRuns({
        ...seeded,
        name: "replayed",
        recipients: [{ status: "delivered" }],
      });

      await settle(sendId);
      await settle(sendId);

      expect((await runsOf(sendId))[customers[0]!]).toMatchObject({
        outcome: "sent",
        timeline: [{ kind: "sent" }],
      });
    });
  }
);
