import "@/shared/testing/workspace-test-env";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type {
  AutomationFlow,
  CalendarExpression,
} from "@deskohub/workspace-admin-api";
import { eq, isNull } from "drizzle-orm";
import { Data, Effect, Layer } from "effect";
import {
  emailCampaignAutomations as automationsTable,
  customerMarketingConsents,
  emailCampaignAutomationScheduleFires as firesTable,
} from "@/db/schema";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { AudienceFilter } from "../../audience-filter";
import {
  deleteAutomatedCampaigns,
  seedAutomatedCampaign,
  seedAutomatedSend,
  seedAutomation,
  seedAutomationVersion,
} from "../../backend/email-campaigns.test-utils";
import type { CampaignId } from "../../campaign-identifiers";
import type { AutomationStepId } from "../automation-identifiers";
import {
  entryEngineLayer,
  makeEngineDotypos,
  makeEngineFixtures,
  planAndProcess,
  runEngineAt,
} from "./automation-engine-scenario.test-utils";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import { AutomationPlanner } from "./automation-planner.service";
import {
  planNextFire,
  type ScheduleFirePlan,
  scheduleDedupKey,
} from "./automation-schedule-fires";
import { makeAutomationUnitQueueFake } from "./automation-unit-queue.test-utils";

/**
 * The engine plans over whole tables, so the suite runs on a database of
 * its own.
 */
const database = await createWorkspacePostgresSuiteDatabase(
  "automation_schedule_planning"
);
afterAll(() => database?.close());
// 12:00 in Prague (CEST).
const now = Temporal.Instant.from("2026-10-19T10:00:00Z");
const prefix = `schedule-planning-${crypto.randomUUID()}`;

/** 10:00 Prague every day: 08:00Z while CEST lasts. */
const tenOClock: CalendarExpression = { minutes: [0], hours: [10] };
const fireAt = (daysAgo: number, hourUtc = 8) =>
  Temporal.Instant.from(
    `2026-10-${String(19 - daysAgo).padStart(2, "0")}T${String(hourUtc).padStart(2, "0")}:00:00Z`
  );

const scheduleFlow = (calendar: CalendarExpression): AutomationFlow => ({
  trigger: { _tag: "Schedule", calendar },
  steps: [{ _tag: "Send", id: "send" as AutomationStepId }],
});

class RolledBack extends Data.TaggedError("RolledBack")<{
  readonly result: {
    readonly plan: ScheduleFirePlan;
    readonly fires: readonly unknown[];
    readonly nextFireAt: Temporal.Instant | null | undefined;
  };
}> {}

describe.skipIf(!database)("schedule fires on Postgres", () => {
  if (!database) return;
  const { db, pool } = database;
  const dotypos = makeEngineDotypos();
  const fixtures = makeEngineFixtures(database, dotypos, prefix);
  const campaignIds: CampaignId[] = [];

  afterEach(async () => {
    await deleteAutomatedCampaigns(db, campaignIds.splice(0));
  });
  afterAll(() => fixtures.cleanup());

  const automation = async (input: {
    readonly nextFireAt: Temporal.Instant;
    readonly calendar?: CalendarExpression;
    readonly audienceFilter?: AudienceFilter;
  }) => {
    const campaignId = await seedAutomatedCampaign(db, {
      purpose: "marketing",
    });
    campaignIds.push(campaignId);
    const versionId = await seedAutomationVersion(db, {
      campaignId,
      purpose: "marketing",
      flow: scheduleFlow(input.calendar ?? tenOClock),
      ...(input.audienceFilter && { audienceFilter: input.audienceFilter }),
      activatedAt: fireAt(10),
    });
    await seedAutomation(db, {
      campaignId,
      activeVersionId: versionId,
      acceptingSince: fireAt(10),
      nextFireAt: input.nextFireAt,
    });
    return { campaignId, versionId };
  };

  const engine = async () => {
    const queue = makeAutomationUnitQueueFake();
    const layer = await entryEngineLayer({ database, dotypos, queue });
    return {
      layer,
      plan: (at = now) =>
        runEngineAt(
          Effect.flatMap(AutomationPlanner, (planner) => planner.plan),
          layer,
          at
        ),
      process: (at = now) => runEngineAt(planAndProcess(queue), layer, at),
    };
  };

  const firesOf = async (campaignId: CampaignId) =>
    (
      await pool.query(
        "select to_char(fire_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') as fire_at, version_id, status, chunks_total, chunks_done, entered_count from email_campaign_automation_schedule_fires where campaign_id = $1 order by fire_at",
        [campaignId]
      )
    ).rows;

  const nextFireOf = async (campaignId: CampaignId) =>
    (
      await pool.query(
        "select to_char(next_fire_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') as next from email_campaign_automations where campaign_id = $1",
        [campaignId]
      )
    ).rows[0].next as string | null;

  const receiptsOf = async (campaignId: CampaignId) =>
    (
      await pool.query(
        "select dedup_key, disposition from email_campaign_automation_trigger_receipts where campaign_id = $1 order by dedup_key",
        [campaignId]
      )
    ).rows.map((row) => [row.dedup_key, row.disposition]);

  test("enters fires with an empty pool at once and chains to the next due fire", async () => {
    const { campaignId } = await automation({ nextFireAt: fireAt(2) });
    const evaluationFacts = AutomationEvaluationFacts.Default.pipe(
      Layer.provide(Layer.merge(database.layer, dotypos.layer))
    );

    // An empty marketing pool means no active consent anywhere, so the
    // transaction withdraws them all and rolls back.
    const result = await Effect.runPromise(
      db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx
              .update(customerMarketingConsents)
              .set({ withdrawnAt: now })
              .where(isNull(customerMarketingConsents.withdrawnAt));
            const plan = yield* planNextFire(tx, campaignId, now);
            const fires = yield* tx
              .select({
                fireAt: firesTable.fireAt,
                status: firesTable.status,
                chunksTotal: firesTable.chunksTotal,
              })
              .from(firesTable)
              .where(eq(firesTable.campaignId, campaignId))
              .orderBy(firesTable.fireAt);
            const [automationRow] = yield* tx
              .select({ nextFireAt: automationsTable.nextFireAt })
              .from(automationsTable)
              .where(eq(automationsTable.campaignId, campaignId));
            return yield* new RolledBack({
              result: { plan, fires, nextFireAt: automationRow?.nextFireAt },
            });
          })
        )
        .pipe(
          Effect.catchTag("RolledBack", ({ result }) => Effect.succeed(result)),
          Effect.provide(evaluationFacts)
        )
    );

    expect(result.plan).toEqual({
      firesCreated: 3,
      firesEntered: 3,
      chunksPlanned: 0,
    });
    expect(result.fires).toEqual(
      [2, 1, 0].map((daysAgo) => ({
        fireAt: fireAt(daysAgo),
        status: "entered",
        chunksTotal: 0,
      }))
    );
    expect(result.nextFireAt).toEqual(fireAt(-1));
    // Rolled back.
    expect(await firesOf(campaignId)).toEqual([]);
  });

  test("replays three missed fires in order, one entering at a time, with trigger_at = F (D34)", async () => {
    const { campaignId, versionId } = await automation({
      nextFireAt: fireAt(2),
    });
    const alice = await fixtures.addCustomer("replay-alice");
    const bob = await fixtures.addCustomer("replay-bob");
    const { plan, process } = await engine();

    await plan();
    expect(await firesOf(campaignId)).toEqual([
      expect.objectContaining({
        fire_at: fireAt(2).toString(),
        version_id: versionId,
        status: "entering",
        chunks_done: 0,
      }),
    ]);
    expect(await nextFireOf(campaignId)).toBe(fireAt(2).toString());

    await process();

    const fires = await firesOf(campaignId);
    expect(fires.map(({ fire_at, status }) => [fire_at, status])).toEqual(
      [2, 1, 0].map((daysAgo) => [fireAt(daysAgo).toString(), "entered"])
    );
    for (const fire of fires) {
      expect(fire.chunks_done).toBe(fire.chunks_total);
      expect(fire.entered_count).toBe(2);
    }
    expect(await nextFireOf(campaignId)).toBe(fireAt(-1).toString());
    const receipts = await receiptsOf(campaignId);
    for (const customer of [alice, bob]) {
      expect(receipts.filter(([key]) => key.endsWith(`:${customer}`))).toEqual(
        [2, 1, 0].map((daysAgo) => [
          scheduleDedupKey(fireAt(daysAgo), customer),
          daysAgo === 2 ? "started" : "already-active",
        ])
      );
    }
    const { rows: runs } = await pool.query(
      "select dotypos_customer_id, trigger_kind, (extract(epoch from trigger_at) * 1000)::bigint::text as trigger_ms, status, phase, step_id from email_campaign_automation_runs where campaign_id = $1 order by dotypos_customer_id",
      [campaignId]
    );
    expect(runs).toEqual(
      [alice, bob].toSorted().map((customer) => ({
        dotypos_customer_id: customer,
        trigger_kind: "schedule",
        trigger_ms: String(fireAt(2).epochMilliseconds),
        status: "active",
        phase: "ready",
        step_id: "send",
      }))
    );
  });

  test("evaluates 'this campaign = 0' against the automation's own sends", async () => {
    const { campaignId, versionId } = await automation({
      nextFireAt: fireAt(0),
      audienceFilter: {
        _tag: "Group",
        operator: "and",
        filters: [
          {
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
        ],
      } as AudienceFilter,
    });
    const mailed = await fixtures.addCustomer("this-mailed");
    const fresh = await fixtures.addCustomer("this-fresh");
    await seedAutomatedSend(db, {
      campaignId,
      versionId,
      purpose: "marketing",
      recipients: [{ dotyposCustomerId: mailed, status: "sent" }],
    });
    const { process } = await engine();

    await process();

    const receipts = await receiptsOf(campaignId);
    expect(receipts.filter(([key]) => key.endsWith(`:${fresh}`))).toEqual([
      [scheduleDedupKey(fireAt(0), fresh), "started"],
    ]);
    expect(receipts.filter(([key]) => key.endsWith(`:${mailed}`))).toEqual([]);
  });

  test("follows a version activated mid-backlog from its activation on", async () => {
    const { campaignId, versionId } = await automation({
      nextFireAt: fireAt(2),
    });
    // 12:00 Prague (10:00Z) from yesterday 12:00Z on.
    const v2 = await seedAutomationVersion(db, {
      campaignId,
      purpose: "marketing",
      versionNumber: 2,
      flow: scheduleFlow({ minutes: [0], hours: [12] }),
      activatedAt: fireAt(1, 12),
    });
    await fixtures.addCustomer("versions");
    const { process } = await engine();

    await process();

    expect(
      (await firesOf(campaignId)).map(({ fire_at, version_id, status }) => [
        fire_at,
        version_id,
        status,
      ])
    ).toEqual([
      [fireAt(2).toString(), versionId, "entered"],
      [fireAt(1).toString(), versionId, "entered"],
      [fireAt(0, 10).toString(), v2, "entered"],
    ]);
    expect(await nextFireOf(campaignId)).toBe(fireAt(-1, 10).toString());
  });

  test("drops a fire's chunks when the automation paused before they committed", async () => {
    const { campaignId } = await automation({ nextFireAt: fireAt(0) });
    await fixtures.addCustomer("paused");
    const { plan, process } = await engine();
    await plan();
    await pool.query(
      "update email_campaigns set status = 'paused' where id = $1",
      [campaignId]
    );
    await pool.query(
      "update email_campaign_automations set accepting_since = null, next_fire_at = null, paused_at = $2 where campaign_id = $1",
      [campaignId, now.toString()]
    );

    await process();

    const { rows: units } = await pool.query(
      "select status, last_error_code from email_campaign_automation_work_units where campaign_id = $1",
      [campaignId]
    );
    expect(units.length).toBeGreaterThan(0);
    expect(units).toEqual(
      units.map(() => ({
        status: "dropped",
        last_error_code: "fire-not-entering",
      }))
    );
    expect(await receiptsOf(campaignId)).toEqual([]);
  });
});
