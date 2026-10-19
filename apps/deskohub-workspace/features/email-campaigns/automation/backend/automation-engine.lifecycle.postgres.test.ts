import "@/shared/testing/workspace-test-env";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { CampaignId } from "../../campaign-identifiers";
import type { AutomationWorkUnitId } from "../automation-identifiers";
import {
  databaseInstant,
  makeAutomationEngineScenario,
} from "./automation-engine-scenario.test-utils";
import { automationFlowFixture } from "./automation-lifecycle.test-utils";

const database = await connectWorkspacePostgresTestDatabase();

/** Tuesday 13 October 2026, 08:00 in Prague. */
const start = Temporal.Instant.from("2026-10-13T06:00:00Z");

/** "When a reservation is booked, wait two hours, then send." */
const durationWaitFlow = automationFlowFixture({
  trigger: { _tag: "ReservationBooked" },
  steps: [
    {
      _tag: "Wait",
      id: "two-hours",
      wait: { _tag: "Duration", count: 2, unit: "hour" },
    },
    { _tag: "Send", id: "send" },
  ],
});

/** "When a reservation is booked, wait for one hour, then send." */
const hourWaitFlow = automationFlowFixture({
  trigger: { _tag: "ReservationBooked" },
  steps: [
    {
      _tag: "Wait",
      id: "one-hour",
      wait: { _tag: "Duration", count: 1, unit: "hour" },
    },
    { _tag: "Send", id: "send" },
  ],
});

/** "When a reservation is booked, wait until 10:00, then send." */
const calendarWaitFlow = automationFlowFixture({
  trigger: { _tag: "ReservationBooked" },
  steps: [
    {
      _tag: "Wait",
      id: "ten-oclock",
      wait: { _tag: "Calendar", expression: { hours: [10] } },
    },
    { _tag: "Send", id: "send" },
  ],
});

/** "When a reservation is booked, send." */
const sendFlow = automationFlowFixture({
  trigger: { _tag: "ReservationBooked" },
  steps: [{ _tag: "Send", id: "send" }],
});

/**
 * "When a reservation is booked by someone who visited in the month
 * before, send": the condition needs the customer's visits from Dotypos.
 */
const returningVisitorFlow = automationFlowFixture({
  trigger: { _tag: "ReservationBooked" },
  steps: [
    {
      _tag: "Condition",
      id: "visited-last-month",
      filter: {
        attribute: "reservationCount",
        _tag: "Condition",
        params: {
          dateBasis: "visit",
          period: {
            _tag: "TriggerWindow",
            side: "before",
            count: 1,
            unit: "month",
          },
        },
        operator: "gt",
        value: 0,
      },
    },
    { _tag: "Send", id: "send" },
  ],
});

const iso = (value: Date | string | null | undefined) =>
  databaseInstant(value)?.toString() ?? null;

describe.skipIf(!database)(
  "the automation engine around pause, resume and archive",
  async () => {
    if (!database) return;
    const scenario = await makeAutomationEngineScenario({
      database,
      now: start,
    });
    const { fixtures, kit, read } = scenario;
    const { pool } = database;

    /** Campaigns this test activated; archived after it so they match nothing later. */
    let activated: CampaignId[] = [];

    /** Resend traffic from earlier tests, which assertions skip. */
    let earlierRequests = 0;
    let mailedBefore = 0;
    beforeEach(async () => {
      await scenario.prepare(start);
      earlierRequests = scenario.resend.requests().length;
      mailedBefore = scenario.resend.mailed().length;
    });
    /** Addresses this test mailed. */
    const mailed = () => scenario.resend.mailed().slice(mailedBefore);
    /** Batch requests this test made. */
    const requests = () => scenario.resend.requests().slice(earlierRequests);
    afterEach(async () => {
      for (const campaignId of activated) {
        await archive(campaignId, start.add({ hours: 24 * 30 }));
      }
      activated = [];
    });
    afterAll(() => scenario.cleanup());

    const activate = async (
      flow: Parameters<typeof kit.seedActive>[0],
      at = start
    ) => {
      const { campaignId } = await kit.seedActive(flow, { at });
      activated.push(campaignId);
      return campaignId;
    };

    const pause = (campaignId: CampaignId, at: Temporal.Instant) =>
      scenario.lifecycle((lifecycle) => lifecycle.pause(campaignId), at);
    const resume = (campaignId: CampaignId, at: Temporal.Instant) =>
      scenario.lifecycle((lifecycle) => lifecycle.resume(campaignId), at);
    const archive = (campaignId: CampaignId, at: Temporal.Instant) =>
      scenario.lifecycle((lifecycle) => lifecycle.archive(campaignId), at);

    /**
     * A customer whose reservation (visiting in ten days) is booked at
     * `bookedAt`, with its `reservation-booked` event.
     */
    const bookingCustomer = async (
      label: string,
      bookedAt: Temporal.Instant
    ) => {
      const customer = await fixtures.addCustomer(label);
      const visitStartsAt = start.add({ hours: 24 * 10 });
      const reservation = await fixtures.book({
        label: `${label}-booking`,
        customer,
        startsAt: visitStartsAt,
        endsAt: visitStartsAt.add({ hours: 8 }),
      });
      const event = await fixtures.recordEvent({
        kind: "reservation-booked",
        customer,
        occurredAt: bookedAt,
        reservationId: reservation,
      });
      return { customer, reservation, event };
    };

    const runOf = async (campaignId: CampaignId, customer: DotyposCustomerId) =>
      (await read.runs(campaignId)).find(
        (run) => run.dotypos_customer_id === customer
      );

    const timelineKinds = async (runId: string) =>
      (await read.timeline(runId)).map((entry) => entry.kind);

    const unitsOf = async (campaignId: CampaignId, kind: string) =>
      (await read.units(campaignId)).filter((unit) => unit.kind === kind);

    const inFlightUnits = async () =>
      (
        await pool.query<{ count: number }>(
          "select count(*)::int as count from email_campaign_automation_work_units where status in ('enqueued', 'claimed')"
        )
      ).rows[0]!.count;

    /** Takes `unitId`'s message off the queue, as its consumer receiving it would. */
    const takeMessage = (unitId: AutomationWorkUnitId) => {
      const pending = scenario.queue.pending();
      const message = pending.find((m) => m.unitId === unitId);
      if (message === undefined) throw new Error(`${unitId} isn't queued`);
      scenario.queue.dropPending();
      for (const other of pending) {
        if (other !== message) scenario.queue.redeliver(other);
      }
    };

    /** Ticks until every run of `campaignIds` has ended. */
    const settleRuns = (
      campaignIds: readonly CampaignId[],
      from: Temporal.Instant,
      until: Temporal.Instant
    ) =>
      scenario.runUntil({
        from,
        until,
        settled: async () => {
          for (const campaignId of campaignIds) {
            const runs = await read.runs(campaignId);
            if (
              runs.length === 0 ||
              runs.some((run) => run.status !== "ended")
            ) {
              return false;
            }
          }
          return true;
        },
      });

    describe("pause and resume", () => {
      test("a Duration wait overshot during a pause proceeds at once on resume", async () => {
        const campaignId = await activate(durationWaitFlow);
        const { customer } = await bookingCustomer("duration", start);

        await scenario.tick(start);
        await scenario.tick(start.add({ minutes: 1 }));
        const waiting = await runOf(campaignId, customer);
        expect(waiting).toMatchObject({ status: "active", phase: "waiting" });
        expect(iso(waiting.due_at)).toBe(start.add({ hours: 2 }).toString());

        await pause(campaignId, start.add({ hours: 1 }));
        // Paused runs stay frozen past their due time.
        await scenario.tick(start.add({ hours: 2 }));
        await scenario.tick(start.add({ hours: 3 }));
        expect(await runOf(campaignId, customer)).toMatchObject({
          status: "active",
          phase: "waiting",
          step_id: "two-hours",
        });
        expect(requests()).toEqual([]);

        const resumedAt = start.add({ hours: 5 });
        await resume(campaignId, resumedAt);
        const progress = await settleRuns(
          [campaignId],
          resumedAt,
          resumedAt.add({ hours: 1 })
        );

        expect(progress.settled).toBe(true);
        const ended = await runOf(campaignId, customer);
        expect(ended).toMatchObject({ status: "ended", outcome: "sent" });
        expect(iso(ended.ended_at)).toBe(resumedAt.toString());
        expect(await timelineKinds(ended.id)).toEqual([
          "started",
          "waiting",
          "woke",
          "send-queued",
          "sent",
        ]);
        expect(mailed()).toEqual([testEmailAddress(customer.slice(-48))]);
      });

      test("a Calendar wait overshot during a pause proceeds on resume only while it still holds", async () => {
        // Both automations take the same booking; each pauses at 09:00 in
        // Prague, before its 10:00 wait falls due.
        const holds = await activate(calendarWaitFlow);
        const lapsed = await activate(calendarWaitFlow);
        const { customer } = await bookingCustomer("calendar", start);

        await scenario.tick(start);
        await scenario.tick(start.add({ minutes: 1 }));
        const tenOClock = "2026-10-13T08:00:00Z";
        for (const campaignId of [holds, lapsed]) {
          const run = await runOf(campaignId, customer);
          expect(run).toMatchObject({ status: "active", phase: "waiting" });
          expect(iso(run.due_at)).toBe(tenOClock);
          await pause(
            campaignId,
            Temporal.Instant.from("2026-10-13T07:00:00Z")
          );
        }
        await scenario.tick(Temporal.Instant.from(tenOClock));
        expect(requests()).toEqual([]);

        // Resumed at 10:30 in Prague: 10:00 still holds, so the run proceeds.
        const holdsResumedAt = Temporal.Instant.from("2026-10-13T08:30:00Z");
        await resume(holds, holdsResumedAt);
        await scenario.tick(holdsResumedAt);
        const proceeded = await runOf(holds, customer);
        expect(proceeded).toMatchObject({ status: "ended", outcome: "sent" });
        expect(iso(proceeded.ended_at)).toBe(holdsResumedAt.toString());
        expect(await timelineKinds(proceeded.id)).toEqual([
          "started",
          "waiting",
          "woke",
          "send-queued",
          "sent",
        ]);

        // Resumed at 11:30: 10:00 no longer holds, so it waits for tomorrow's.
        const lapsedResumedAt = Temporal.Instant.from("2026-10-13T09:30:00Z");
        await resume(lapsed, lapsedResumedAt);
        await scenario.tick(lapsedResumedAt);
        const rescheduled = await runOf(lapsed, customer);
        expect(rescheduled).toMatchObject({
          status: "active",
          phase: "waiting",
          step_id: "ten-oclock",
        });
        expect(iso(rescheduled.due_at)).toBe("2026-10-14T08:00:00Z");
        expect(await timelineKinds(rescheduled.id)).toEqual([
          "started",
          "waiting",
          "waiting",
        ]);

        const progress = await settleRuns(
          [lapsed],
          lapsedResumedAt.add({ minutes: 1 }),
          Temporal.Instant.from("2026-10-14T12:00:00Z")
        );
        expect(progress.settled).toBe(true);
        const sentNextDay = await runOf(lapsed, customer);
        expect(sentNextDay).toMatchObject({ status: "ended", outcome: "sent" });
        expect(iso(sentNextDay.ended_at)).toBe("2026-10-14T08:00:00Z");
        expect(mailed()).toEqual([
          testEmailAddress(customer.slice(-48)),
          testEmailAddress(customer.slice(-48)),
        ]);
      });

      test("events occurring while paused never start runs, even after resume", async () => {
        const campaignId = await activate(sendFlow);
        // Booked before the pause but not yet taken in: an unprocessed backlog.
        const backlog = await bookingCustomer("backlog", start);
        const pausedAt = start.add({ minutes: 1 });
        await pause(campaignId, pausedAt);

        const duringPause = await bookingCustomer(
          "during-pause",
          start.add({ minutes: 5 })
        );
        await scenario.tick(start.add({ minutes: 10 }));
        expect(await read.runs(campaignId)).toEqual([]);
        // Occurs while paused and is still unprocessed when it resumes.
        const beforeResume = await bookingCustomer(
          "before-resume",
          start.add({ minutes: 15 })
        );

        const resumedAt = start.add({ minutes: 20 });
        await resume(campaignId, resumedAt);
        await scenario.tick(resumedAt);
        const afterResume = await bookingCustomer(
          "after-resume",
          resumedAt.add({ minutes: 1 })
        );
        const progress = await settleRuns(
          [campaignId],
          resumedAt.add({ minutes: 1 }),
          resumedAt.add({ hours: 1 })
        );

        expect(progress.settled).toBe(true);
        const runs = await read.runs(campaignId);
        expect(runs.map((run) => run.dotypos_customer_id)).toEqual([
          afterResume.customer,
        ]);
        expect(runs[0]).toMatchObject({ outcome: "sent" });
        const receipts = await read.receipts(campaignId);
        expect(receipts.map((receipt) => receipt.dotypos_customer_id)).toEqual([
          afterResume.customer,
        ]);
        const events = await read.events([
          backlog.event,
          duringPause.event,
          beforeResume.event,
          afterResume.event,
        ]);
        expect(
          events.every((event) => event.automation_processed_at !== null)
        ).toBe(true);
        expect(mailed()).toEqual([
          testEmailAddress(afterResume.customer.slice(-48)),
        ]);
      });

      test("pause drops planned units and marks in-flight ones, and resume replans their runs without leaking a slot", async () => {
        // Three automations take the same booking; two deliver units may be
        // in flight, so one stays planned.
        const campaigns = [
          await activate(sendFlow),
          await activate(sendFlow),
          await activate(sendFlow),
        ];
        const { customer } = await bookingCustomer("replanned", start);
        const engine = await scenario.deployment({
          limits: { total: 4, deliver: 2 },
          planning: ["intake", "timers", "conditions", "sends", "schedules"],
        });

        await engine.tick(start);
        const plannedAt = start.add({ minutes: 1 });
        await engine.plan(plannedAt);
        const deliverUnits = async () =>
          (
            await Promise.all(
              campaigns.map((campaignId) => unitsOf(campaignId, "deliver"))
            )
          ).flat();
        const before = await deliverUnits();
        expect(before.map((unit) => unit.status).sort()).toEqual([
          "enqueued",
          "enqueued",
          "planned",
        ]);
        const planned = before.find((unit) => unit.status === "planned")!;
        const [claimed, enqueued] = before.filter(
          (unit) => unit.status === "enqueued"
        );

        // One consumer is mid-verification when the pause lands.
        takeMessage(claimed.id);
        const gate = scenario.dotypos.gate();
        const consumer = engine.start(claimed.id, plannedAt);
        await gate.reached;
        const pausedAt = start.add({ minutes: 2 });
        for (const campaignId of campaigns) await pause(campaignId, pausedAt);

        const marked = new Map(
          (await deliverUnits()).map((unit) => [unit.id, unit])
        );
        expect(marked.get(planned.id)).toMatchObject({ status: "dropped" });
        expect(marked.get(enqueued!.id)).toMatchObject({ status: "enqueued" });
        expect(marked.get(enqueued!.id).cancel_requested_at).not.toBeNull();
        expect(marked.get(claimed.id)).toMatchObject({ status: "claimed" });
        expect(marked.get(claimed.id).cancel_requested_at).not.toBeNull();
        // The planned unit's run is back with the planner; the others' wait.
        const plannedRun = (await read.runs(planned.campaign_id))[0];
        expect(plannedRun).toMatchObject({
          status: "active",
          phase: "ready",
          work_unit_id: null,
        });

        gate.release();
        const settled = await consumer.done;
        expect(settled).toMatchObject({ success: "dropped" });
        await engine.tick(start.add({ minutes: 3 }));

        const dropped = await deliverUnits();
        expect(dropped.map((unit) => unit.status)).toEqual([
          "dropped",
          "dropped",
          "dropped",
        ]);
        expect(await inFlightUnits()).toBe(0);
        for (const campaignId of campaigns) {
          expect(await read.runs(campaignId)).toMatchObject([
            {
              status: "active",
              step_id: "send",
              phase: "ready",
              work_unit_id: null,
            },
          ]);
        }
        expect(requests()).toEqual([]);

        const resumedAt = start.add({ minutes: 4 });
        for (const campaignId of campaigns) await resume(campaignId, resumedAt);
        const progress = await settleRuns(
          campaigns,
          resumedAt,
          resumedAt.add({ hours: 1 })
        );

        expect(progress.settled).toBe(true);
        for (const campaignId of campaigns) {
          const [run] = await read.runs(campaignId);
          expect(run).toMatchObject({ status: "ended", outcome: "sent" });
          expect(await timelineKinds(run.id)).toEqual([
            "started",
            "send-queued",
            "sent",
          ]);
          expect(
            (await unitsOf(campaignId, "deliver")).map((unit) => unit.status)
          ).toEqual(["dropped", "done"]);
        }
        expect(mailed()).toEqual(
          campaigns.map(() => testEmailAddress(customer.slice(-48)))
        );
        expect(await inFlightUnits()).toBe(0);
      });

      test("a pause and resume during a fetch commits nothing, and a fresh unit applies once", async () => {
        const campaignId = await activate(returningVisitorFlow);
        const { customer } = await bookingCustomer("mid-fetch", start);
        await fixtures.book({
          label: "mid-fetch-last-visit",
          customer,
          startsAt: Temporal.Instant.from("2026-10-01T07:00:00Z"),
          endsAt: Temporal.Instant.from("2026-10-01T15:00:00Z"),
        });

        await scenario.tick(start);
        const plannedAt = start.add({ minutes: 1 });
        await scenario.plan(plannedAt);
        const [unit] = await unitsOf(campaignId, "condition");
        expect(unit).toMatchObject({ status: "enqueued" });

        takeMessage(unit.id);
        const gate = scenario.dotypos.gate();
        const consumer = scenario.start(unit.id, plannedAt);
        await gate.reached;
        await pause(campaignId, start.add({ minutes: 2 }));
        await resume(campaignId, start.add({ minutes: 3 }));
        gate.release();
        expect(await consumer.done).toMatchObject({ success: "dropped" });

        const untouched = await runOf(campaignId, customer);
        expect(untouched).toMatchObject({
          status: "active",
          step_id: "visited-last-month",
          phase: "ready",
          work_unit_id: null,
        });
        expect(await timelineKinds(untouched.id)).toEqual(["started"]);

        const progress = await settleRuns(
          [campaignId],
          start.add({ minutes: 3 }),
          start.add({ hours: 1 })
        );

        expect(progress.settled).toBe(true);
        const ended = await runOf(campaignId, customer);
        expect(ended).toMatchObject({ status: "ended", outcome: "sent" });
        expect(await timelineKinds(ended.id)).toEqual([
          "started",
          "condition-passed",
          "send-queued",
          "sent",
        ]);
        expect(
          (await unitsOf(campaignId, "condition")).map((u) => u.status)
        ).toEqual(["dropped", "done"]);
        expect(mailed()).toEqual([testEmailAddress(customer.slice(-48))]);
      });
    });

    describe("archive", () => {
      test("archive starts no new runs, ends active runs archived and drops planned units, while a persisted batch still settles sent", async () => {
        const campaignId = await activate(hourWaitFlow);
        const sending = await bookingCustomer("archive-sending", start);
        await scenario.tick(start);
        await scenario.tick(start.add({ minutes: 1 }));
        const deliverPlanned = await bookingCustomer(
          "archive-planned",
          start.add({ minutes: 2 })
        );
        await scenario.tick(start.add({ minutes: 2 }));
        await scenario.tick(start.add({ minutes: 3 }));
        const waiting = await bookingCustomer(
          "archive-waiting",
          start.add({ minutes: 30 })
        );
        await scenario.tick(start.add({ minutes: 30 }));
        await scenario.tick(start.add({ minutes: 31 }));

        // The first run's batch is persisted and with Resend when its consumer
        // is cut off: the unit stays claimed, holding the deliver slot.
        const sendingDue = start.add({ hours: 1 });
        expect(iso((await runOf(campaignId, sending.customer)).due_at)).toBe(
          sendingDue.toString()
        );
        await scenario.plan(sendingDue);
        const [persisted] = await unitsOf(campaignId, "deliver");
        takeMessage(persisted.id);
        scenario.resend.respondWith(() => "accept-hang");
        const reached = scenario.resend.nextRequest();
        const consumer = scenario.start(persisted.id, sendingDue);
        const cutOff = consumer.done.then(
          () => "finished",
          () => "cut off"
        );
        await reached;
        await consumer.interrupt();
        expect(await cutOff).toBe("cut off");
        scenario.resend.respondWith(() => "accept");
        await scenario.drain(sendingDue);

        // The second run reaches its send step while the slot is held.
        const plannedDue = start.add({ hours: 1, minutes: 2 });
        await scenario.tick(plannedDue);
        const units = await unitsOf(campaignId, "deliver");
        expect(units.map((unit) => unit.status)).toEqual([
          "claimed",
          "planned",
        ]);
        expect(await runOf(campaignId, sending.customer)).toMatchObject({
          status: "sending",
        });

        const archivedAt = start.add({ hours: 1, minutes: 3 });
        await archive(campaignId, archivedAt);

        const afterArchive = await unitsOf(campaignId, "deliver");
        expect(afterArchive[0]).toMatchObject({
          id: persisted.id,
          status: "claimed",
          cancel_requested_at: null,
        });
        expect(afterArchive[1]).toMatchObject({ status: "dropped" });
        for (const { customer } of [deliverPlanned, waiting]) {
          const run = await runOf(campaignId, customer);
          expect(run).toMatchObject({ status: "ended", outcome: "archived" });
          expect(iso(run.ended_at)).toBe(archivedAt.toString());
        }

        const late = await bookingCustomer(
          "archive-late",
          archivedAt.add({ minutes: 1 })
        );
        const progress = await scenario.runUntil({
          from: archivedAt.add({ minutes: 1 }),
          until: archivedAt.add({ hours: 1 }),
          settled: async () =>
            (await runOf(campaignId, sending.customer)).status === "ended",
        });

        expect(progress.settled).toBe(true);
        expect(await runOf(campaignId, sending.customer)).toMatchObject({
          status: "ended",
          outcome: "sent",
        });
        expect(await runOf(campaignId, late.customer)).toBeUndefined();
        expect(
          (await read.receipts(campaignId)).map(
            (receipt) => receipt.dotypos_customer_id
          )
        ).not.toContain(late.customer);
        const [lateEvent] = await read.events([late.event]);
        expect(lateEvent.automation_processed_at).not.toBeNull();
        // The replay reused the batch's key, so the email went out once.
        expect(mailed()).toEqual([
          testEmailAddress(sending.customer.slice(-48)),
        ]);
        const keys = requests().map((request) => request.key);
        expect(keys.length).toBeGreaterThan(1);
        expect(new Set(keys).size).toBe(1);
        expect(
          (await unitsOf(campaignId, "deliver")).map((unit) => unit.status)
        ).toEqual(["done", "dropped"]);
      });
    });
  }
);
