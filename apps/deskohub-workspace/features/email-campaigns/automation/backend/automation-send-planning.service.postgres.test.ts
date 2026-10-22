import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { deleteAutomatedCampaigns } from "../../backend/email-campaigns.test-utils";
import type { CampaignId } from "../../campaign-identifiers";
import { AutomationSendPlanning } from "./automation-send-planning.service";
import {
  deliverProfile,
  makeDeliverEngine,
  seedDeliverAutomation,
  seedSendReadyRuns,
} from "./deliver.test-utils";

/**
 * The engine plans over whole tables, so the suite runs on a database of
 * its own.
 */
const database = await createWorkspacePostgresSuiteDatabase(
  "automation_send_planning"
);
afterAll(() => database?.close());

const startedAt = Temporal.Instant.from("2026-10-19T10:00:00Z");
const runKey = crypto.randomUUID().slice(0, 8);
const customerIds = (label: string, count: number) =>
  Array.from({ length: count }, (_, index) =>
    DotyposCustomerIdSchema.make(
      `plan-${runKey}-${label}-${String(index).padStart(3, "0")}`
    )
  );

describe.skipIf(!database)(
  "AutomationSendPlanning on disposable Postgres",
  () => {
    if (!database) return;
    const { db, pool } = database;
    const campaignIds: CampaignId[] = [];

    // A test that failed midway can't hold the deliver slot for the next.
    beforeEach(() =>
      pool.query(
        `update email_campaign_automation_work_units
          set status = 'dropped', claim_id = null, claim_expires_at = null, settled_at = now()
        where campaign_id = any($1) and status in ('planned', 'enqueued', 'claimed')`,
        [campaignIds]
      )
    );

    afterAll(() => deleteAutomatedCampaigns(db, campaignIds));

    const seedAutomation = async () => {
      const seeded = await seedDeliverAutomation(db, {
        activatedAt: startedAt.subtract({ hours: 48 }),
      });
      campaignIds.push(seeded.campaignId);
      return seeded;
    };

    const plan = (at: Temporal.Instant) =>
      Effect.runPromise(
        TestClock.setTime(at.epochMilliseconds).pipe(
          Effect.andThen(
            Effect.flatMap(AutomationSendPlanning, (planning) =>
              planning.plan(at)
            )
          ),
          Effect.provide(
            AutomationSendPlanning.Default.pipe(Layer.provide(database.layer))
          ),
          Effect.provide(TestClock.layer())
        )
      );

    const unitsOf = async (campaignId: CampaignId) => {
      const { rows } = await pool.query<{
        id: string;
        status: string;
        request_cost: number;
        run_ids: string[];
      }>(
        `select id, status, request_cost, array(select jsonb_array_elements_text(subject -> 'runIds')) as run_ids
         from email_campaign_automation_work_units
        where campaign_id = $1 and kind = 'deliver'
        order by created_at, id`,
        [campaignId]
      );
      return rows;
    };

    const ownersOf = async (campaignId: CampaignId) => {
      const { rows } = await pool.query<{ id: string; work_unit_id: string }>(
        "select id, work_unit_id from email_campaign_automation_runs where campaign_id = $1",
        [campaignId]
      );
      return rows;
    };

    test("300 send-ready runs make three deliver units that run one at a time", async () => {
      const customers = customerIds("bulk", 300);
      const engine = await makeDeliverEngine({
        database,
        customers: customers.map((id) => deliverProfile(id)),
      });
      const seeded = await seedAutomation();
      await seedSendReadyRuns(db, {
        ...seeded,
        runs: customers.map((customer) => ({ customer })),
        at: startedAt,
      });
      const inFlight: number[] = [];
      engine.resend.beforeEachRequest(async () => {
        const { rows } = await pool.query<{ count: number }>(
          "select count(*)::int as count from email_campaign_automation_work_units where kind = 'deliver' and status in ('enqueued', 'claimed')"
        );
        inFlight.push(rows[0]!.count);
      });

      await engine.planOnly(startedAt);

      const units = await unitsOf(seeded.campaignId);
      expect(units.map((unit) => unit.run_ids.length)).toEqual([100, 100, 100]);
      // Two profile pages per unit; account runs verify no reservation.
      expect(units.map((unit) => unit.request_cost)).toEqual([2, 2, 2]);
      expect(units.map((unit) => unit.status).sort()).toEqual([
        "enqueued",
        "planned",
        "planned",
      ]);
      const owners = await ownersOf(seeded.campaignId);
      const ownerOf = new Map(owners.map((run) => [run.id, run.work_unit_id]));
      for (const unit of units) {
        for (const runId of unit.run_ids)
          expect(ownerOf.get(runId)).toBe(unit.id);
      }
      expect(new Set(units.flatMap((unit) => unit.run_ids)).size).toBe(300);

      await engine.drain(startedAt);

      expect(inFlight).toEqual([1, 1, 1]);
      expect(engine.resend.requests()).toHaveLength(3);
      expect(new Set(engine.resend.mailed()).size).toBe(300);
      const { rows } = await pool.query<{ outcome: string; count: number }>(
        "select outcome, count(*)::int as count from email_campaign_automation_runs where campaign_id = $1 group by outcome",
        [seeded.campaignId]
      );
      expect(rows).toEqual([{ outcome: "sent", count: 300 }]);
      expect(
        (await unitsOf(seeded.campaignId)).map((unit) => unit.status)
      ).toEqual(["done", "done", "done"]);
    });

    test("overlapping planners give each run to one unit", async () => {
      const seeded = await seedAutomation();
      await seedSendReadyRuns(db, {
        ...seeded,
        runs: customerIds("overlap", 150).map((customer) => ({ customer })),
        at: startedAt,
      });

      const plans = await Promise.all([
        plan(startedAt),
        plan(startedAt.add({ seconds: 1 })),
      ]);

      expect(
        plans.reduce((total, { runsPlanned }) => total + runsPlanned, 0)
      ).toBe(150);
      const units = await unitsOf(seeded.campaignId);
      const planned = units.flatMap((unit) => unit.run_ids);
      expect(planned).toHaveLength(150);
      expect(new Set(planned).size).toBe(150);
      expect(units.every((unit) => unit.run_ids.length <= 100)).toBe(true);

      expect(await plan(startedAt.add({ minutes: 1 }))).toEqual({
        runsPlanned: 0,
        unitsPlanned: 0,
      });
    });

    test("plans only ready runs at the send step of active automations", async () => {
      const active = await seedAutomation();
      const paused = await seedAutomation();
      await pool.query(
        "update email_campaigns set status = 'paused' where id = $1",
        [paused.campaignId]
      );
      const [ready, elsewhere, waiting] = customerIds("scope", 3);
      await seedSendReadyRuns(db, {
        ...active,
        runs: [{ customer: ready! }],
        at: startedAt,
      });
      await seedSendReadyRuns(db, {
        ...active,
        runs: [{ customer: elsewhere! }],
        at: startedAt,
        stepId: "wait",
      });
      const [deferred] = await seedSendReadyRuns(db, {
        ...active,
        runs: [{ customer: waiting! }],
        at: startedAt,
      });
      await pool.query(
        "update email_campaign_automation_runs set phase = 'waiting' where id = $1",
        [deferred]
      );
      await seedSendReadyRuns(db, {
        ...paused,
        runs: [{ customer: ready! }],
        at: startedAt,
      });

      expect(await plan(startedAt)).toEqual({
        runsPlanned: 1,
        unitsPlanned: 1,
      });
      expect(await unitsOf(paused.campaignId)).toEqual([]);
      const [unit] = await unitsOf(active.campaignId);
      expect(unit!.run_ids).toHaveLength(1);
    });
  }
);
