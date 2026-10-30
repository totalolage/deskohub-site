import "@/shared/testing/workspace-test-env";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { AutomationFlow } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import {
  holdPostgresTransaction,
  waitForPostgresLockWaiter,
} from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { AudienceFilter } from "../../audience-filter";
import {
  deleteAutomatedCampaigns,
  seedAutomatedCampaign,
  seedAutomation,
  seedAutomationVersion,
} from "../../backend/email-campaigns.test-utils";
import type { CampaignPurpose } from "../../body/campaign-content";
import type { CampaignId } from "../../campaign-identifiers";
import type { AutomationStepId } from "../automation-identifiers";
import {
  entryEngineLayer,
  makeEngineDotypos,
  makeEngineFixtures,
  planAndProcess,
  runEngineAt,
} from "./automation-engine-scenario.test-utils";
import { AutomationPlanner } from "./automation-planner.service";
import {
  drainAutomationUnitQueue,
  makeAutomationUnitQueueFake,
} from "./automation-unit-queue.test-utils";

/**
 * The engine plans over whole tables, so the suite runs on a database of
 * its own.
 */
const database =
  await createWorkspacePostgresSuiteDatabase("automation_intake");
afterAll(() => database?.close());
const now = Temporal.Instant.from("2026-10-19T10:00:00Z");
const prefix = `intake-${crypto.randomUUID()}`;

const finishedFlow: AutomationFlow = {
  trigger: { _tag: "ReservationFinished" },
  steps: [{ _tag: "Send", id: "send" as AutomationStepId }],
};
const triggeredBy = (trigger: AutomationFlow["trigger"]): AutomationFlow => ({
  ...finishedFlow,
  trigger,
});

describe.skipIf(!database)("intake units on Postgres", () => {
  if (!database) return;
  const { db, pool } = database;
  const dotypos = makeEngineDotypos();
  const fixtures = makeEngineFixtures(database, dotypos, prefix);
  const campaignIds: CampaignId[] = [];

  afterEach(async () => {
    await deleteAutomatedCampaigns(db, campaignIds.splice(0));
  });
  afterAll(() => fixtures.cleanup());

  const automation = async (
    input: {
      readonly purpose?: CampaignPurpose;
      readonly audienceFilter?: AudienceFilter;
      readonly flow?: AutomationFlow;
    } = {}
  ) => {
    const purpose = input.purpose ?? "operational";
    const campaignId = await seedAutomatedCampaign(db, { purpose });
    campaignIds.push(campaignId);
    const versionId = await seedAutomationVersion(db, {
      campaignId,
      purpose,
      flow: input.flow ?? finishedFlow,
      ...(input.audienceFilter && { audienceFilter: input.audienceFilter }),
      activatedAt: now.subtract({ hours: 72 }),
    });
    await seedAutomation(db, {
      campaignId,
      activeVersionId: versionId,
      acceptingSince: now.subtract({ hours: 72 }),
    });
    return campaignId;
  };

  const engine = async () => {
    const queue = makeAutomationUnitQueueFake();
    const layer = await entryEngineLayer({ database, dotypos, queue });
    return {
      queue,
      layer,
      process: (at = now) => runEngineAt(planAndProcess(queue), layer, at),
    };
  };

  const receipts = async (campaignId: CampaignId) =>
    (
      await pool.query(
        "select dedup_key, disposition, run_id from email_campaign_automation_trigger_receipts where campaign_id = $1 order by dedup_key",
        [campaignId]
      )
    ).rows.map((row) => ({
      key: row.dedup_key as string,
      disposition: row.disposition as string,
      run: row.run_id !== null,
    }));

  const runsOf = async (campaignId: CampaignId) =>
    (
      await pool.query(
        "select id, dotypos_customer_id, trigger_kind, (extract(epoch from trigger_at) * 1000)::bigint::text as trigger_ms, trigger_reservation_id, status, step_id, phase, (extract(epoch from due_at) * 1000)::bigint::text as due_ms from email_campaign_automation_runs where campaign_id = $1 order by trigger_at",
        [campaignId]
      )
    ).rows;

  const processed = async (eventIds: readonly string[]) =>
    (
      await pool.query(
        "select automation_processed_at is not null and automation_unit_id is null as processed from customer_events where id = any($1)",
        [eventIds]
      )
    ).rows.every(({ processed }) => processed);

  /** A visit that finished `hoursAgo` hours before now, and its event. */
  const finishedVisit = async (input: {
    readonly label: string;
    readonly customer: Parameters<typeof fixtures.book>[0]["customer"];
    readonly hoursAgo: number;
  }) => {
    const endsAt = now.subtract({ hours: input.hoursAgo });
    const reservationId = await fixtures.book({
      label: input.label,
      customer: input.customer,
      startsAt: endsAt.subtract({ hours: 2 }),
      endsAt,
    });
    const eventId = await fixtures.recordEvent({
      kind: "reservation-finished",
      customer: input.customer,
      reservationId,
      occurredAt: endsAt,
    });
    return { reservationId, eventId, endsAt };
  };

  test("starts one run per reservation at the first step, with one receipt across repeated events (D31.7)", async () => {
    const campaignId = await automation();
    const customer = await fixtures.addCustomer("story");
    const first = await finishedVisit({
      label: "story",
      customer,
      hoursAgo: 2,
    });
    // The sweep saw the visit end again, a minute later.
    const repeat = await fixtures.recordEvent({
      kind: "reservation-finished",
      customer,
      reservationId: first.reservationId,
      occurredAt: first.endsAt.add({ minutes: 1 }),
    });
    const { process } = await engine();

    await process();

    expect(await receipts(campaignId)).toEqual([
      {
        key: `reservation-finished:${first.reservationId}`,
        disposition: "started",
        run: true,
      },
    ]);
    const [run, ...others] = await runsOf(campaignId);
    expect(others).toEqual([]);
    expect(run).toMatchObject({
      dotypos_customer_id: customer,
      trigger_kind: "reservation-finished",
      trigger_reservation_id: first.reservationId,
      status: "active",
      step_id: "send",
      phase: "ready",
    });
    expect(run.trigger_ms).toBe(String(first.endsAt.epochMilliseconds));
    expect(run.due_ms).toBe(String(now.epochMilliseconds));
    const { rows: entries } = await pool.query(
      "select kind, step_id from email_campaign_automation_run_events where run_id = $1",
      [run.id]
    );
    expect(entries).toEqual([{ kind: "started", step_id: "send" }]);
    expect(await processed([first.eventId, repeat])).toBe(true);

    // A later repeat finds the key taken and is processed without a receipt.
    const late = await fixtures.recordEvent({
      kind: "reservation-finished",
      customer,
      reservationId: first.reservationId,
      occurredAt: first.endsAt.add({ minutes: 2 }),
    });
    await process(now.add({ minutes: 1 }));
    expect(await processed([late])).toBe(true);
    expect(await receipts(campaignId)).toHaveLength(1);
    expect(await runsOf(campaignId)).toHaveLength(1);
  });

  test("records already-active for a customer whose run is still open (D4)", async () => {
    const campaignId = await automation();
    const customer = await fixtures.addCustomer("active");
    const earlier = await finishedVisit({
      label: "active-1",
      customer,
      hoursAgo: 3,
    });
    const later = await finishedVisit({
      label: "active-2",
      customer,
      hoursAgo: 1,
    });
    const { process } = await engine();

    await process();

    expect(await receipts(campaignId)).toEqual(
      [
        {
          key: `reservation-finished:${earlier.reservationId}`,
          disposition: "started",
          run: true,
        },
        {
          key: `reservation-finished:${later.reservationId}`,
          disposition: "already-active",
          run: false,
        },
      ].toSorted((left, right) => left.key.localeCompare(right.key))
    );
    const runs = await runsOf(campaignId);
    expect(runs).toHaveLength(1);
    expect(runs[0].trigger_reservation_id).toBe(earlier.reservationId);
  });

  test("supersedes a finished visit Dotypos extended, then enters once at the new end", async () => {
    const campaignId = await automation();
    const customer = await fixtures.addCustomer("extended");
    const visit = await finishedVisit({
      label: "extended",
      customer,
      hoursAgo: 1,
    });
    const newEnd = now.add({ hours: 2 });
    fixtures.moveVisit(visit.reservationId, {
      startsAt: visit.endsAt.subtract({ hours: 2 }),
      endsAt: newEnd,
    });
    const { process } = await engine();

    await process();

    expect(await processed([visit.eventId])).toBe(true);
    expect(await receipts(campaignId)).toEqual([]);
    expect(await runsOf(campaignId)).toEqual([]);

    const atNewEnd = await fixtures.recordEvent({
      kind: "reservation-finished",
      customer,
      reservationId: visit.reservationId,
      occurredAt: newEnd,
    });
    await process(newEnd.add({ minutes: 5 }));

    expect(await processed([atNewEnd])).toBe(true);
    expect(await receipts(campaignId)).toEqual([
      {
        key: `reservation-finished:${visit.reservationId}`,
        disposition: "started",
        run: true,
      },
    ]);
    const runs = await runsOf(campaignId);
    expect(runs).toHaveLength(1);
    expect(runs[0].trigger_ms).toBe(String(newEnd.epochMilliseconds));
  });

  test("enters a finished event whose visit Dotypos extended to an end already past, at its first end (D35)", async () => {
    const campaignId = await automation();
    const customer = await fixtures.addCustomer("extended-past");
    const visit = await finishedVisit({
      label: "extended-past",
      customer,
      hoursAgo: 3,
    });
    // Later than the event but before now: intake re-checks as of now.
    fixtures.moveVisit(visit.reservationId, {
      startsAt: visit.endsAt.subtract({ hours: 2 }),
      endsAt: now.subtract({ hours: 1 }),
    });
    const { process } = await engine();

    await process();

    expect(await receipts(campaignId)).toEqual([
      {
        key: `reservation-finished:${visit.reservationId}`,
        disposition: "started",
        run: true,
      },
    ]);
    const [run] = await runsOf(campaignId);
    expect(run.trigger_ms).toBe(String(visit.endsAt.epochMilliseconds));
  });

  test("enters a booked event whose visit Dotypos moved later, and supersedes a started one (D35)", async () => {
    const bookedCampaign = await automation({
      flow: triggeredBy({ _tag: "ReservationBooked" }),
    });
    const startedCampaign = await automation({
      flow: triggeredBy({ _tag: "ReservationStarted" }),
    });
    const customer = await fixtures.addCustomer("moved-later");
    const startsAt = now.subtract({ hours: 1 });
    const reservationId = await fixtures.book({
      label: "moved-later",
      customer,
      startsAt,
      endsAt: startsAt.add({ hours: 2 }),
    });
    const booked = await fixtures.recordEvent({
      kind: "reservation-booked",
      customer,
      reservationId,
      occurredAt: startsAt.subtract({ hours: 2 }),
    });
    const started = await fixtures.recordEvent({
      kind: "reservation-started",
      customer,
      reservationId,
      occurredAt: startsAt,
    });
    const movedStart = now.add({ hours: 3 });
    fixtures.moveVisit(reservationId, {
      startsAt: movedStart,
      endsAt: movedStart.add({ hours: 2 }),
    });
    const { process } = await engine();

    await process();

    expect(await processed([booked, started])).toBe(true);
    expect(await receipts(bookedCampaign)).toEqual([
      {
        key: `reservation-booked:${reservationId}`,
        disposition: "started",
        run: true,
      },
    ]);
    expect(await receipts(startedCampaign)).toEqual([]);
    expect(await runsOf(startedCampaign)).toEqual([]);
  });

  test("enters a cancellation event, which its own Workspace cancellation never withdraws (D28)", async () => {
    const campaignId = await automation({
      flow: triggeredBy({ _tag: "ReservationCancelled" }),
    });
    const customer = await fixtures.addCustomer("cancellation");
    const startsAt = now.add({ hours: 24 });
    const reservationId = await fixtures.book({
      label: "cancellation",
      customer,
      startsAt,
      endsAt: startsAt.add({ hours: 2 }),
    });
    const cancelledAt = now.subtract({ minutes: 30 });
    await fixtures.cancelInWorkspace(reservationId, cancelledAt);
    fixtures.cancelVisit(reservationId);
    const event = await fixtures.recordEvent({
      kind: "reservation-cancelled",
      customer,
      reservationId,
      occurredAt: cancelledAt,
    });
    const { process } = await engine();

    await process();

    expect(await processed([event])).toBe(true);
    expect(await receipts(campaignId)).toEqual([
      {
        key: `reservation-cancelled:${reservationId}`,
        disposition: "started",
        run: true,
      },
    ]);
  });

  test("withdraws an event whose visit Dotypos cancelled or no longer returns (D28)", async () => {
    const campaignId = await automation();
    const cancelled = await finishedVisit({
      label: "withdrawn-cancelled",
      customer: await fixtures.addCustomer("withdrawn-cancelled"),
      hoursAgo: 1,
    });
    fixtures.moveVisit(cancelled.reservationId, {
      startsAt: cancelled.endsAt.subtract({ hours: 2 }),
      endsAt: cancelled.endsAt,
      status: "CANCELLED",
    });
    const deleted = await finishedVisit({
      label: "withdrawn-deleted",
      customer: await fixtures.addCustomer("withdrawn-deleted"),
      hoursAgo: 1,
    });
    fixtures.deleteVisit(deleted.reservationId);
    const { process } = await engine();

    await process();

    expect(await receipts(campaignId)).toEqual(
      [cancelled, deleted]
        .map(({ reservationId }) => ({
          key: `reservation-finished:${reservationId}`,
          disposition: "withdrawn",
          run: false,
        }))
        .toSorted((left, right) => left.key.localeCompare(right.key))
    );
    expect(await runsOf(campaignId)).toEqual([]);
  });

  test("withdraws an event whose reservation Workspace cancelled after the fetch, once its cancellation was processed (D28)", async () => {
    const campaignId = await automation();
    const customer = await fixtures.addCustomer("workspace-cancelled");
    const visit = await finishedVisit({
      label: "workspace-cancelled",
      customer,
      hoursAgo: 1,
    });
    const { queue, layer } = await engine();
    const plan = () =>
      runEngineAt(
        Effect.flatMap(AutomationPlanner, (planner) => planner.plan),
        layer,
        now
      );
    await plan();
    // Holding the lifecycle lock stops the unit at its commit, after the
    // fetch saw the visit active in Dotypos.
    const lifecycle = await holdPostgresTransaction(
      pool,
      "select 1 from email_campaign_automations where campaign_id = $1 for update",
      [campaignId]
    );
    const unit = runEngineAt(drainAutomationUnitQueue(queue), layer, now);
    try {
      await waitForPostgresLockWaiter(pool, {
        condition: "$1::int = any(pg_blocking_pids(pid))",
        values: [lifecycle.pid],
        description: "the intake commit waiting for the lifecycle lock",
      });
      await fixtures.cancelInWorkspace(visit.reservationId, now);
      const cancellation = await fixtures.recordEvent({
        kind: "reservation-cancelled",
        customer,
        reservationId: visit.reservationId,
        occurredAt: now,
      });
      await plan();
      expect(await processed([cancellation])).toBe(true);
    } finally {
      await lifecycle.commit();
    }
    await unit;

    expect(await processed([visit.eventId])).toBe(true);
    expect(await receipts(campaignId)).toEqual([
      {
        key: `reservation-finished:${visit.reservationId}`,
        disposition: "withdrawn",
        run: false,
      },
    ]);
    expect(await runsOf(campaignId)).toEqual([]);
  });

  test("records not-in-audience for a customer outside the marketing consent pool", async () => {
    const campaignId = await automation({ purpose: "marketing" });
    const consenting = await finishedVisit({
      label: "audience-in",
      customer: await fixtures.addCustomer("audience-in"),
      hoursAgo: 1,
    });
    const withoutConsent = await finishedVisit({
      label: "audience-out",
      customer: await fixtures.addCustomer("audience-out", { consent: false }),
      hoursAgo: 1,
    });
    const { process } = await engine();

    await process();

    expect(await receipts(campaignId)).toEqual(
      [
        {
          key: `reservation-finished:${consenting.reservationId}`,
          disposition: "started",
          run: true,
        },
        {
          key: `reservation-finished:${withoutConsent.reservationId}`,
          disposition: "not-in-audience",
          run: false,
        },
      ].toSorted((left, right) => left.key.localeCompare(right.key))
    );
  });

  test("processes events without a receipt when the automation paused after planning", async () => {
    const campaignId = await automation();
    const visit = await finishedVisit({
      label: "paused",
      customer: await fixtures.addCustomer("paused"),
      hoursAgo: 1,
    });
    const { queue, layer } = await engine();
    await runEngineAt(
      Effect.flatMap(AutomationPlanner, (planner) => planner.plan),
      layer,
      now
    );
    await pool.query(
      "update email_campaigns set status = 'paused' where id = $1",
      [campaignId]
    );
    await pool.query(
      "update email_campaign_automations set accepting_since = null, paused_at = $2 where campaign_id = $1",
      [campaignId, now.toString()]
    );

    await runEngineAt(drainAutomationUnitQueue(queue), layer, now);

    expect(await processed([visit.eventId])).toBe(true);
    expect(await receipts(campaignId)).toEqual([]);
    expect(await runsOf(campaignId)).toEqual([]);
  });

  test("fails events recorded more than 24 hours ago, and a solo unit at the deadline-miss limit", async () => {
    const campaignId = await automation();
    const stale = await finishedVisit({
      label: "expired-stale",
      customer: await fixtures.addCustomer("expired-stale"),
      hoursAgo: 1,
    });
    await pool.query(
      "update customer_events set recorded_at = $2 where id = $1",
      [stale.eventId, now.subtract({ hours: 25 }).toString()]
    );
    const { queue, layer } = await engine();
    await runEngineAt(
      Effect.flatMap(AutomationPlanner, (planner) => planner.plan),
      layer,
      now
    );
    const missing = await finishedVisit({
      label: "expired-solo",
      customer: await fixtures.addCustomer("expired-solo"),
      hoursAgo: 1,
    });
    await runEngineAt(drainAutomationUnitQueue(queue), layer, now);
    await runEngineAt(
      Effect.flatMap(AutomationPlanner, (planner) => planner.plan),
      layer,
      now.add({ minutes: 1 })
    );
    await pool.query(
      "update email_campaign_automation_work_units set deadline_misses = 3 where id = (select automation_unit_id from customer_events where id = $1)",
      [missing.eventId]
    );
    await runEngineAt(
      drainAutomationUnitQueue(queue),
      layer,
      now.add({ minutes: 1 })
    );

    expect(await processed([stale.eventId, missing.eventId])).toBe(true);
    expect(await receipts(campaignId)).toEqual(
      [stale, missing]
        .map(({ reservationId }) => ({
          key: `reservation-finished:${reservationId}`,
          disposition: "failed",
          run: false,
        }))
        .toSorted((left, right) => left.key.localeCompare(right.key))
    );
    expect(await runsOf(campaignId)).toEqual([]);
  });

  test("proceeds when the customer's bookings grew between planning and fetch", async () => {
    const campaignId = await automation({
      audienceFilter: {
        _tag: "Group",
        operator: "and",
        filters: [
          {
            attribute: "reservationCount",
            _tag: "Condition",
            params: { dateBasis: "visit", period: { _tag: "Past" } },
            operator: "gte",
            value: 1,
          },
        ],
      } as AudienceFilter,
    });
    const customer = await fixtures.addCustomer("grown");
    const visit = await finishedVisit({
      label: "grown",
      customer,
      hoursAgo: 1,
    });
    const { queue, layer } = await engine();
    await runEngineAt(
      Effect.flatMap(AutomationPlanner, (planner) => planner.plan),
      layer,
      now
    );
    const {
      rows: [unit],
    } = await pool.query(
      "select request_cost from email_campaign_automation_work_units where id = (select automation_unit_id from customer_events where id = $1)",
      [visit.eventId]
    );
    // The gate reads the visits, which cover the triggering one.
    expect(unit.request_cost).toBe(1);
    for (let index = 0; index < 120; index++) {
      await fixtures.book({
        label: `grown-${index}`,
        customer,
        startsAt: now.add({ hours: 24 * (index + 1) }),
        endsAt: now.add({ hours: 24 * (index + 1) + 2 }),
      });
    }
    dotypos.resetCalls();

    await runEngineAt(drainAutomationUnitQueue(queue), layer, now);

    // Planning saw one visit; the 121 now require two transport batches.
    expect(dotypos.calls.getReservationsByIds).toBe(2);
    expect(await receipts(campaignId)).toEqual([
      {
        key: `reservation-finished:${visit.reservationId}`,
        disposition: "started",
        run: true,
      },
    ]);
  });
});
