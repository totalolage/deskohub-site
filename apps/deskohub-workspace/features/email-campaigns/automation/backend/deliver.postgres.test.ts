import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { resendSimulatorAddress, testEmailAddress } from "@deskohub/test-email";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { deleteAutomatedCampaigns } from "../../backend/email-campaigns.test-utils";
import type { CampaignId } from "../../campaign-identifiers";
import type { AutomationWorkUnitId } from "../automation-identifiers";
import type { ResendFakeResponse } from "./automation-engine-scenario.test-utils";
import {
  deliverProfile,
  makeDeliverEngine,
  type SeedSendReadyRun,
  type SeedVisit,
  seedDeliverAutomation,
  seedDeliverReservations,
  seedSendReadyRuns,
  sendOnlyFlow,
} from "./deliver.test-utils";

/**
 * The engine plans over whole tables, so the suite runs on a database of
 * its own.
 */
const database =
  await createWorkspacePostgresSuiteDatabase("automation_deliver");
afterAll(() => database?.close());

/** Monday 19 October 2026, 12:00 in Prague. */
const startedAt = Temporal.Instant.from("2026-10-19T10:00:00Z");
const runKey = crypto.randomUUID().slice(0, 8);
const customerId = (name: string) =>
  DotyposCustomerIdSchema.make(`deliver-${runKey}-${name}`);

describe.skipIf(!database)("deliver units on disposable Postgres", () => {
  if (!database) return;
  const { db, pool } = database;
  const campaignIds: CampaignId[] = [];
  const reservationPrefixes: string[] = [];

  // A test that failed midway can't hold the deliver slot for the next.
  beforeEach(() =>
    pool.query(
      `update email_campaign_automation_work_units
          set status = 'dropped', claim_id = null, claim_expires_at = null, settled_at = now()
        where campaign_id = any($1) and status in ('planned', 'enqueued', 'claimed')`,
      [campaignIds]
    )
  );

  afterAll(async () => {
    await deleteAutomatedCampaigns(db, campaignIds);
    await pool.query(
      "delete from workspace_reservations where id like any($1)",
      [reservationPrefixes.map((prefix) => `${prefix}-%`)]
    );
  });

  const setUp = (
    input: Omit<Parameters<typeof makeDeliverEngine>[0], "database">
  ) => makeDeliverEngine({ database, ...input });

  const seedAutomation = async (
    input: Omit<Parameters<typeof seedDeliverAutomation>[1], "activatedAt">
  ) => {
    const seeded = await seedDeliverAutomation(db, {
      ...input,
      activatedAt: startedAt.subtract({ hours: 48 }),
    });
    campaignIds.push(seeded.campaignId);
    return seeded;
  };

  const seedVisits = (label: string, visits: readonly SeedVisit[]) => {
    const prefix = `deliver-${runKey}-${label}`;
    reservationPrefixes.push(prefix);
    return seedDeliverReservations(db, prefix, visits);
  };

  const seedRuns = (
    seeded: Awaited<ReturnType<typeof seedAutomation>>,
    runs: readonly SeedSendReadyRun[]
  ) => seedSendReadyRuns(db, { ...seeded, runs, at: startedAt });

  const runsOf = async (campaignId: CampaignId) => {
    const { rows } = await pool.query<{
      dotypos_customer_id: string;
      status: string;
      phase: string | null;
      outcome: string | null;
      outcome_reason: string | null;
      due_at: Date | null;
      work_unit_id: string | null;
      send_id: string | null;
      events: string[];
    }>(
      `select r.dotypos_customer_id, r.status, r.phase, r.outcome, r.outcome_reason, r.due_at, r.work_unit_id, r.send_id,
              coalesce(array_agg(e.kind order by e.sequence) filter (where e.kind is not null), '{}') as events
         from email_campaign_automation_runs r
         left join email_campaign_automation_run_events e on e.run_id = r.id
        where r.campaign_id = $1
        group by r.id
        order by r.dotypos_customer_id`,
      [campaignId]
    );
    return new Map(rows.map((row) => [row.dotypos_customer_id, row]));
  };

  const unitsOf = async (campaignId: CampaignId) => {
    const { rows } = await pool.query<{
      id: AutomationWorkUnitId;
      status: string;
      send_id: string | null;
      cancel_requested_at: Date | null;
      last_error_code: string | null;
    }>(
      "select id, status, send_id, cancel_requested_at, last_error_code from email_campaign_automation_work_units where campaign_id = $1 order by created_at, id",
      [campaignId]
    );
    return rows;
  };

  const outcomesOf = (runs: Awaited<ReturnType<typeof runsOf>>) =>
    Object.fromEntries(
      [...runs].map(([customer, run]) => [
        customer,
        [run.status, run.outcome, run.outcome_reason],
      ])
    );

  test("verifies, persists, submits and settles one batch in one invocation", async () => {
    const booked = customerId("verify-booked");
    const extended = customerId("verify-extended");
    const dotyposCancelled = customerId("verify-dotypos-cancelled");
    const workspaceCancelled = customerId("verify-workspace-cancelled");
    const account = customerId("verify-account");
    const outside = customerId("verify-outside");
    const visits = await seedVisits("verify", [
      {
        label: "booked",
        customer: booked,
        startsAt: startedAt.add({ hours: 24 }),
        endsAt: startedAt.add({ hours: 26 }),
      },
      {
        // Finished at the trigger, then extended past now in Dotypos.
        label: "extended",
        customer: extended,
        startsAt: startedAt.subtract({ hours: 2 }),
        endsAt: startedAt.add({ hours: 1 }),
      },
      {
        label: "dotypos-cancelled",
        customer: dotyposCancelled,
        startsAt: startedAt.add({ hours: 24 }),
        endsAt: startedAt.add({ hours: 26 }),
        dotyposStatus: "CANCELLED",
      },
      {
        label: "workspace-cancelled",
        customer: workspaceCancelled,
        startsAt: startedAt.add({ hours: 24 }),
        endsAt: startedAt.add({ hours: 26 }),
        cancelledAt: startedAt.subtract({ minutes: 5 }),
      },
    ]);
    const engine = await setUp({
      customers: [
        booked,
        extended,
        dotyposCancelled,
        workspaceCancelled,
        account,
      ]
        .map((id) => deliverProfile(id))
        .concat(
          deliverProfile(outside, {
            email: resendSimulatorAddress("delivered"),
          })
        ),
    });
    engine.dotypos.setReservations(visits.dotypos);
    const seeded = await seedAutomation({ text: "Verze doručení" });
    await seedRuns(seeded, [
      {
        customer: booked,
        triggerKind: "reservation-booked",
        reservationId: visits.ids.get("booked"),
      },
      {
        customer: extended,
        triggerKind: "reservation-finished",
        reservationId: visits.ids.get("extended"),
      },
      {
        customer: dotyposCancelled,
        triggerKind: "reservation-booked",
        reservationId: visits.ids.get("dotypos-cancelled"),
      },
      {
        customer: workspaceCancelled,
        triggerKind: "reservation-booked",
        reservationId: visits.ids.get("workspace-cancelled"),
      },
      { customer: account },
      { customer: outside },
    ]);

    await engine.tick(startedAt);

    const runs = await runsOf(seeded.campaignId);
    expect(outcomesOf(runs)).toEqual({
      [booked]: ["ended", "sent", null],
      [extended]: ["active", null, null],
      [dotyposCancelled]: ["ended", "withdrawn", null],
      [workspaceCancelled]: ["ended", "withdrawn", null],
      [account]: ["ended", "sent", null],
      [outside]: ["ended", "skipped", "outside-test-domain"],
    });
    expect(runs.get(booked)!.events).toEqual(["send-queued", "sent"]);
    expect(runs.get(outside)!.events).toEqual(["send-queued", "skipped"]);
    expect(runs.get(dotyposCancelled)!.events).toEqual(["withdrawn"]);
    const deferred = runs.get(extended)!;
    expect(deferred).toMatchObject({
      phase: "waiting",
      work_unit_id: null,
      send_id: null,
      events: ["deferred"],
    });
    expect(new Date(deferred.due_at!).toISOString()).toBe(
      new Date(startedAt.add({ minutes: 15 }).epochMilliseconds).toISOString()
    );
    const {
      rows: [deferredEntry],
    } = await pool.query(
      `select e.detail from email_campaign_automation_run_events e
         join email_campaign_automation_runs r on r.id = e.run_id
        where r.dotypos_customer_id = $1`,
      [extended]
    );
    expect(deferredEntry.detail).toEqual({
      cause: "trigger-not-reached",
      recheckAt: "2026-10-19T10:15:00.000Z",
    });

    const [unit] = await unitsOf(seeded.campaignId);
    expect(unit).toMatchObject({ status: "done" });
    expect(engine.resend.requests()).toEqual([
      {
        key: `email-campaign:${unit!.send_id}:attempt-1:batch-0`,
        to: expect.arrayContaining([
          testEmailAddress(booked),
          testEmailAddress(account),
        ]),
      },
    ]);
    expect(engine.resend.mailed()).toHaveLength(2);
    const {
      rows: [send],
    } = await pool.query(
      "select s.completed_at, s.automation_version_id, c.status from email_campaign_sends s join email_campaigns c on c.id = s.campaign_id where s.id = $1",
      [unit!.send_id]
    );
    expect(send.completed_at).not.toBeNull();
    expect(send.automation_version_id).toBe(seeded.versionId);
    expect(send.status).toBe("active");
  });

  test("a refused first request ends the runs failed / delivery-refused", async () => {
    const id = customerId("refused");
    const engine = await setUp({ customers: [deliverProfile(id)] });
    engine.resend.respondWith(() => "refuse");
    const seeded = await seedAutomation({});
    await seedRuns(seeded, [{ customer: id }]);

    await engine.tick(startedAt);

    expect(outcomesOf(await runsOf(seeded.campaignId))).toEqual({
      [id]: ["ended", "failed", "delivery-refused"],
    });
    expect((await unitsOf(seeded.campaignId))[0]).toMatchObject({
      status: "done",
    });
  });

  test("a paused automation's unit is dropped; its runs stay ready and are planned afresh after resume", async () => {
    const id = customerId("paused");
    const engine = await setUp({ customers: [deliverProfile(id)] });
    const seeded = await seedAutomation({});
    await seedRuns(seeded, [{ customer: id }]);

    // The pause commits while the unit is queued: lifecycle marks it.
    await engine.planOnly(startedAt);
    await engine.lifecycle(
      (lifecycle) => lifecycle.pause(seeded.campaignId),
      startedAt
    );
    await engine.tick(startedAt.add({ minutes: 1 }));

    expect(await unitsOf(seeded.campaignId)).toEqual([
      expect.objectContaining({ status: "dropped", send_id: null }),
    ]);
    expect(await runsOf(seeded.campaignId)).toEqual(
      new Map([
        [
          id,
          expect.objectContaining({
            status: "active",
            phase: "ready",
            work_unit_id: null,
          }),
        ],
      ])
    );
    expect(engine.resend.requests()).toEqual([]);

    await engine.lifecycle(
      (lifecycle) => lifecycle.resume(seeded.campaignId),
      startedAt.add({ minutes: 2 })
    );
    await engine.tick(startedAt.add({ minutes: 3 }));

    expect(outcomesOf(await runsOf(seeded.campaignId))).toEqual({
      [id]: ["ended", "sent", null],
    });
    expect(engine.resend.mailed()).toEqual([testEmailAddress(id)]);
  });

  test("a deliver commit that finds its automation paused writes nothing and drops the unit", async () => {
    const id = customerId("recheck");
    const engine = await setUp({ customers: [deliverProfile(id)] });
    const seeded = await seedAutomation({});
    await seedRuns(seeded, [{ customer: id }]);
    await engine.planOnly(startedAt);
    // The status changes after planning, without marking the unit, as when
    // a pause commits during the unit's fetch.
    await pool.query(
      "update email_campaigns set status = 'paused' where id = $1",
      [seeded.campaignId]
    );

    await engine.drain(startedAt);

    expect(await unitsOf(seeded.campaignId)).toEqual([
      expect.objectContaining({
        status: "dropped",
        send_id: null,
        last_error_code: "automation-paused",
      }),
    ]);
    expect(await runsOf(seeded.campaignId)).toEqual(
      new Map([
        [
          id,
          expect.objectContaining({
            status: "active",
            phase: "ready",
            work_unit_id: null,
            events: [],
          }),
        ],
      ])
    );
    expect(engine.resend.requests()).toEqual([]);
    // A paused automation's runs aren't planned.
    await engine.tick(startedAt.add({ minutes: 1 }));
    expect(await unitsOf(seeded.campaignId)).toHaveLength(1);

    await pool.query(
      "update email_campaigns set status = 'active' where id = $1",
      [seeded.campaignId]
    );
    await engine.tick(startedAt.add({ minutes: 2 }));
    expect(outcomesOf(await runsOf(seeded.campaignId))).toEqual({
      [id]: ["ended", "sent", null],
    });
  });

  test.each<
    readonly [
      string,
      ResendFakeResponse,
      "none" | "pause" | "archive" | "lost-message",
    ]
  >([
    ["before the provider accepted its batch", "hang", "none"],
    ["after the provider accepted its batch", "accept-hang", "none"],
    ["then paused", "accept-hang", "pause"],
    ["then archived", "hang", "archive"],
    ["whose requeued message was lost", "accept-hang", "lost-message"],
  ])(
    "a unit killed after persisting %s is reaped, replays batch 0 once without re-verifying, and holds the deliver slot until it settles",
    async (_label, crash, then) => {
      // Short ids keep the test-domain addresses valid.
      const slug = `kill${crash}${then}`.replaceAll("-", "").slice(0, 16);
      const booked = customerId(`kill-${slug}-booked`);
      const account = customerId(`kill-${slug}-account`);
      const other = customerId(`kill-${slug}-other`);
      const visits = await seedVisits(`kill-${slug}`, [
        {
          label: "booked",
          customer: booked,
          startsAt: startedAt.add({ hours: 24 }),
          endsAt: startedAt.add({ hours: 26 }),
        },
      ]);
      const engine = await setUp({
        customers: [booked, account, other].map((id) => deliverProfile(id)),
      });
      engine.dotypos.setReservations(visits.dotypos);
      const seeded = await seedAutomation({});
      await seedRuns(seeded, [
        {
          customer: booked,
          triggerKind: "reservation-booked",
          reservationId: visits.ids.get("booked"),
        },
        { customer: account },
      ]);

      engine.resend.respondWith(() => crash);
      await engine.killDuringRequest(startedAt);
      engine.resend.respondWith(() => "accept");
      const [killed] = await unitsOf(seeded.campaignId);
      expect(killed).toMatchObject({ status: "claimed" });
      expect(killed!.send_id).not.toBeNull();
      const verified = engine.dotypos.calls.listReservationsPage;
      expect(verified).toBe(1);

      if (then === "pause") {
        await engine.lifecycle(
          (lifecycle) => lifecycle.pause(seeded.campaignId),
          startedAt.add({ minutes: 1 })
        );
      }
      if (then === "archive") {
        await engine.lifecycle(
          (lifecycle) => lifecycle.archive(seeded.campaignId),
          startedAt.add({ minutes: 1 })
        );
      }
      // Lifecycle operations never mark a unit with a persisted batch.
      expect((await unitsOf(seeded.campaignId))[0]).toMatchObject({
        status: "claimed",
        cancel_requested_at: null,
      });

      // Another automation's send waits: the killed unit holds the slot.
      const waiting = await seedAutomation({});
      await seedRuns(waiting, [{ customer: other }]);
      await engine.tick(startedAt.add({ minutes: 2 }));
      expect(await unitsOf(waiting.campaignId)).toEqual([
        expect.objectContaining({ status: "planned" }),
      ]);
      expect(engine.resend.requests()).toHaveLength(1);

      // The claim expires; the reaper requeues the unit whatever the status.
      if (then === "lost-message") {
        await engine.planOnly(startedAt.add({ minutes: 6 }));
        engine.queue.dropPending();
        await engine.tick(startedAt.add({ minutes: 17 }));
      } else {
        await engine.tick(startedAt.add({ minutes: 6 }));
      }

      const runs = await runsOf(seeded.campaignId);
      expect(outcomesOf(runs)).toEqual({
        [account]: ["ended", "sent", null],
        [booked]: ["ended", "sent", null],
      });
      const keys = engine.resend.requests().map(({ key }) => key);
      const killedKey = `email-campaign:${killed!.send_id}:attempt-1:batch-0`;
      expect(keys.filter((key) => key === killedKey)).toHaveLength(2);
      // One email per recipient, even when the provider had accepted it.
      expect(engine.resend.mailed().sort()).toEqual(
        [booked, account, other].map((id) => testEmailAddress(id)).sort()
      );
      expect(engine.dotypos.calls.listReservationsPage).toBe(verified);
      expect((await unitsOf(seeded.campaignId))[0]).toMatchObject({
        status: "done",
      });
      // The settlement handed the slot to the waiting automation's unit.
      expect(outcomesOf(await runsOf(waiting.campaignId))).toEqual({
        [other]: ["ended", "sent", null],
      });
    }
  );

  test("a persisted batch past the 23-hour replay window ends unconfirmed without a request", async () => {
    const id = customerId("expired");
    const engine = await setUp({ customers: [deliverProfile(id)] });
    const seeded = await seedAutomation({});
    await seedRuns(seeded, [{ customer: id }]);
    engine.resend.respondWith(() => "hang");
    await engine.killDuringRequest(startedAt);
    engine.resend.respondWith(() => "accept");

    await engine.tick(startedAt.add({ hours: 23, minutes: 1 }));

    expect(outcomesOf(await runsOf(seeded.campaignId))).toEqual({
      [id]: ["ended", "unconfirmed", null],
    });
    expect(engine.resend.requests()).toHaveLength(1);
    expect((await unitsOf(seeded.campaignId))[0]).toMatchObject({
      status: "done",
    });
  });

  test("a lost provider response requeues the unit, which replays its batch under the same key", async () => {
    const id = customerId("lost-response");
    const engine = await setUp({ customers: [deliverProfile(id)] });
    const seeded = await seedAutomation({ flow: sendOnlyFlow() });
    await seedRuns(seeded, [{ customer: id }]);
    engine.resend.respondWith(() => "accept-lost");

    await engine.tick(startedAt);

    expect(outcomesOf(await runsOf(seeded.campaignId))).toEqual({
      [id]: ["ended", "sent", null],
    });
    const keys = engine.resend.requests().map(({ key }) => key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
    expect(engine.resend.mailed()).toEqual([testEmailAddress(id)]);
    expect((await unitsOf(seeded.campaignId))[0]).toMatchObject({
      status: "done",
      last_error_code: "delivery-incomplete",
    });
  });
});
