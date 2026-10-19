import "@/shared/testing/workspace-test-env";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import type {
  AutomationFlow,
  CalendarExpression,
} from "@deskohub/workspace-admin-api";
import { Effect, Schema } from "effect";
import {
  emailCampaignAutomationScheduleFires as fires,
  emailCampaignAutomationWorkUnits as units,
} from "@/db/schema";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
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
  makeEntryDotypos,
  makeEntryFixtures,
  runEngineAt,
} from "./automation-entry.test-utils";
import {
  fireChunkSubjectSchema,
  scheduleDedupKey,
} from "./automation-schedule-fires";
import { AutomationUnitProcessor } from "./automation-unit-processor.service";
import { makeAutomationUnitQueueFake } from "./automation-unit-queue.test-utils";

const database = await connectWorkspacePostgresTestDatabase();
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
  const dotypos = makeEntryDotypos();
  const fixtures = makeEntryFixtures(database, dotypos, prefix);
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
    const shared = `${prefix.slice(-24)}-shared@example.test`;
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
    expect(dotypos.calls.getCustomersPage).toBe(0);
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
