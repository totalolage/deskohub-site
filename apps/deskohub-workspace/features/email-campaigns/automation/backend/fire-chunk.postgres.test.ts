import "@/shared/testing/workspace-test-env";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import type {
  AutomationFlow,
  CalendarExpression,
} from "@deskohub/workspace-admin-api";
import { Effect, Schema } from "effect";
import {
  emailCampaignAutomationScheduleFires as fires,
  emailCampaignAutomationWorkUnits as units,
} from "@/db/schema";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  deleteAutomatedCampaigns,
  seedAutomatedCampaign,
  seedAutomation,
  seedAutomationVersion,
} from "../../backend/email-campaigns.test-utils";
import type { CampaignId } from "../../campaign-identifiers";
import type {
  AutomationStepId,
  AutomationVersionId,
} from "../automation-identifiers";
import { automationWorkUnitPriorities } from "../automation-work-units";
import {
  entryEngineLayer,
  makeEngineDotypos,
  makeEngineFixtures,
  runEngineAt,
} from "./automation-engine-scenario.test-utils";
import {
  fireChunkSubjectSchema,
  scheduleDedupKey,
} from "./automation-schedule-fires";
import { AutomationUnitProcessor } from "./automation-unit-processor.service";
import { makeAutomationUnitQueueFake } from "./automation-unit-queue.test-utils";

/**
 * A finished fire plans the next over every active consent, and settling a
 * unit promotes other automations' units, so the suite runs on a database of
 * its own.
 */
const database = await createWorkspacePostgresSuiteDatabase(
  "automation_fire_chunk"
);
afterAll(() => database?.close());
const now = Temporal.Instant.from("2026-10-19T10:00:00Z");
const prefix = `fire-chunk-${crypto.randomUUID()}`;

/** 10:00 Prague every day: 08:00Z while CEST lasts. */
const tenOClock: CalendarExpression = { minutes: [0], hours: [10] };
const yesterday = Temporal.Instant.from("2026-10-18T08:00:00Z");
const today = Temporal.Instant.from("2026-10-19T08:00:00Z");
const tomorrow = Temporal.Instant.from("2026-10-20T08:00:00Z");

const scheduleFlow: AutomationFlow = {
  trigger: { _tag: "Schedule", calendar: tenOClock },
  steps: [{ _tag: "Send", id: "send" as AutomationStepId }],
};

describe.skipIf(!database)("fire-chunk units on Postgres", () => {
  if (!database) return;
  const { db, pool } = database;
  const dotypos = makeEngineDotypos();
  const fixtures = makeEngineFixtures(database, dotypos, prefix);
  const campaignIds: CampaignId[] = [];

  afterEach(async () => {
    await deleteAutomatedCampaigns(db, campaignIds.splice(0));
  });
  afterAll(() => fixtures.cleanup());

  /**
   * An active schedule automation whose fire at `fireAt` is entering with
   * one chunk unit per customer list.
   */
  const enteringFire = async (input: {
    readonly fireAt: Temporal.Instant;
    readonly chunks: readonly (readonly DotyposCustomerId[])[];
    readonly flow?: AutomationFlow | "undecodable";
    readonly deadlineMisses?: number;
  }) => {
    const campaignId = await seedAutomatedCampaign(db, {
      purpose: "marketing",
    });
    campaignIds.push(campaignId);
    const versionId = (await seedAutomationVersion(db, {
      campaignId,
      purpose: "marketing",
      ...(input.flow === "undecodable"
        ? { trigger: scheduleFlow.trigger }
        : { flow: input.flow ?? scheduleFlow }),
      activatedAt: now.subtract({ hours: 240 }),
    })) as AutomationVersionId;
    await seedAutomation(db, {
      campaignId,
      activeVersionId: versionId,
      acceptingSince: now.subtract({ hours: 240 }),
      nextFireAt: input.fireAt,
    });
    await Effect.runPromise(
      db.insert(fires).values({
        campaignId,
        fireAt: input.fireAt,
        versionId,
        status: "entering",
        chunksTotal: input.chunks.length,
      })
    );
    const unitIds = await Effect.runPromise(
      db
        .insert(units)
        .values(
          input.chunks.map((customerIds, index) => ({
            kind: "fire-chunk" as const,
            priority: automationWorkUnitPriorities["fire-chunk"],
            campaignId,
            key: `fire-chunk:${campaignId}:${input.fireAt.toString()}:${index}`,
            subject: Schema.encodeSync(fireChunkSubjectSchema)({
              fireAt: input.fireAt,
              customerIds: [...customerIds],
            }),
            requestCost: 1,
            status: "enqueued" as const,
            enqueuedAt: now,
            deadlineMisses: input.deadlineMisses ?? 0,
          }))
        )
        .returning({ id: units.id, key: units.key })
    ).then((rows) =>
      rows.toSorted((left, right) => left.key.localeCompare(right.key))
    );
    return {
      campaignId,
      versionId,
      unitIds: unitIds.map(({ id }) => id),
    };
  };

  const process = async (unitId: (typeof units.$inferSelect)["id"]) => {
    const layer = await entryEngineLayer({
      database,
      dotypos,
      queue: makeAutomationUnitQueueFake(),
    });
    return runEngineAt(
      Effect.flatMap(AutomationUnitProcessor, (processor) =>
        processor.process(unitId)
      ),
      layer,
      now
    );
  };

  const fireRows = async (campaignId: CampaignId) =>
    (
      await pool.query(
        "select (extract(epoch from fire_at) * 1000)::bigint::text as fire_ms, status, chunks_total, chunks_done, entered_count from email_campaign_automation_schedule_fires where campaign_id = $1 order by fire_at",
        [campaignId]
      )
    ).rows.map(({ fire_ms, ...fire }) => ({
      ...fire,
      fireAt: Temporal.Instant.fromEpochMilliseconds(Number(fire_ms)),
    }));

  const receiptsOf = async (campaignId: CampaignId) =>
    (
      await pool.query(
        "select dedup_key, disposition from email_campaign_automation_trigger_receipts where campaign_id = $1 order by dedup_key",
        [campaignId]
      )
    ).rows.map((row) => [row.dedup_key, row.disposition]);

  const nextFireOf = async (campaignId: CampaignId) =>
    (
      await pool.query(
        "select (extract(epoch from next_fire_at) * 1000)::bigint::text as next_ms from email_campaign_automations where campaign_id = $1",
        [campaignId]
      )
    ).rows[0].next_ms as string | null;

  test("counts each chunk, and the last one enters the fire, advances next_fire_at and plans the next fire", async () => {
    const alice = await fixtures.addCustomer("counters-alice");
    const bob = await fixtures.addCustomer("counters-bob");
    const { campaignId, unitIds } = await enteringFire({
      fireAt: yesterday,
      chunks: [[alice], [bob]],
    });

    await process(unitIds[0]!);

    expect(await fireRows(campaignId)).toEqual([
      {
        fireAt: yesterday,
        status: "entering",
        chunks_total: 2,
        chunks_done: 1,
        entered_count: 1,
      },
    ]);
    expect(await nextFireOf(campaignId)).toBe(
      String(yesterday.epochMilliseconds)
    );

    await process(unitIds[1]!);

    const [entered, next] = await fireRows(campaignId);
    expect(entered).toEqual({
      fireAt: yesterday,
      status: "entered",
      chunks_total: 2,
      chunks_done: 2,
      entered_count: 2,
    });
    expect(next).toMatchObject({ fireAt: today, status: "entering" });
    expect(await nextFireOf(campaignId)).toBe(String(today.epochMilliseconds));
    expect(await receiptsOf(campaignId)).toEqual(
      [alice, bob]
        .map((customer) => [scheduleDedupKey(yesterday, customer), "started"])
        .toSorted(([left], [right]) => left!.localeCompare(right!))
    );
  });

  test("deduplicates emails within a chunk", async () => {
    const shared = testEmailAddress(`${prefix.slice(-24)}-shared`);
    const alice = await fixtures.addCustomer("dedup-alice", { email: shared });
    const bob = await fixtures.addCustomer("dedup-bob", { email: shared });
    const { campaignId, unitIds } = await enteringFire({
      fireAt: today,
      chunks: [[alice, bob]],
    });

    await process(unitIds[0]!);

    // Neither has reserved, so the lower customer id is the recipient.
    const recipient = [alice, bob].toSorted()[0]!;
    expect(await receiptsOf(campaignId)).toEqual([
      [scheduleDedupKey(today, recipient), "started"],
    ]);
    expect(await fireRows(campaignId)).toEqual([
      expect.objectContaining({ status: "entered", entered_count: 1 }),
    ]);
    expect(await nextFireOf(campaignId)).toBe(
      String(tomorrow.epochMilliseconds)
    );
  });

  test("fails a solo chunk at the deadline-miss limit without fetching, and still completes the fire", async () => {
    const alice = await fixtures.addCustomer("solo-alice");
    const { campaignId, unitIds } = await enteringFire({
      fireAt: today,
      chunks: [[alice]],
      deadlineMisses: 3,
    });
    dotypos.resetCalls();

    const outcome = await process(unitIds[0]!);

    expect(outcome).toBe("done");
    expect(dotypos.calls.getCustomersByIds).toBe(0);
    expect(await receiptsOf(campaignId)).toEqual([
      [scheduleDedupKey(today, alice), "failed"],
    ]);
    expect(await fireRows(campaignId)).toEqual([
      {
        fireAt: today,
        status: "entered",
        chunks_total: 1,
        chunks_done: 1,
        entered_count: 0,
      },
    ]);
    const { rows } = await pool.query(
      "select count(*)::int as runs from email_campaign_automation_runs where campaign_id = $1",
      [campaignId]
    );
    expect(rows[0].runs).toBe(0);
  });

  test("counts an expired solo chunk once when its settlement fails and the unit is redelivered", async () => {
    const alice = await fixtures.addCustomer("replayed-alice");
    const bob = await fixtures.addCustomer("replayed-bob");
    const { campaignId, unitIds } = await enteringFire({
      fireAt: yesterday,
      chunks: [[alice], [bob]],
      deadlineMisses: 3,
    });
    const expiring = unitIds[0]!;
    const sibling = unitIds[1]!;
    // Fails the unit's `done` settlement after its expiry ran.
    const fault = `fail_settlement_${crypto.randomUUID().replaceAll("-", "")}`;
    try {
      await pool.query(
        `create function ${fault}() returns trigger language plpgsql as $$ begin raise exception 'settlement interrupted'; end $$`
      );
      await pool.query(
        `create trigger ${fault} before update on email_campaign_automation_work_units for each row when (new.status = 'done' and new.id = '${expiring}') execute function ${fault}()`
      );
      await expect(process(expiring)).rejects.toMatchObject({
        _tag: "AutomationUnitRedelivery",
      });
    } finally {
      try {
        await pool.query(
          `drop trigger if exists ${fault} on email_campaign_automation_work_units`
        );
      } finally {
        await pool.query(`drop function if exists ${fault}()`);
      }
    }

    // The expiry rolled back with the settlement, and the unit was requeued.
    expect(await fireRows(campaignId)).toEqual([
      expect.objectContaining({ status: "entering", chunks_done: 0 }),
    ]);
    expect(await receiptsOf(campaignId)).toEqual([]);
    const { rows: requeued } = await pool.query(
      "select status, last_error_code from email_campaign_automation_work_units where id = $1",
      [expiring]
    );
    expect(requeued).toEqual([
      { status: "enqueued", last_error_code: "database" },
    ]);

    expect(await process(expiring)).toBe("done");
    expect(await process(expiring)).toBe("acknowledged");

    expect(await fireRows(campaignId)).toEqual([
      expect.objectContaining({
        fireAt: yesterday,
        status: "entering",
        chunks_done: 1,
      }),
    ]);
    await pool.query(
      "update email_campaign_automation_work_units set deadline_misses = 0 where id = $1",
      [sibling]
    );
    expect(await process(sibling)).toBe("done");
    expect((await fireRows(campaignId))[0]).toEqual({
      fireAt: yesterday,
      status: "entered",
      chunks_total: 2,
      chunks_done: 2,
      entered_count: 1,
    });
    expect(await receiptsOf(campaignId)).toEqual(
      [
        [scheduleDedupKey(yesterday, alice), "failed"],
        [scheduleDedupKey(yesterday, bob), "started"],
      ].toSorted(([left], [right]) => left!.localeCompare(right!))
    );
  });

  test("fails the fire when its version's flow no longer decodes, and the next fire proceeds", async () => {
    const alice = await fixtures.addCustomer("undecodable-alice");
    const { campaignId, unitIds } = await enteringFire({
      fireAt: yesterday,
      chunks: [[alice]],
      flow: "undecodable",
    });

    await process(unitIds[0]!);

    const [failed, next] = await fireRows(campaignId);
    expect(failed).toMatchObject({ fireAt: yesterday, status: "failed" });
    expect(next).toMatchObject({ fireAt: today, status: "entering" });
    expect(await receiptsOf(campaignId)).toEqual([]);
  });

  test("drops the chunk when its fire is no longer entering", async () => {
    const alice = await fixtures.addCustomer("dropped-alice");
    const { campaignId, unitIds } = await enteringFire({
      fireAt: today,
      chunks: [[alice]],
    });
    await pool.query(
      "update email_campaign_automation_schedule_fires set status = 'dropped', settled_at = now() where campaign_id = $1",
      [campaignId]
    );

    const outcome = await process(unitIds[0]!);

    expect(outcome).toBe("dropped");
    expect(await receiptsOf(campaignId)).toEqual([]);
    expect(await fireRows(campaignId)).toEqual([
      expect.objectContaining({ status: "dropped", chunks_done: 0 }),
    ]);
  });
});
