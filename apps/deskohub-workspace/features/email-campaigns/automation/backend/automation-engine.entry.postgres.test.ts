import "@/shared/testing/workspace-test-env";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { CampaignId } from "../../campaign-identifiers";
import {
  databaseInstant,
  makeAutomationEngineScenario,
} from "./automation-engine-scenario.test-utils";
import {
  automationFlowFixture,
  bookedSendFlow,
} from "./automation-lifecycle.test-utils";

const database = await connectWorkspacePostgresTestDatabase();

/**
 * Tuesday 1 September 2026, 08:00 in Prague. The sweep stamps `recorded_at`
 * with the database clock, so test instants stay in the wall clock's past,
 * where intake's 24-hour event expiry never applies.
 */
const start = Temporal.Instant.from("2026-09-01T06:00:00Z");

/** Each test runs on its own day, so one test's visits never reach another's sweep. */
const dayStart = (day: number) => start.add({ hours: 24 * day });

/** "When a visit finishes, send." */
const finishedSendFlow = automationFlowFixture({
  trigger: { _tag: "ReservationFinished" },
  steps: [{ _tag: "Send", id: "send" }],
});

/** "When a reservation is booked, wait a week, then send": keeps a run open. */
const bookedWaitFlow = automationFlowFixture({
  trigger: { _tag: "ReservationBooked" },
  steps: [
    {
      _tag: "Wait",
      id: "week",
      wait: { _tag: "Duration", count: 7, unit: "day" },
    },
    { _tag: "Send", id: "send" },
  ],
});

const iso = (value: Date | string | null | undefined) =>
  databaseInstant(value)?.toString() ?? null;

describe.skipIf(!database)("the automation engine's entry", async () => {
  if (!database) return;
  const scenario = await makeAutomationEngineScenario({
    database,
    now: start,
  });
  const { fixtures, kit, read } = scenario;
  const { pool } = database;

  /** Campaigns a test activated; archived after it so later tests' events miss them. */
  const activated: CampaignId[] = [];
  let today = start;

  /** Points the sweep at the start of `day` and returns that instant. */
  const begin = async (day: number) => {
    today = dayStart(day);
    await scenario.prepare(today);
    return today;
  };

  const activate = async (
    flow: Parameters<typeof kit.seedActive>[0],
    at: Temporal.Instant
  ) => {
    const { campaignId } = await kit.seedActive(flow, { at });
    activated.push(campaignId);
    return campaignId;
  };

  afterEach(async () => {
    for (const campaignId of activated.splice(0)) {
      await scenario.lifecycle(
        (lifecycle) => lifecycle.archive(campaignId),
        today.add({ hours: 23 })
      );
    }
  });
  afterAll(() => scenario.cleanup());

  const finishedEvents = async (reservationId: WorkspaceReservationId) =>
    (
      await pool.query(
        "select * from customer_events where workspace_reservation_id = $1 and kind = 'reservation-finished' order by occurred_at",
        [reservationId]
      )
    ).rows;

  const mailedTo = (customer: DotyposCustomerId) =>
    scenario.resend
      .mailed()
      .filter((address) => address === testEmailAddress(customer.slice(-48)));

  /** Ticks until every run of `campaignId` has ended. */
  const settleRuns = (
    campaignId: CampaignId,
    from: Temporal.Instant,
    until: Temporal.Instant
  ) =>
    scenario.runUntil({
      from,
      until,
      settled: async () => {
        const runs = await read.runs(campaignId);
        return runs.length > 0 && runs.every((run) => run.status === "ended");
      },
    });

  /**
   * A finished-visit automation and a visit ending 09:00 UTC, swept up to its
   * end: the sweep has recorded its finished event and intake hasn't run yet.
   */
  const sweptFinishedVisit = async (day: number, label: string) => {
    const at = await begin(day);
    const campaignId = await activate(finishedSendFlow, at);
    const customer = await fixtures.addCustomer(label);
    const endsAt = at.add({ hours: 3 });
    const reservationId = await fixtures.book({
      label,
      customer,
      startsAt: at.add({ hours: 1 }),
      endsAt,
    });
    await scenario.runUntil({ from: at, until: endsAt });
    const [event] = await finishedEvents(reservationId);
    expect(event).toMatchObject({ automation_processed_at: null });
    expect(iso(event.occurred_at)).toBe(endsAt.toString());
    return { campaignId, customer, reservationId, endsAt, at };
  };

  /**
   * A run started for a finished visit, whose visit Dotypos then extends by
   * 50 minutes, so its deliver unit defers it at `endsAt + 2 min`.
   */
  const deferredRun = async (day: number, label: string) => {
    const visit = await sweptFinishedVisit(day, label);
    const { campaignId, reservationId, endsAt } = visit;
    await scenario.tick(endsAt.add({ minutes: 1 }));
    const [started] = await read.runs(campaignId);
    expect(started).toMatchObject({
      status: "active",
      step_id: "send",
      phase: "ready",
    });
    const newEndsAt = endsAt.add({ minutes: 50 });
    fixtures.moveVisit(reservationId, {
      startsAt: visit.at.add({ hours: 1 }),
      endsAt: newEndsAt,
    });
    const deferredAt = endsAt.add({ minutes: 2 });
    await scenario.tick(deferredAt);
    return { ...visit, runId: started.id as string, newEndsAt, deferredAt };
  };

  describe("entry", () => {
    test("a customer with an open run gets an already-active receipt and no second run", async () => {
      const at = await begin(1);
      const campaignId = await activate(bookedWaitFlow, at);
      const customer = await fixtures.addCustomer("active-twice");
      const visit = {
        startsAt: at.add({ hours: 4 }),
        endsAt: at.add({ hours: 5 }),
      };
      const first = await fixtures.book({
        label: "active-first",
        customer,
        ...visit,
      });
      const second = await fixtures.book({
        label: "active-second",
        customer,
        ...visit,
      });

      await fixtures.recordEvent({
        kind: "reservation-booked",
        customer,
        reservationId: first,
        occurredAt: at.add({ minutes: 1 }),
      });
      await scenario.tick(at.add({ minutes: 1 }));
      await fixtures.recordEvent({
        kind: "reservation-booked",
        customer,
        reservationId: second,
        occurredAt: at.add({ minutes: 2 }),
      });
      await scenario.tick(at.add({ minutes: 2 }));

      const runs = await read.runs(campaignId);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        status: "active",
        step_id: "week",
        trigger_reservation_id: first,
      });
      const receipts = await read.receipts(campaignId);
      expect(
        Object.fromEntries(
          receipts.map((receipt) => [
            receipt.dedup_key,
            { disposition: receipt.disposition, runId: receipt.run_id },
          ])
        )
      ).toEqual({
        [`reservation-booked:${first}`]: {
          disposition: "started",
          runId: runs[0].id,
        },
        [`reservation-booked:${second}`]: {
          disposition: "already-active",
          runId: null,
        },
      });
    });

    test("a reservation whose visit finishes again at a new time gets one receipt and one email", async () => {
      const at = await begin(2);
      const campaignId = await activate(finishedSendFlow, at);
      const customer = await fixtures.addCustomer("receipt-once");
      const startsAt = at.add({ hours: 1 });
      const endsAt = at.add({ hours: 3 });
      const reservationId = await fixtures.book({
        label: "receipt-once",
        customer,
        startsAt,
        endsAt,
      });

      const sent = await settleRuns(campaignId, at, at.add({ hours: 4 }));
      expect(sent.settled).toBe(true);
      // Dotypos extends the visit after its email went out.
      const newEndsAt = endsAt.add({ hours: 2 });
      fixtures.moveVisit(reservationId, { startsAt, endsAt: newEndsAt });
      await scenario.runUntil({
        from: sent.at.add({ minutes: 1 }),
        until: newEndsAt.add({ minutes: 5 }),
      });

      const events = await finishedEvents(reservationId);
      expect(events.map((event) => iso(event.occurred_at))).toEqual([
        endsAt.toString(),
        newEndsAt.toString(),
      ]);
      for (const event of events) {
        expect(event.automation_processed_at).not.toBeNull();
      }
      const receipts = await read.receipts(campaignId);
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({
        dedup_key: `reservation-finished:${reservationId}`,
        disposition: "started",
        customer_event_id: events[0].id,
      });
      const runs = await read.runs(campaignId);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ status: "ended", outcome: "sent" });
      expect(mailedTo(customer)).toHaveLength(1);
    });

    test("an event that occurred before accepting_since starts no run and gets no receipt", async () => {
      const at = await begin(3);
      const campaignId = await activate(bookedSendFlow, at);
      const early = await fixtures.addCustomer("before-accepting");
      const late = await fixtures.addCustomer("after-accepting");
      const visit = {
        startsAt: at.add({ hours: 4 }),
        endsAt: at.add({ hours: 5 }),
      };
      const earlyReservation = await fixtures.book({
        label: "before-accepting",
        customer: early,
        ...visit,
      });
      const lateReservation = await fixtures.book({
        label: "after-accepting",
        customer: late,
        ...visit,
      });
      // Both are recorded after activation; only the second occurred after it.
      const recordedAt = at.add({ minutes: 1 });
      const earlyEvent = await fixtures.recordEvent({
        kind: "reservation-booked",
        customer: early,
        reservationId: earlyReservation,
        occurredAt: at.subtract({ milliseconds: 1 }),
        recordedAt,
      });
      const lateEvent = await fixtures.recordEvent({
        kind: "reservation-booked",
        customer: late,
        reservationId: lateReservation,
        occurredAt: at,
        recordedAt,
      });

      await scenario.tick(recordedAt);

      const runs = await read.runs(campaignId);
      expect(runs.map((run) => run.dotypos_customer_id)).toEqual([late]);
      const receipts = await read.receipts(campaignId);
      expect(receipts.map((receipt) => receipt.customer_event_id)).toEqual([
        lateEvent,
      ]);
      const [event] = await read.events([earlyEvent]);
      expect(iso(event.automation_processed_at)).toBe(recordedAt.toString());
      expect(event.automation_unit_id).toBeNull();
    });
  });

  describe("extended visit", () => {
    test("a finished visit extended after the sweep saw it gets no receipt", async () => {
      const { campaignId, reservationId, endsAt, at } =
        await sweptFinishedVisit(4, "extended-superseded");
      fixtures.moveVisit(reservationId, {
        startsAt: at.add({ hours: 1 }),
        endsAt: endsAt.add({ hours: 2 }),
      });

      await scenario.tick(endsAt.add({ minutes: 1 }));

      const [event] = await finishedEvents(reservationId);
      expect(iso(event.automation_processed_at)).toBe(
        endsAt.add({ minutes: 1 }).toString()
      );
      expect(await read.receipts(campaignId)).toEqual([]);
      expect(await read.runs(campaignId)).toEqual([]);
    });

    test("the second finished event at the extended end starts exactly one run", async () => {
      const { campaignId, customer, reservationId, endsAt, at } =
        await sweptFinishedVisit(5, "extended-reentry");
      const newEndsAt = endsAt.add({ hours: 2 });
      fixtures.moveVisit(reservationId, {
        startsAt: at.add({ hours: 1 }),
        endsAt: newEndsAt,
      });

      const progress = await settleRuns(
        campaignId,
        endsAt.add({ minutes: 1 }),
        newEndsAt.add({ hours: 1 })
      );

      expect(progress.settled).toBe(true);
      const events = await finishedEvents(reservationId);
      expect(events.map((event) => iso(event.occurred_at))).toEqual([
        endsAt.toString(),
        newEndsAt.toString(),
      ]);
      const runs = await read.runs(campaignId);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        status: "ended",
        outcome: "sent",
        trigger_event_id: events[1].id,
      });
      expect(iso(runs[0].trigger_at)).toBe(newEndsAt.toString());
      const receipts = await read.receipts(campaignId);
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({
        disposition: "started",
        customer_event_id: events[1].id,
        run_id: runs[0].id,
      });
      expect(mailedTo(customer)).toHaveLength(1);
    });

    test("a run at its send step defers, re-verifies every 15 minutes and sends once after the new end", async () => {
      const {
        campaignId,
        customer,
        reservationId,
        runId,
        newEndsAt,
        deferredAt,
      } = await deferredRun(6, "extended-deferred");

      // Deferred with a recheck instant only: no visit time is stored.
      const [deferred] = await read.runs(campaignId);
      expect(deferred).toMatchObject({
        status: "active",
        step_id: "send",
        phase: "waiting",
        work_unit_id: null,
      });
      const recheckAt = deferredAt.add({ minutes: 15 });
      expect(iso(deferred.due_at)).toBe(recheckAt.toString());
      const timeline = await read.timeline(runId);
      expect(timeline.map((entry) => entry.kind)).toEqual([
        "started",
        "deferred",
      ]);
      expect(timeline[1].detail).toEqual({
        cause: "trigger-not-reached",
        recheckAt: recheckAt.toString({ fractionalSecondDigits: 3 }),
      });
      expect(await read.sends(campaignId)).toEqual([]);

      const progress = await settleRuns(
        campaignId,
        deferredAt.add({ minutes: 1 }),
        newEndsAt.add({ hours: 1 })
      );

      expect(progress.settled).toBe(true);
      const after = await read.timeline(runId);
      expect(after.map((entry) => entry.kind)).toEqual([
        "started",
        "deferred",
        "woke",
        "deferred",
        "woke",
        "deferred",
        "woke",
        "deferred",
        "woke",
        "send-queued",
        "sent",
      ]);
      // Verified at +0, +15, +30 and +45 minutes; the new end is at +48.
      expect(
        after
          .filter((entry) => entry.kind === "deferred")
          .map((entry) => iso(entry.at))
      ).toEqual(
        [0, 15, 30, 45].map((minutes) => deferredAt.add({ minutes }).toString())
      );
      const [run] = await read.runs(campaignId);
      expect(run).toMatchObject({ status: "ended", outcome: "sent" });
      expect(iso(run.ended_at)).toBe(
        deferredAt.add({ minutes: 60 }).toString()
      );
      expect(mailedTo(customer)).toHaveLength(1);
      // The sweep's finished event at the new end found the receipt taken.
      const events = await finishedEvents(reservationId);
      expect(events).toHaveLength(2);
      expect(events[1].automation_processed_at).not.toBeNull();
      expect(await read.receipts(campaignId)).toHaveLength(1);
      expect(await read.runs(campaignId)).toHaveLength(1);
    });

    test("a deferred run whose visit is cancelled in Dotypos is withdrawn at its next verification", async () => {
      const { campaignId, customer, reservationId, runId, deferredAt } =
        await deferredRun(7, "extended-cancelled");
      fixtures.cancelVisit(reservationId);

      const progress = await settleRuns(
        campaignId,
        deferredAt.add({ minutes: 1 }),
        deferredAt.add({ hours: 2 })
      );

      expect(progress.settled).toBe(true);
      const [run] = await read.runs(campaignId);
      expect(run).toMatchObject({ status: "ended", outcome: "withdrawn" });
      expect(iso(run.ended_at)).toBe(
        deferredAt.add({ minutes: 15 }).toString()
      );
      expect((await read.timeline(runId)).map((entry) => entry.kind)).toEqual([
        "started",
        "deferred",
        "woke",
        "withdrawn",
      ]);
      expect(await read.sends(campaignId)).toEqual([]);
      expect(mailedTo(customer)).toEqual([]);
    });

    test("a deferred run whose visit is deleted from Dotypos is withdrawn at its next verification", async () => {
      const { campaignId, customer, reservationId, runId, deferredAt } =
        await deferredRun(8, "extended-deleted");
      fixtures.deleteVisit(reservationId);

      const progress = await settleRuns(
        campaignId,
        deferredAt.add({ minutes: 1 }),
        deferredAt.add({ hours: 2 })
      );

      expect(progress.settled).toBe(true);
      const [run] = await read.runs(campaignId);
      expect(run).toMatchObject({ status: "ended", outcome: "withdrawn" });
      expect(iso(run.ended_at)).toBe(
        deferredAt.add({ minutes: 15 }).toString()
      );
      expect((await read.timeline(runId)).map((entry) => entry.kind)).toEqual([
        "started",
        "deferred",
        "woke",
        "withdrawn",
      ]);
      expect(await read.sends(campaignId)).toEqual([]);
      expect(mailedTo(customer)).toEqual([]);
    });
  });

  describe("PR C/PR D overlap", () => {
    /** Units still holding or waiting for a slot. */
    const openUnits = async () =>
      (await read.units()).filter((unit) =>
        ["planned", "enqueued", "claimed"].includes(unit.status)
      );

    /** A booked-send automation with one booked event waiting for intake. */
    const bookedEvent = async (at: Temporal.Instant, label: string) => {
      const campaignId = await activate(bookedSendFlow, at);
      const customer = await fixtures.addCustomer(label);
      const reservationId = await fixtures.book({
        label,
        customer,
        startsAt: at.add({ hours: 4 }),
        endsAt: at.add({ hours: 5 }),
      });
      const eventId = await fixtures.recordEvent({
        kind: "reservation-booked",
        customer,
        reservationId,
        occurredAt: at,
      });
      return { campaignId, eventId };
    };

    test("a processor with PR C's allowlist hands off only sweep-page units while PR D kinds are planned", async () => {
      const at = await begin(9);
      const { campaignId, eventId } = await bookedEvent(at, "overlap-handoff");
      const oneSlot = { total: 1, deliver: 1 };
      const prD = await scenario.deployment({ limits: oneSlot });
      const prC = await scenario.deployment({
        kinds: ["sweep-page"],
        planning: ["sweep"],
        limits: oneSlot,
      });

      // A minute later PR D plans a sweep page and an intake unit; the sweep
      // page takes the only slot.
      const minute = (n: number) => at.add({ minutes: n });
      await prD.plan(minute(1));
      const planned = await openUnits();
      expect(planned.map((unit) => [unit.kind, unit.status]).sort()).toEqual([
        ["intake", "planned"],
        ["sweep-page", "enqueued"],
      ]);

      // PR C settles it and, for the next two minutes, hands the slot to
      // sweep pages only.
      const handled = [
        ...(await prC.drain(minute(1))),
        ...(await prC.tick(minute(2))).deliveries,
        ...(await prC.tick(minute(3))).deliveries,
      ];
      const kindOf = new Map(
        (await read.units()).map((unit) => [unit.id, unit.kind])
      );
      expect(handled.length).toBeGreaterThanOrEqual(3);
      for (const delivery of handled) {
        expect(kindOf.get(delivery.unitId)).toBe("sweep-page");
        expect(delivery.outcome).toBe("done");
      }
      expect(
        (await openUnits()).map((unit) => [unit.kind, unit.status])
      ).toEqual([["intake", "planned"]]);
      expect(await read.runs(campaignId)).toEqual([]);

      // PR D's next minute settles its sweep page and hands the slot to intake.
      await prD.tick(minute(4));

      expect(await read.runs(campaignId)).toHaveLength(1);
      const [event] = await read.events([eventId]);
      expect(event.automation_processed_at).not.toBeNull();
      expect(await openUnits()).toEqual([]);
    });

    test("an intake message delivered to PR C's processor is acknowledged unclaimed and re-sent by PR D's reaper after 10 minutes", async () => {
      const at = await begin(10);
      const { campaignId, eventId } = await bookedEvent(at, "overlap-resend");
      const prC = await scenario.deployment({
        kinds: ["sweep-page"],
        planning: ["sweep"],
      });

      await scenario.plan(at);
      const [intake] = (await read.units()).filter(
        (unit) => unit.kind === "intake"
      );
      expect(intake).toMatchObject({ status: "enqueued" });
      // Every message, the intake one included, reaches PR C's processor.
      const deliveries = await prC.drain(at);
      expect(
        deliveries.find((delivery) => delivery.unitId === intake.id)
      ).toEqual({ unitId: intake.id, outcome: "acknowledged" });
      const unclaimed = (await read.units()).find(
        (unit) => unit.id === intake.id
      );
      expect(unclaimed).toMatchObject({
        status: "enqueued",
        attempts: 0,
        claim_id: null,
        enqueue_generation: 0,
      });
      expect(await read.receipts(campaignId)).toEqual([]);

      // Not yet 10 minutes unclaimed: no re-send.
      await scenario.plan(at.add({ minutes: 9 }));
      expect(
        scenario.queue.pending().filter((m) => m.unitId === intake.id)
      ).toEqual([]);

      await scenario.plan(at.add({ minutes: 11 }));
      expect(
        scenario.queue.pending().filter((m) => m.unitId === intake.id)
      ).toEqual([
        {
          unitId: intake.id,
          idempotencyKey: `email-automation-unit:${intake.id}:1`,
        },
      ]);
      await scenario.drain(at.add({ minutes: 11 }));

      const receipts = await read.receipts(campaignId);
      expect(receipts.map((receipt) => receipt.disposition)).toEqual([
        "started",
      ]);
      const [event] = await read.events([eventId]);
      expect(event.automation_processed_at).not.toBeNull();
      // No slot is stranded: every unit settled.
      expect(await openUnits()).toEqual([]);
      expect(
        (await read.units()).find((unit) => unit.id === intake.id)
      ).toMatchObject({ status: "done", enqueue_generation: 1, attempts: 1 });
    });
  });

  describe("unmatched events", () => {
    test("intake marks an event no automation matches processed, and health then reports no event backlog", async () => {
      const at = await begin(11);
      const customer = await fixtures.addCustomer("unmatched");
      // Recorded 20 minutes ago: a backlog while unprocessed.
      const eventId = await fixtures.recordEvent({
        kind: "account-created",
        customer,
        occurredAt: at.subtract({ minutes: 20 }),
      });
      expect((await scenario.health(at)).warnings).toContain("event-backlog");

      await scenario.tick(at);

      const [event] = await read.events([eventId]);
      expect(iso(event.automation_processed_at)).toBe(at.toString());
      expect(event.automation_unit_id).toBeNull();
      const { rows: receipts } = await pool.query(
        "select 1 from email_campaign_automation_trigger_receipts where customer_event_id = $1",
        [eventId]
      );
      expect(receipts).toEqual([]);
      expect((await scenario.health(at)).warnings).not.toContain(
        "event-backlog"
      );
    });
  });
});
