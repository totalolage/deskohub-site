import "@/shared/testing/workspace-test-env";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type {
  AutomationFlow,
  CalendarExpression,
} from "@deskohub/workspace-admin-api";
import { eq, isNull } from "drizzle-orm";
import { Data, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  emailCampaignAutomations as automationsTable,
  customerMarketingConsents,
  emailCampaignAutomationScheduleFires as firesTable,
} from "@/db/schema";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  deleteAutomatedCampaigns,
  seedAutomatedCampaign,
  seedAutomation,
  seedAutomationVersion,
} from "../../backend/email-campaigns.test-utils";
import type { CampaignId } from "../../campaign-identifiers";
import type { AutomationStepId } from "../automation-identifiers";
import {
  makeEngineDotypos,
  makeEngineFixtures,
} from "./automation-engine-scenario.test-utils";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import {
  planNextFire,
  type ScheduleFirePlan,
} from "./automation-schedule-fires";

/** Planning withdraws every consent in its transaction, so it runs alone. */
const database = await createWorkspacePostgresSuiteDatabase(
  "automation_schedule_fires"
);
afterAll(() => database?.close());
// 12:00 in Prague (CEST).
const now = Temporal.Instant.from("2026-10-19T10:00:00Z");
const prefix = `schedule-fires-${crypto.randomUUID()}`;
const hoursAgo = (hours: number) => now.subtract({ hours });

const noFires: ScheduleFirePlan = {
  firesCreated: 0,
  firesEntered: 0,
  chunksPlanned: 0,
};

/** Every hour on the hour. */
const hourly: CalendarExpression = { minutes: [0] };
const scheduleFlow = (calendar: CalendarExpression): AutomationFlow => ({
  trigger: { _tag: "Schedule", calendar },
  steps: [{ _tag: "Send", id: "send" as AutomationStepId }],
});

type PlannedFires = {
  readonly plan: ScheduleFirePlan;
  readonly fires: ReadonlyArray<{
    readonly fireAt: Temporal.Instant;
    readonly status: string;
  }>;
  readonly nextFireAt: Temporal.Instant | null | undefined;
};

class RolledBack extends Data.TaggedError("RolledBack")<{
  readonly result: PlannedFires;
}> {}

describe.skipIf(!database)("planNextFire on Postgres", () => {
  if (!database) return;
  const { db, pool } = database;
  const dotypos = makeEngineDotypos();
  const fixtures = makeEngineFixtures(database, dotypos, prefix);
  const campaignIds: CampaignId[] = [];
  const evaluationFacts = AutomationEvaluationFacts.Default.pipe(
    Layer.provide(Layer.merge(database.layer, dotypos.layer))
  );

  afterEach(async () => {
    await deleteAutomatedCampaigns(db, campaignIds.splice(0));
  });
  afterAll(() => fixtures.cleanup());

  const automation = async (input: {
    readonly nextFireAt: Temporal.Instant | null;
    readonly activatedAt?: Temporal.Instant;
    readonly acceptingSince?: Temporal.Instant | null;
  }) => {
    const campaignId = await seedAutomatedCampaign(db, {
      purpose: "marketing",
    });
    campaignIds.push(campaignId);
    const versionId = await seedAutomationVersion(db, {
      campaignId,
      purpose: "marketing",
      flow: scheduleFlow(hourly),
      activatedAt: input.activatedAt ?? hoursAgo(100),
    });
    await seedAutomation(db, {
      campaignId,
      activeVersionId: versionId,
      acceptingSince:
        input.acceptingSince === undefined
          ? hoursAgo(100)
          : input.acceptingSince,
      nextFireAt: input.nextFireAt,
    });
    return campaignId;
  };

  /**
   * Plans in a transaction that withdraws every consent, so each fire's
   * marketing pool is empty, and rolls it back.
   */
  const planWithEmptyPool = (campaignId: CampaignId) =>
    Effect.runPromise(
      Effect.flatMap(WorkspaceDatabase, ({ db, transaction }) =>
        transaction(
          Effect.gen(function* () {
            yield* db
              .update(customerMarketingConsents)
              .set({ withdrawnAt: now })
              .where(isNull(customerMarketingConsents.withdrawnAt));
            const plan = yield* planNextFire(campaignId, now);
            const fires = yield* db
              .select({ fireAt: firesTable.fireAt, status: firesTable.status })
              .from(firesTable)
              .where(eq(firesTable.campaignId, campaignId))
              .orderBy(firesTable.fireAt);
            const [automationRow] = yield* db
              .select({ nextFireAt: automationsTable.nextFireAt })
              .from(automationsTable)
              .where(eq(automationsTable.campaignId, campaignId));
            return yield* new RolledBack({
              result: { plan, fires, nextFireAt: automationRow?.nextFireAt },
            });
          })
        )
      ).pipe(
        Effect.catchTag("RolledBack", ({ result }) => Effect.succeed(result)),
        Effect.provide(Layer.mergeAll(database.layer, evaluationFacts))
      )
    );

  const insertFire = (
    campaignId: CampaignId,
    fireAt: Temporal.Instant,
    status: "entering" | "entered"
  ) =>
    pool.query(
      "insert into email_campaign_automation_schedule_fires (campaign_id, fire_at, version_id, status, chunks_total, created_at, settled_at) select campaign_id, $2, active_version_id, $3, 0, $2, $4 from email_campaign_automations where campaign_id = $1",
      [
        campaignId,
        fireAt.toString(),
        status,
        status === "entered" ? fireAt.toString() : null,
      ]
    );

  test("plans nothing for an automation that isn't active", async () => {
    const campaignId = await automation({ nextFireAt: hoursAgo(1) });
    await pool.query(
      "update email_campaigns set status = 'paused' where id = $1",
      [campaignId]
    );

    expect(await planWithEmptyPool(campaignId)).toEqual({
      plan: noFires,
      fires: [],
      nextFireAt: hoursAgo(1),
    });
  });

  test("plans nothing for an automation that isn't accepting", async () => {
    const campaignId = await automation({
      nextFireAt: hoursAgo(1),
      acceptingSince: null,
    });

    expect((await planWithEmptyPool(campaignId)).plan).toEqual(noFires);
  });

  test("waits while a fire is entering", async () => {
    const campaignId = await automation({ nextFireAt: hoursAgo(1) });
    await insertFire(campaignId, hoursAgo(2), "entering");

    expect(await planWithEmptyPool(campaignId)).toEqual({
      plan: noFires,
      fires: [{ fireAt: hoursAgo(2), status: "entering" }],
      nextFireAt: hoursAgo(1),
    });
  });

  test.each<[string, Temporal.Instant | null]>([
    ["no next fire", null],
    ["a next fire still to come", now.add({ hours: 1 })],
  ])("plans nothing with %s", async (_name, nextFireAt) => {
    const campaignId = await automation({ nextFireAt });

    expect(await planWithEmptyPool(campaignId)).toEqual({
      plan: noFires,
      fires: [],
      nextFireAt,
    });
  });

  test("enters a fire due now", async () => {
    const campaignId = await automation({ nextFireAt: now });

    expect(await planWithEmptyPool(campaignId)).toEqual({
      plan: { firesCreated: 1, firesEntered: 1, chunksPlanned: 0 },
      fires: [{ fireAt: now, status: "entered" }],
      nextFireAt: now.add({ hours: 1 }),
    });
  });

  test("plans nothing for a fire before the automation accepts", async () => {
    const campaignId = await automation({
      nextFireAt: hoursAgo(3),
      acceptingSince: hoursAgo(2),
    });

    expect(await planWithEmptyPool(campaignId)).toEqual({
      plan: noFires,
      fires: [],
      nextFireAt: hoursAgo(3),
    });
  });

  test("stops at a fire no version is in force for", async () => {
    const campaignId = await automation({
      nextFireAt: hoursAgo(3),
      activatedAt: hoursAgo(2),
      acceptingSince: hoursAgo(4),
    });

    expect(await planWithEmptyPool(campaignId)).toEqual({
      plan: noFires,
      fires: [],
      nextFireAt: hoursAgo(3),
    });
  });

  test("never enters a fire twice", async () => {
    const campaignId = await automation({ nextFireAt: hoursAgo(1) });
    await insertFire(campaignId, hoursAgo(1), "entered");

    expect(await planWithEmptyPool(campaignId)).toEqual({
      plan: noFires,
      fires: [{ fireAt: hoursAgo(1), status: "entered" }],
      nextFireAt: hoursAgo(1),
    });
  });

  test("enters at most 60 empty fires in one call, in order", async () => {
    const campaignId = await automation({ nextFireAt: hoursAgo(70) });

    const { plan, fires, nextFireAt } = await planWithEmptyPool(campaignId);

    expect(plan).toEqual({
      firesCreated: 60,
      firesEntered: 60,
      chunksPlanned: 0,
    });
    expect(fires).toEqual(
      Array.from({ length: 60 }, (_, index) => ({
        fireAt: hoursAgo(70 - index),
        status: "entered",
      }))
    );
    expect(nextFireAt).toEqual(hoursAgo(10));
  });
});
