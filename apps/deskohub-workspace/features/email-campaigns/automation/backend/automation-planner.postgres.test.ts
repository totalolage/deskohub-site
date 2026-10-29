import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  customerEvents,
  emailCampaignAutomationEngine,
  emailCampaignAutomationPreviews,
  emailCampaigns,
  emailCampaignAutomationWorkUnits as units,
} from "@/db/schema";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import {
  holdPostgresTransaction,
  waitForPostgresLockWaiter,
} from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  campaignContentFixture,
  deleteCampaigns,
} from "../../backend/email-campaigns.test-utils";
import type { CampaignId } from "../../campaign-identifiers";
import type { AutomationWorkUnitId } from "../automation-identifiers";
import {
  automationEngineTestLayer,
  seedAutomationUnit,
  testUnitHandler,
} from "./automation-engine.test-utils";
import { AutomationPlanner } from "./automation-planner.service";
import { AutomationSweepPlanning } from "./automation-sweep-planning.service";
import { planAutomationUnits } from "./automation-unit-planning";
import { makeAutomationUnitQueueFake } from "./automation-unit-queue.test-utils";

/**
 * The engine plans over whole tables, so the suite runs on a database of
 * its own.
 */
const database =
  await createWorkspacePostgresSuiteDatabase("automation_planner");
afterAll(() => database?.close());
const startedAt = Temporal.Instant.from("2026-10-19T10:00:00Z");

type EngineLayer = ReturnType<typeof automationEngineTestLayer>;

const plan = (layer: EngineLayer, at = startedAt) =>
  Effect.runPromise(
    TestClock.setTime(at.epochMilliseconds).pipe(
      Effect.andThen(
        Effect.flatMap(AutomationPlanner, (planner) => planner.plan)
      ),
      Effect.provide(layer),
      Effect.provide(TestClock.layer())
    )
  );

describe.skipIf(!database)("automation planner", () => {
  const postgres = database!;
  const campaignIds: Array<CampaignId> = [];
  const accountIds: Array<string> = [];

  const seed = (input: Parameters<typeof seedAutomationUnit>[1]) =>
    Effect.runPromise(seedAutomationUnit(postgres.db, input));

  const readUnits = (unitIds: ReadonlyArray<AutomationWorkUnitId>) =>
    Effect.runPromise(
      postgres.db
        .select()
        .from(units)
        .where(inArray(units.id, [...unitIds]))
    ).then((rows) => unitIds.map((id) => rows.find((row) => row.id === id)));

  /** Plans the same sweep page on every run, as overlapping planners would. */
  const repeatedSweepPage = Layer.effect(
    AutomationSweepPlanning,
    Effect.map(WorkspaceDatabase, ({ transaction }) => ({
      plan: (at) =>
        transaction(
          planAutomationUnits(
            [
              {
                kind: "sweep-page",
                key: "sweep-page:test:window:1",
                subject: { label: "window" },
                requestCost: 1,
              },
            ],
            at
          )
        ).pipe(
          Effect.map(({ planned, replanned }) => ({
            sweepPagesPlanned: planned,
            sweepPagesReplanned: replanned.length,
            eventsReconciled: 0,
          }))
        ),
    }))
  ).pipe(Layer.provide(postgres.layer));

  beforeEach(async () => {
    await postgres.pool.query(
      "delete from email_campaign_automation_work_units"
    );
  });

  afterAll(async () => {
    await postgres.pool.query(
      "delete from email_campaign_automation_work_units"
    );
    await postgres.pool.query(
      "delete from customer_events where customer_account_id = any($1)",
      [accountIds]
    );
    await postgres.pool.query(
      "delete from customer_accounts where id = any($1)",
      [accountIds]
    );
    await deleteCampaigns(postgres.pool, campaignIds);
  });

  test("overlapping runs plan and re-send each unit once", async () => {
    const queue = makeAutomationUnitQueueFake();
    const layer = automationEngineTestLayer({
      database: postgres,
      queue,
      handlers: [testUnitHandler("intake"), testUnitHandler("sweep-page")],
      sweepPlanning: repeatedSweepPage,
    });
    const expiredClaim = await seed({
      kind: "intake",
      status: "claimed",
      claimId: "crashed",
      claimExpiresAt: startedAt.subtract({ seconds: 1 }),
    });
    const lostMessage = await seed({
      kind: "intake",
      status: "enqueued",
      enqueuedAt: startedAt.subtract({ minutes: 11 }),
    });

    const rowLocks = await holdPostgresTransaction(
      postgres.pool,
      "select id from email_campaign_automation_work_units where id = any($1) for update",
      [[expiredClaim.id, lostMessage.id]]
    );
    const runs = Promise.all([plan(layer), plan(layer)]);
    await waitForPostgresLockWaiter(postgres.pool, {
      // The second planner queues behind the first on the row's tuple lock,
      // so only the first lists the holder among its blockers.
      condition: `$1 = any(pg_blocking_pids(pid)) and (
        select count(distinct waiter.pid) from pg_locks waiter
        where not waiter.granted
      ) >= 2`,
      values: [rowLocks.pid],
      description: "both planners waiting on the reaped units",
    });
    await rowLocks.commit();
    const summaries = await runs;

    expect(
      summaries.reduce((sum, summary) => sum + summary.sweepPagesPlanned, 0)
    ).toBe(1);
    expect(
      summaries.reduce(
        (sum, summary) => sum + summary.reaped.requeued + summary.reaped.resent,
        0
      )
    ).toBe(2);
    const [claimRow, lostRow] = await readUnits([
      expiredClaim.id,
      lostMessage.id,
    ]);
    expect(claimRow).toMatchObject({
      status: "enqueued",
      enqueueGeneration: 1,
    });
    expect(lostRow).toMatchObject({ status: "enqueued", enqueueGeneration: 1 });

    const sweepPages = await Effect.runPromise(
      postgres.db.select().from(units).where(eq(units.kind, "sweep-page"))
    );
    expect(sweepPages).toHaveLength(1);
    expect(sweepPages[0]?.status).toBe("enqueued");
    expect(
      queue
        .published()
        .map((message) => message.idempotencyKey)
        .toSorted()
    ).toEqual(
      [
        `email-automation-unit:${expiredClaim.id}:1`,
        `email-automation-unit:${lostMessage.id}:1`,
        `email-automation-unit:${sweepPages[0]?.id}:0`,
      ].toSorted()
    );
  });

  test("the reaper requeues an expired claim and re-sends a lost message", async () => {
    const queue = makeAutomationUnitQueueFake();
    const layer = automationEngineTestLayer({
      database: postgres,
      queue,
      handlers: [testUnitHandler("intake")],
    });
    const expiredClaim = await seed({
      kind: "intake",
      status: "claimed",
      claimId: "crashed",
      claimExpiresAt: startedAt.subtract({ seconds: 1 }),
    });
    const liveClaim = await seed({
      kind: "intake",
      status: "claimed",
      claimId: "running",
      claimExpiresAt: startedAt.add({ minutes: 1 }),
    });
    const lostMessage = await seed({
      kind: "intake",
      status: "enqueued",
      enqueuedAt: startedAt.subtract({ minutes: 11 }),
    });
    const recentMessage = await seed({
      kind: "intake",
      status: "enqueued",
      enqueuedAt: startedAt.subtract({ minutes: 9 }),
    });
    const markedMessage = await seed({
      kind: "intake",
      status: "enqueued",
      enqueuedAt: startedAt.subtract({ minutes: 1 }),
      cancelRequestedAt: startedAt.subtract({ seconds: 5 }),
    });

    const summary = await plan(layer);

    expect(summary.reaped).toEqual({ requeued: 1, resent: 1, dropped: 1 });
    const [claimRow, liveRow, lostRow, recentRow, markedRow] = await readUnits([
      expiredClaim.id,
      liveClaim.id,
      lostMessage.id,
      recentMessage.id,
      markedMessage.id,
    ]);
    expect(claimRow).toMatchObject({
      status: "enqueued",
      claimId: null,
      claimExpiresAt: null,
      enqueueGeneration: 1,
      lastErrorCode: "claim-expired",
    });
    expect(claimRow?.enqueuedAt?.equals(startedAt)).toBe(true);
    expect(liveRow).toMatchObject({ status: "claimed", claimId: "running" });
    expect(lostRow).toMatchObject({ status: "enqueued", enqueueGeneration: 1 });
    expect(recentRow).toMatchObject({
      status: "enqueued",
      enqueueGeneration: 0,
    });
    expect(markedRow?.status).toBe("dropped");
    expect(markedRow?.settledAt?.equals(startedAt)).toBe(true);
    expect(queue.published().map((message) => message.idempotencyKey)).toEqual([
      `email-automation-unit:${expiredClaim.id}:1`,
      `email-automation-unit:${lostMessage.id}:1`,
    ]);
  });

  test("housekeeping deletes a bounded batch past each retention", async () => {
    const queue = makeAutomationUnitQueueFake();
    const layer = automationEngineTestLayer({
      database: postgres,
      queue,
      handlers: [testUnitHandler("intake")],
    });
    const [campaign] = await Effect.runPromise(
      postgres.db
        .insert(emailCampaigns)
        .values({
          title: "Automation previews",
          purpose: "marketing",
          templateKey: "workspace",
          content: campaignContentFixture(),
          status: "draft",
        })
        .returning({ id: emailCampaigns.id })
    );
    campaignIds.push(campaign!.id);

    await postgres.pool.query(
      `insert into email_campaign_automation_work_units
         (kind, priority, key, subject, request_cost, status, settled_at)
       select 'intake', 2, 'old:' || n, '{}'::jsonb, 1, 'done', $1::timestamptz
       from generate_series(1, 1001) as n`,
      [startedAt.subtract({ hours: 8 * 24 }).toString()]
    );
    const recentSettled = await seed({
      kind: "intake",
      status: "done",
      settledAt: startedAt.subtract({ hours: 6 * 24 }),
    });

    const previews = await Effect.runPromise(
      postgres.db
        .insert(emailCampaignAutomationPreviews)
        .values(
          [25, 23].map((hours) => ({
            campaignId: campaign!.id,
            draftHash: `draft-${hours}`,
            kind: "replay" as const,
            status: "completed" as const,
            asOf: startedAt,
            unitsTotal: 0,
            createdAt: startedAt.subtract({ hours }),
          }))
        )
        .returning({ id: emailCampaignAutomationPreviews.id })
    );

    const accounts = await Effect.runPromise(
      Effect.all([
        workspaceFixtures(postgres.db).customerAccount(),
        workspaceFixtures(postgres.db).customerAccount(),
      ])
    );
    accountIds.push(...accounts);
    const events = await Effect.runPromise(
      postgres.db
        .insert(customerEvents)
        .values(
          [91, 89].map((days, index) => ({
            kind: "account-created" as const,
            occurredAt: startedAt.subtract({ hours: days * 24 }),
            dotyposCustomerId: dotyposCustomerIdSchema.make(
              `housekeeping-${index}`
            ),
            customerAccountId: accounts[index]!,
          }))
        )
        .returning({ id: customerEvents.id })
    );

    const first = await plan(layer);
    expect(first.pruned.units).toBe(1000);
    expect(first.pruned.previews).toBe(1);
    expect(first.pruned.events).toBe(1);

    const second = await plan(layer);
    expect(second.pruned.units).toBe(1);

    const remainingUnits = await Effect.runPromise(
      postgres.db.select({ id: units.id }).from(units)
    );
    expect(remainingUnits).toEqual([{ id: recentSettled.id }]);
    const remainingPreviews = await Effect.runPromise(
      postgres.db
        .select({ id: emailCampaignAutomationPreviews.id })
        .from(emailCampaignAutomationPreviews)
        .where(
          inArray(
            emailCampaignAutomationPreviews.id,
            previews.map((preview) => preview.id)
          )
        )
    );
    expect(remainingPreviews).toEqual([{ id: previews[1]!.id }]);
    const remainingEvents = await Effect.runPromise(
      postgres.db
        .select({ id: customerEvents.id })
        .from(customerEvents)
        .where(
          inArray(
            customerEvents.id,
            events.map((event) => event.id)
          )
        )
    );
    expect(remainingEvents).toEqual([{ id: events[1]!.id }]);
  });

  test("tops up to K and records the plan summary", async () => {
    const queue = makeAutomationUnitQueueFake();
    const layer = automationEngineTestLayer({
      database: postgres,
      queue,
      handlers: [testUnitHandler("intake")],
    });
    await Promise.all(
      Array.from({ length: 6 }, () =>
        seed({ kind: "intake", status: "planned" })
      )
    );

    const summary = await plan(layer);

    expect(summary.promoted).toBe(4);
    expect(summary.inFlightByKind).toEqual({ intake: 4 });
    expect(queue.published()).toHaveLength(4);
    expect(
      queue
        .published()
        .every((message) => message.idempotencyKey.endsWith(":0"))
    ).toBe(true);

    const [engine] = await Effect.runPromise(
      postgres.db
        .select()
        .from(emailCampaignAutomationEngine)
        .where(eq(emailCampaignAutomationEngine.id, 1))
    );
    expect(engine?.lastPlannedAt?.equals(startedAt)).toBe(true);
    expect(engine?.lastPlanSummary).toEqual(summary);

    expect((await plan(layer)).promoted).toBe(0);
  });
});
