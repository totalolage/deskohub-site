import "@/shared/testing/workspace-test-env";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { type DotyposCustomerId, DotyposUnavailable } from "@deskohub/dotypos";
import { resendSimulatorAddress, testEmailAddress } from "@deskohub/test-email";
import type { AutomationFlowType } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { campaignContentFixture } from "../../backend/email-campaigns.test-utils";
import type { CampaignId } from "../../campaign-identifiers";
import type { AutomationWorkUnitId } from "../automation-identifiers";
import {
  databaseInstant,
  makeAutomationEngineScenario,
  type ResendFakeResponse,
} from "./automation-engine-scenario.test-utils";
import {
  automationFlowFixture,
  bookedSendFlow,
} from "./automation-lifecycle.test-utils";
import { scheduleDedupKey } from "./automation-schedule-fires";
import {
  comeBackOfferFlow,
  lapsedRegularsFilter,
  reviewRequestFlow,
} from "./automation-stories.test-utils";

/**
 * The engine plans over whole tables, so the suite runs on a database of
 * its own.
 */
const database =
  await createWorkspacePostgresSuiteDatabase("automation_engine");
afterAll(() => database?.close());

describe.skipIf(!database)("the automation engine end to end", async () => {
  if (!database) return;
  /** Tuesday 13 October 2026, 08:00 in Prague. */
  const start = Temporal.Instant.from("2026-10-13T06:00:00Z");

  const iso = (value: Date | string | null | undefined) =>
    databaseInstant(value)?.toString() ?? null;
  const scenario = await makeAutomationEngineScenario({
    database,
    now: start,
  });
  const { fixtures, kit, read } = scenario;

  beforeEach(() => scenario.prepare(start));
  afterAll(() => scenario.cleanup());

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

  describe("story 1: review request", () => {
    test("a second visit within a month gets one email at the next 10:00 after a 2-hour wait", async () => {
      const { campaignId } = await kit.seedActive(reviewRequestFlow, {
        at: start,
      });
      const second = await fixtures.addCustomer("story1-second");
      const once = await fixtures.addCustomer("story1-once");
      await fixtures.book({
        label: "story1-second-first",
        customer: second,
        startsAt: Temporal.Instant.from("2026-10-01T07:00:00Z"),
        endsAt: Temporal.Instant.from("2026-10-01T15:00:00Z"),
      });
      const secondVisit = await fixtures.book({
        label: "story1-second-second",
        customer: second,
        startsAt: Temporal.Instant.from("2026-10-13T07:00:00Z"),
        endsAt: Temporal.Instant.from("2026-10-13T15:00:00Z"),
      });
      const onlyVisit = await fixtures.book({
        label: "story1-once-only",
        customer: once,
        startsAt: Temporal.Instant.from("2026-10-13T07:00:00Z"),
        endsAt: Temporal.Instant.from("2026-10-13T15:00:00Z"),
      });

      const progress = await settleRuns(
        campaignId,
        start,
        start.add({ hours: 48 })
      );

      expect(progress.settled).toBe(true);
      const runs = await read.runs(campaignId);
      const byCustomer = new Map(
        runs.map((run) => [run.dotypos_customer_id, run])
      );
      expect(byCustomer.get(second)).toMatchObject({
        status: "ended",
        outcome: "sent",
        trigger_kind: "reservation-finished",
        trigger_reservation_id: secondVisit,
      });
      expect(iso(byCustomer.get(second).trigger_at)).toBe(
        "2026-10-13T15:00:00Z"
      );
      // 10:00 in Prague on Wednesday, after the 2-hour settle.
      expect(iso(byCustomer.get(second).ended_at)).toBe("2026-10-14T08:00:00Z");
      expect(byCustomer.get(once)).toMatchObject({
        status: "ended",
        outcome: "condition-failed",
        trigger_reservation_id: onlyVisit,
      });
      expect(scenario.resend.mailed()).toEqual([
        testEmailAddress(second.slice(-48)),
      ]);
      const timeline = await read.timeline(byCustomer.get(second).id);
      expect(timeline.map((entry) => entry.kind)).toEqual([
        "started",
        "condition-passed",
        "waiting",
        "woke",
        "waiting",
        "woke",
        "send-queued",
        "sent",
      ]);
    });
  });
});

describe.skipIf(!database)("the automation engine's entry", async () => {
  if (!database) return;
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
    until: Temporal.Instant,
    options: { readonly onTicks?: boolean } = {}
  ) =>
    scenario.runUntil({
      ...options,
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
   * A run started for a finished visit, whose visit Dotypos extends by 50
   * minutes right after intake started it, so its deliver unit, planned by
   * intake within the same tick (D36), defers it at `endsAt + 1 min`.
   */
  const deferredRun = async (day: number, label: string) => {
    const visit = await sweptFinishedVisit(day, label);
    const { campaignId, reservationId, endsAt } = visit;
    const deferredAt = endsAt.add({ minutes: 1 });
    await scenario.plan(deferredAt);
    let [started] = await read.runs(campaignId);
    while (started === undefined) {
      const next = scenario.processNext(deferredAt);
      expect(next).toBeDefined();
      await next;
      [started] = await read.runs(campaignId);
    }
    expect(started).toMatchObject({
      status: "active",
      step_id: "send",
      phase: "ready",
    });
    expect(started.work_unit_id).not.toBeNull();
    const newEndsAt = endsAt.add({ minutes: 50 });
    fixtures.moveVisit(reservationId, {
      startsAt: visit.at.add({ hours: 1 }),
      endsAt: newEndsAt,
    });
    await scenario.drain(deferredAt);
    return { ...visit, runId: started.id as string, newEndsAt, deferredAt };
  };

  describe("entry", () => {
    /** "When a reservation is booked, unless already emailed, send": two local conditions. */
    const bookedConditionsFlow = (
      ...rest: Parameters<typeof automationFlowFixture>[0]["steps"]
    ) =>
      automationFlowFixture({
        trigger: { _tag: "ReservationBooked" },
        steps: [
          ...["not-emailed", "still-not-emailed"].map((id) => ({
            _tag: "Condition" as const,
            id,
            filter: {
              _tag: "Group" as const,
              operator: "and" as const,
              filters: [
                {
                  attribute: "campaignEmailCount" as const,
                  _tag: "Condition" as const,
                  params: {
                    purpose: "any" as const,
                    period: { _tag: "AnyTime" as const },
                    campaign: { _tag: "This" as const },
                  },
                  operator: "eq" as const,
                  value: 0,
                },
              ],
            },
          })),
          ...rest,
          { _tag: "Send", id: "send" },
        ],
      });

    /** A booked visit for a new customer, its event recorded `after` `at`. */
    const bookedEvent = async (
      at: Temporal.Instant,
      label: string,
      after: Temporal.DurationLike = { minutes: 1 }
    ) => {
      const customer = await fixtures.addCustomer(label);
      const reservationId = await fixtures.book({
        label,
        customer,
        startsAt: at.add({ hours: 4 }),
        endsAt: at.add({ hours: 5 }),
      });
      const recordedAt = at.add(after);
      await fixtures.recordEvent({
        kind: "reservation-booked",
        customer,
        reservationId,
        occurredAt: at,
        recordedAt,
      });
      return { customer, recordedAt };
    };

    test("a run whose flow starts with conditions sends within the tick that took its event in", async () => {
      const at = await begin(10);
      const campaignId = await activate(bookedConditionsFlow(), at);
      const { customer, recordedAt } = await bookedEvent(at, "chain-send");

      // One planner run and the queue drained after it, no re-planning.
      await scenario.tick(recordedAt);

      const [run] = await read.runs(campaignId);
      expect(run).toMatchObject({ status: "ended", outcome: "sent" });
      expect(iso(run.ended_at)).toBe(recordedAt.toString());
      const timeline = await read.timeline(run.id);
      expect(timeline.map((entry) => [entry.kind, entry.step_id])).toEqual([
        ["started", "not-emailed"],
        ["condition-passed", "not-emailed"],
        ["condition-passed", "still-not-emailed"],
        ["send-queued", "send"],
        ["sent", "send"],
      ]);
      expect(mailedTo(customer)).toHaveLength(1);

      // Duplicate deliveries of every settled unit change nothing.
      for (const unit of await read.units(campaignId)) {
        await scenario.process(unit.id, recordedAt.add({ seconds: 1 }));
      }
      expect(await read.timeline(run.id)).toHaveLength(timeline.length);
      expect(await read.sends(campaignId)).toHaveLength(1);
      expect(mailedTo(customer)).toHaveLength(1);
    });

    test("a 2-hour wait entered seconds after a tick counts from the tick and completes 2 hours later", async () => {
      const at = await begin(11);
      const campaignId = await activate(
        bookedConditionsFlow({
          _tag: "Wait",
          id: "settle",
          wait: { _tag: "Duration", count: 2, unit: "hour" },
        }),
        at
      );
      const { customer, recordedAt } = await bookedEvent(at, "chain-wait");

      // The units run a few seconds after the planner.
      await scenario.plan(recordedAt);
      const enteredAt = recordedAt.add({ seconds: 5 });
      await scenario.drain(enteredAt);
      const [waiting] = await read.runs(campaignId);
      expect(waiting).toMatchObject({ status: "active", step_id: "settle" });
      expect(iso(waiting.step_entered_at)).toBe(enteredAt.toString());

      const nextTick = recordedAt.add({ minutes: 15 });
      await scenario.tick(nextTick);
      const [entered] = await read.runs(campaignId);
      expect(entered).toMatchObject({ status: "active", phase: "waiting" });
      // The planner started at `recordedAt`, a minute into the `at` tick.
      expect(iso(entered.due_at)).toBe(at.add({ hours: 2 }).toString());

      const dueTick = recordedAt.add({ hours: 2 });
      await scenario.tick(dueTick);
      const [run] = await read.runs(campaignId);
      expect(run).toMatchObject({ status: "ended", outcome: "sent" });
      expect(iso(run.ended_at)).toBe(dueTick.toString());
      expect(mailedTo(customer)).toHaveLength(1);
    });

    test("on the cron's ticks, an event recorded at 08:07 with a 2-hour wait sends at 10:15", async () => {
      const at = await begin(13);
      const campaignId = await activate(
        bookedConditionsFlow({
          _tag: "Wait",
          id: "settle",
          wait: { _tag: "Duration", count: 2, unit: "hour" },
        }),
        at
      );
      const { customer, recordedAt } = await bookedEvent(at, "chain-cron", {
        minutes: 7,
      });

      const progress = await settleRuns(
        campaignId,
        recordedAt,
        at.add({ hours: 4 }),
        { onTicks: true }
      );

      expect(progress.settled).toBe(true);
      const [run] = await read.runs(campaignId);
      expect(run).toMatchObject({ status: "ended", outcome: "sent" });
      // Entered on the 08:15 tick, so due at 10:15.
      expect(iso(run.ended_at)).toBe(
        at.add({ hours: 2, minutes: 15 }).toString()
      );
      expect(mailedTo(customer)).toHaveLength(1);
    });

    test("a 7-minute wait entered just after a tick completes on the next tick", async () => {
      const at = await begin(12);
      const campaignId = await activate(
        bookedConditionsFlow({
          _tag: "Wait",
          id: "short",
          wait: { _tag: "Duration", count: 7, unit: "minute" },
        }),
        at
      );
      const { customer, recordedAt } = await bookedEvent(at, "chain-short");

      // Entered after this tick's timers, so they first see it next tick.
      await scenario.plan(recordedAt);
      await scenario.drain(recordedAt.add({ seconds: 5 }));
      const nextTick = recordedAt.add({ minutes: 15 });
      await scenario.tick(nextTick);

      const [run] = await read.runs(campaignId);
      expect(run).toMatchObject({ status: "ended", outcome: "sent" });
      expect(iso(run.ended_at)).toBe(nextTick.toString());
      expect((await read.timeline(run.id)).map((entry) => entry.kind)).toEqual([
        "started",
        "condition-passed",
        "condition-passed",
        "waiting",
        "woke",
        "send-queued",
        "sent",
      ]);
      expect(mailedTo(customer)).toHaveLength(1);
    });

    test("a 1-minute wait entered during a late planner's tick completes on the next tick, not at once", async () => {
      const at = await begin(15);
      const campaignId = await activate(
        bookedConditionsFlow({
          _tag: "Wait",
          id: "minute",
          wait: { _tag: "Duration", count: 1, unit: "minute" },
        }),
        at
      );
      const { customer } = await bookedEvent(at, "chain-minute", {
        seconds: 10,
      });

      // The cron started the `at` tick 40 seconds late; a second planner
      // overlaps it 10 seconds after the units entered the wait.
      const jittered = at.add({ seconds: 40 });
      await scenario.plan(jittered);
      await scenario.drain(jittered.add({ seconds: 5 }));
      await scenario.tick(jittered.add({ seconds: 15 }));
      const [waiting] = await read.runs(campaignId);
      expect(waiting).toMatchObject({
        status: "active",
        phase: "waiting",
        step_id: "minute",
      });
      expect(iso(waiting.due_at)).toBe(at.add({ minutes: 1 }).toString());
      expect(mailedTo(customer)).toHaveLength(0);

      const nextTick = at.add({ minutes: 15, seconds: 40 });
      await scenario.tick(nextTick);
      const [run] = await read.runs(campaignId);
      expect(run).toMatchObject({ status: "ended", outcome: "sent" });
      expect(iso(run.ended_at)).toBe(nextTick.toString());
      expect(mailedTo(customer)).toHaveLength(1);
    });

    test("a late planner leaves an event after its tick to the next, so a 2-hour wait never ends before event + 2 hours", async () => {
      const at = await begin(16);
      const campaignId = await activate(
        bookedConditionsFlow({
          _tag: "Wait",
          id: "settle",
          wait: { _tag: "Duration", count: 2, unit: "hour" },
        }),
        at
      );
      const onTick = await bookedEvent(at, "chain-on-tick", { seconds: 0 });
      const afterTick = await bookedEvent(
        at.add({ seconds: 20 }),
        "chain-after-tick",
        { seconds: 0 }
      );
      const runsByCustomer = async () =>
        new Map(
          (await read.runs(campaignId)).map((run) => [
            run.dotypos_customer_id,
            run,
          ])
        );

      // The cron started the `at` tick 40 seconds late, after the second
      // event: that waits for the next tick.
      await scenario.plan(at.add({ seconds: 40 }));
      await scenario.drain(at.add({ seconds: 45 }));
      let runs = await runsByCustomer();
      expect(runs.has(afterTick.customer)).toBe(false);
      expect(iso(runs.get(onTick.customer).due_at)).toBe(
        at.add({ hours: 2 }).toString()
      );

      await scenario.tick(at.add({ minutes: 15, seconds: 40 }));
      runs = await runsByCustomer();
      expect(runs.get(afterTick.customer)).toMatchObject({
        status: "active",
        phase: "waiting",
        step_id: "settle",
      });
      expect(iso(runs.get(afterTick.customer).due_at)).toBe(
        at.add({ hours: 2, minutes: 15 }).toString()
      );

      const dueTick = at.add({ hours: 2, seconds: 40 });
      await scenario.tick(dueTick);
      runs = await runsByCustomer();
      expect(runs.get(onTick.customer)).toMatchObject({
        status: "ended",
        outcome: "sent",
      });
      expect(iso(runs.get(onTick.customer).ended_at)).toBe(dueTick.toString());
      expect(runs.get(afterTick.customer)).toMatchObject({ status: "active" });
      expect(mailedTo(afterTick.customer)).toHaveLength(0);

      const nextTick = at.add({ hours: 2, minutes: 15, seconds: 40 });
      await scenario.tick(nextTick);
      runs = await runsByCustomer();
      expect(runs.get(afterTick.customer)).toMatchObject({
        status: "ended",
        outcome: "sent",
      });
      expect(iso(runs.get(afterTick.customer).ended_at)).toBe(
        nextTick.toString()
      );
      expect(mailedTo(onTick.customer)).toHaveLength(1);
      expect(mailedTo(afterTick.customer)).toHaveLength(1);
    });

    test("a wait that holds when the timers wake a run into it goes on to send on that tick", async () => {
      const at = await begin(14);
      const campaignId = await activate(
        bookedConditionsFlow(
          {
            _tag: "Wait",
            id: "hour",
            wait: { _tag: "Duration", count: 1, unit: "hour" },
          },
          // 09:00–09:59 in Prague: holding when the hour ends at 09:15.
          {
            _tag: "Wait",
            id: "nine-oclock",
            wait: { _tag: "Calendar", expression: { hours: [9] } },
          }
        ),
        at
      );
      const { customer, recordedAt } = await bookedEvent(at, "chain-woken");

      const progress = await settleRuns(
        campaignId,
        recordedAt,
        at.add({ hours: 4 }),
        { onTicks: true }
      );

      expect(progress.settled).toBe(true);
      const [run] = await read.runs(campaignId);
      expect(run).toMatchObject({ status: "ended", outcome: "sent" });
      expect(iso(run.ended_at)).toBe(
        at.add({ hours: 1, minutes: 15 }).toString()
      );
      expect(
        (await read.timeline(run.id)).map((entry) => [
          entry.kind,
          entry.step_id,
        ])
      ).toEqual([
        ["started", "not-emailed"],
        ["condition-passed", "not-emailed"],
        ["condition-passed", "still-not-emailed"],
        ["waiting", "hour"],
        ["woke", "hour"],
        ["woke", "nine-oclock"],
        ["send-queued", "send"],
        ["sent", "send"],
      ]);
      expect(mailedTo(customer)).toHaveLength(1);
    });

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
      // Each taken in on the tick after it occurred.
      await scenario.tick(at.add({ minutes: 15 }));
      await fixtures.recordEvent({
        kind: "reservation-booked",
        customer,
        reservationId: second,
        occurredAt: at.add({ minutes: 16 }),
      });
      await scenario.tick(at.add({ minutes: 30 }));

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
        endsAt,
        newEndsAt,
        deferredAt,
      } = await deferredRun(6, "extended-deferred");

      // Deferred with a recheck instant only: no visit time is stored. It
      // was deferred during the `endsAt` tick, so it's rechecked on the next.
      const [deferred] = await read.runs(campaignId);
      expect(deferred).toMatchObject({
        status: "active",
        step_id: "send",
        phase: "waiting",
        work_unit_id: null,
      });
      const recheckAt = endsAt.add({ minutes: 15 });
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
      // Verified on the deferring tick, then on the next three; the new end
      // is 50 minutes after that tick.
      expect(
        after
          .filter((entry) => entry.kind === "deferred")
          .map((entry) => iso(entry.at))
      ).toEqual([
        deferredAt.toString(),
        ...[15, 30, 45].map((minutes) => endsAt.add({ minutes }).toString()),
      ]);
      const [run] = await read.runs(campaignId);
      expect(run).toMatchObject({ status: "ended", outcome: "sent" });
      expect(iso(run.ended_at)).toBe(endsAt.add({ minutes: 60 }).toString());
      expect(mailedTo(customer)).toHaveLength(1);
      // The sweep's finished event at the new end found the receipt taken.
      const events = await finishedEvents(reservationId);
      expect(events).toHaveLength(2);
      expect(events[1].automation_processed_at).not.toBeNull();
      expect(await read.receipts(campaignId)).toHaveLength(1);
      expect(await read.runs(campaignId)).toHaveLength(1);
    });

    test("a deferred run whose visit is cancelled in Dotypos is withdrawn at its next verification", async () => {
      const { campaignId, customer, reservationId, runId, endsAt, deferredAt } =
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
      // Rechecked on the tick after the one that deferred it.
      expect(iso(run.ended_at)).toBe(endsAt.add({ minutes: 15 }).toString());
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
      const { campaignId, customer, reservationId, runId, endsAt, deferredAt } =
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
      // Rechecked on the tick after the one that deferred it.
      expect(iso(run.ended_at)).toBe(endsAt.add({ minutes: 15 }).toString());
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
      // Recorded 31 minutes ago: a backlog while unprocessed.
      const eventId = await fixtures.recordEvent({
        kind: "account-created",
        customer,
        occurredAt: at.subtract({ minutes: 31 }),
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

describe.skipIf(!database)(
  "the automation engine's deliveries end to end",
  async () => {
    if (!database) return;
    /** Tuesday 20 October 2026, 10:00 in Prague. */
    const start = Temporal.Instant.from("2026-10-20T08:00:00Z");

    type TriggerTag = "ReservationBooked" | "AccountCreated";

    /** "When `trigger` happens, send." */
    const sendFlow = (trigger: TriggerTag) =>
      automationFlowFixture({
        trigger: { _tag: trigger },
        steps: [{ _tag: "Send", id: "send" }],
      });

    /** "When `trigger` happens, wait an hour, then send." */
    const waitThenSendFlow = (trigger: TriggerTag) =>
      automationFlowFixture({
        trigger: { _tag: trigger },
        steps: [
          {
            _tag: "Wait",
            id: "an-hour",
            wait: { _tag: "Duration", count: 1, unit: "hour" },
          },
          { _tag: "Send", id: "send" },
        ],
      });

    const emailOf = (customer: DotyposCustomerId) =>
      testEmailAddress(customer.slice(-48));
    const { pool } = database;
    const scenario = await makeAutomationEngineScenario({
      database,
      now: start,
      deploymentEnvironment: "development",
    });
    const { fixtures, kit, read } = scenario;

    // The Resend fake lives as long as the scenario; tests read their own share.
    const seen = { requests: 0, mailed: 0, subjects: 0 };
    const requests = () => scenario.resend.requests().slice(seen.requests);
    const mailed = () => scenario.resend.mailed().slice(seen.mailed);
    const subjects = () => scenario.resend.subjects().slice(seen.subjects);

    beforeEach(async () => {
      await scenario.prepare(start);
      seen.requests = scenario.resend.requests().length;
      seen.mailed = scenario.resend.mailed().length;
      seen.subjects = scenario.resend.subjects().length;
    });
    // Nothing a test leaves active can plan work in the next one.
    afterEach(async () => {
      scenario.resend.respondWith(() => "accept");
      scenario.resend.beforeEachRequest(() => Promise.resolve());
      for (const campaignId of kit.campaignIds) {
        const automation = await read.automation(campaignId);
        if (
          automation?.status === "active" ||
          automation?.status === "paused"
        ) {
          await scenario.lifecycle(
            (lifecycle) => lifecycle.archive(campaignId),
            start.add({ hours: 168 })
          );
        }
      }
    });
    afterAll(() => scenario.cleanup());

    /** A consenting customer whose visit, two days ahead, was booked at `at`. */
    const booking = async (label: string, at: Temporal.Instant) => {
      const customer = await fixtures.addCustomer(label);
      const reservation = await fixtures.book({
        label,
        customer,
        startsAt: start.add({ hours: 48 }),
        endsAt: start.add({ hours: 50 }),
      });
      await fixtures.recordEvent({
        kind: "reservation-booked",
        customer,
        occurredAt: at,
        reservationId: reservation,
      });
      return { customer, reservation };
    };

    /** A consenting customer whose account was created at `at`. */
    const signUp = async (
      label: string,
      at: Temporal.Instant,
      options: { readonly email?: string } = {}
    ) => {
      const customer = await fixtures.addCustomer(label, options);
      await fixtures.recordEvent({
        kind: "account-created",
        customer,
        occurredAt: at,
      });
      return customer;
    };

    const outcomes = async (campaignId: CampaignId) =>
      Object.fromEntries(
        (await read.runs(campaignId)).map((run) => [
          run.dotypos_customer_id,
          [run.status, run.outcome, run.outcome_reason],
        ])
      );

    const deliverUnits = async (campaignId: CampaignId) =>
      (await read.units(campaignId)).filter((unit) => unit.kind === "deliver");

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

    const timelineKinds = async (campaignId: CampaignId) =>
      Promise.all(
        (await read.runs(campaignId)).map(async (run) =>
          (await read.timeline(run.id)).map((entry) => entry.kind)
        )
      );

    /**
     * Plans at `at`, runs the intake unit that plans the deliver unit (D36),
     * then cuts the deliver unit's consumer off while its batch request is
     * with Resend, leaving it claimed with its batch persisted. The rest of
     * the queue (a sweep page) is processed.
     */
    const killDeliverDuringRequest = async (at: Temporal.Instant) => {
      const unitId = await scenario.killDuringRequest(at);
      await scenario.drain(at);
      return unitId;
    };

    describe("pre-submit check", () => {
      test.each([
        ["while waiting", false],
        ["while waiting through a pause and resume", true],
      ])(
        "a visit cancelled in Dotypos %s ends withdrawn at the deliver unit, with no email",
        async (_label, paused) => {
          const { campaignId } = await kit.seedActive(
            waitThenSendFlow("ReservationBooked"),
            { at: start }
          );
          // Booked on the tick, so a planner a minute late takes it in.
          const { reservation } = await booking(
            paused ? "cancel-paused" : "cancel-waiting",
            start
          );
          await scenario.tick(start.add({ minutes: 1 }));
          await scenario.tick(start.add({ minutes: 2 }));
          expect(await read.runs(campaignId)).toEqual([
            expect.objectContaining({ status: "active", phase: "waiting" }),
          ]);

          if (paused) {
            await scenario.lifecycle(
              (lifecycle) => lifecycle.pause(campaignId),
              start.add({ minutes: 10 })
            );
          }
          fixtures.cancelVisit(reservation);
          if (paused) {
            // The wait is overshot during the pause and proceeds on resume.
            await scenario.tick(start.add({ hours: 1, minutes: 30 }));
            expect(await read.runs(campaignId)).toEqual([
              expect.objectContaining({ status: "active", phase: "waiting" }),
            ]);
            await scenario.lifecycle(
              (lifecycle) => lifecycle.resume(campaignId),
              start.add({ hours: 2 })
            );
          }
          const progress = await settleRuns(
            campaignId,
            start.add({ hours: paused ? 2 : 1, minutes: 2 }),
            start.add({ hours: 4 })
          );

          expect(progress.settled).toBe(true);
          const [run] = await read.runs(campaignId);
          expect(run).toMatchObject({
            status: "ended",
            outcome: "withdrawn",
            send_id: null,
          });
          expect(await timelineKinds(campaignId)).toEqual([
            ["started", "waiting", "woke", "withdrawn"],
          ]);
          // The withdrawal was the deliver unit's verification.
          expect(await deliverUnits(campaignId)).toEqual([
            expect.objectContaining({ status: "done", send_id: null }),
          ]);
          expect(await read.sends(campaignId)).toEqual([]);
          expect(requests()).toEqual([]);
        }
      );

      test("a deliver unit killed after persisting replays its batch once without re-verifying", async () => {
        const { campaignId } = await kit.seedActive(
          sendFlow("ReservationBooked"),
          { at: start }
        );
        const { customer, reservation } = await booking("killed-replay", start);
        scenario.resend.respondWith(() => "accept-hang");
        await killDeliverDuringRequest(start.add({ minutes: 2 }));
        scenario.resend.respondWith(() => "accept");
        const [killed] = await deliverUnits(campaignId);
        expect(killed).toMatchObject({ status: "claimed" });
        expect(killed.send_id).not.toBeNull();
        const verified = scenario.dotypos.calls.getReservationsByIds;

        // Cancelled after the verification: the persisted batch goes out anyway.
        fixtures.cancelVisit(reservation);
        await scenario.tick(start.add({ minutes: 8 }));

        expect(await outcomes(campaignId)).toEqual({
          [customer]: ["ended", "sent", null],
        });
        expect(requests()).toEqual([
          {
            key: `email-campaign:${killed.send_id}:attempt-1:batch-0`,
            to: [emailOf(customer)],
          },
          {
            key: `email-campaign:${killed.send_id}:attempt-1:batch-0`,
            to: [emailOf(customer)],
          },
        ]);
        expect(mailed()).toEqual([emailOf(customer)]);
        expect(scenario.dotypos.calls.getReservationsByIds).toBe(verified);
        expect(await deliverUnits(campaignId)).toEqual([
          expect.objectContaining({ id: killed.id, status: "done" }),
        ]);
      });
    });

    describe("persisted delivery", () => {
      test.each<
        readonly [
          string,
          ResendFakeResponse,
          "none" | "pause" | "archive" | "lost-message",
        ]
      >([
        ["crashed before submitting", "hang", "none"],
        ["crashed after Resend accepted", "accept-hang", "none"],
        ["crashed after Resend accepted, then paused", "accept-hang", "pause"],
        ["crashed before submitting, then archived", "hang", "archive"],
        [
          "crashed after Resend accepted, whose requeued message was lost",
          "accept-hang",
          "lost-message",
        ],
      ])(
        "a deliver unit %s is reaped, replays batch 0 under its key, sends one email per recipient, ends its runs sent and only then frees its slot",
        async (_label, crash, then) => {
          const label = `persisted-${crash}-${then}`;
          const persisted = await kit.seedActive(
            sendFlow("ReservationBooked"),
            { at: start }
          );
          const first = await booking(`${label}-1`, start);
          const second = await booking(`${label}-2`, start);
          scenario.resend.respondWith(() => crash);
          // Killed a minute before the next tick, which takes the other
          // automation's event in while the claim still holds.
          const nextTick = start.add({ minutes: 15 });
          await killDeliverDuringRequest(nextTick.subtract({ minutes: 1 }));
          scenario.resend.respondWith(() => "accept");
          const [killed] = await deliverUnits(persisted.campaignId);
          expect(killed).toMatchObject({ status: "claimed" });
          expect(killed.send_id).not.toBeNull();
          const verified = scenario.dotypos.calls.getReservationsByIds;

          if (then === "pause") {
            await scenario.lifecycle(
              (lifecycle) => lifecycle.pause(persisted.campaignId),
              nextTick
            );
          }
          if (then === "archive") {
            await scenario.lifecycle(
              (lifecycle) => lifecycle.archive(persisted.campaignId),
              nextTick
            );
          }
          // Lifecycle operations never mark a unit with a persisted batch.
          expect(await deliverUnits(persisted.campaignId)).toEqual([
            expect.objectContaining({
              status: "claimed",
              cancel_requested_at: null,
            }),
          ]);

          // Another automation's run reaches its send step meanwhile; its
          // deliver unit waits for the slot the killed unit holds.
          const waiting = await kit.seedActive(sendFlow("AccountCreated"), {
            at: nextTick,
          });
          const other = await signUp(`${label}-o`, nextTick);
          await scenario.tick(nextTick);
          await scenario.tick(nextTick.add({ minutes: 1 }));
          expect(await deliverUnits(waiting.campaignId)).toEqual([
            expect.objectContaining({ status: "planned" }),
          ]);
          expect(await outcomes(waiting.campaignId)).toEqual({
            [other]: ["active", null, null],
          });
          expect(requests()).toHaveLength(1);

          // The claim expires (330 s); the reaper requeues the unit whatever
          // the automation's status.
          if (then === "lost-message") {
            await scenario.plan(nextTick.add({ minutes: 5 }));
            scenario.queue.dropPending();
            expect(requests()).toHaveLength(1);
            expect(await deliverUnits(waiting.campaignId)).toEqual([
              expect.objectContaining({ status: "planned" }),
            ]);
            await scenario.tick(nextTick.add({ minutes: 16 }));
          } else {
            await scenario.tick(nextTick.add({ minutes: 5 }));
          }

          expect(await outcomes(persisted.campaignId)).toEqual({
            [first.customer]: ["ended", "sent", null],
            [second.customer]: ["ended", "sent", null],
          });
          const killedKey = `email-campaign:${killed.send_id}:attempt-1:batch-0`;
          const keys = requests().map(({ key }) => key);
          expect(keys.filter((key) => key === killedKey)).toHaveLength(2);
          // One email per recipient, whether or not Resend had accepted it.
          expect(mailed().sort()).toEqual(
            [first.customer, second.customer, other].map(emailOf).sort()
          );
          expect(scenario.dotypos.calls.getReservationsByIds).toBe(verified);
          expect(await deliverUnits(persisted.campaignId)).toEqual([
            expect.objectContaining({ id: killed.id, status: "done" }),
          ]);
          // Its settlement handed the slot to the waiting unit, whose batch
          // follows the replay.
          expect(keys.at(-2)).toBe(killedKey);
          expect(requests().at(-1)!.to).toEqual([emailOf(other)]);
          expect(await outcomes(waiting.campaignId)).toEqual({
            [other]: ["ended", "sent", null],
          });
        }
      );
    });

    describe("deliver units and the deliver slot", () => {
      test("300 send-ready runs go out in deliver units of at most 100, never two in flight", async () => {
        const { campaignId } = await kit.seedActive(
          sendFlow("AccountCreated"),
          { at: start }
        );
        const customers = await Promise.all(
          Array.from({ length: 300 }, (_, index) =>
            signUp(`bulk-${index}`, start)
          )
        );
        const inFlight: number[] = [];
        scenario.resend.beforeEachRequest(async () => {
          const { rows } = await pool.query<{ count: number }>(
            "select count(*)::int as count from email_campaign_automation_work_units where kind = 'deliver' and status in ('enqueued', 'claimed')"
          );
          inFlight.push(rows[0]!.count);
        });
        const at = start.add({ minutes: 1 });
        // Intake starts the runs and plans their deliver units (D36).
        await scenario.planUntilQueued(at, "deliver");
        expect(
          (await read.runs(campaignId)).filter(
            (run) => run.status === "active" && run.phase === "ready"
          )
        ).toHaveLength(300);
        // Each intake unit plans deliver units for the runs it started; the
        // deliver slot lets one of them in flight.
        const planned = await deliverUnits(campaignId);
        expect(planned.length).toBeGreaterThanOrEqual(3);
        expect(
          planned.filter((unit) => unit.status === "enqueued")
        ).toHaveLength(1);
        expect(
          planned.every((unit) => ["enqueued", "planned"].includes(unit.status))
        ).toBe(true);
        await scenario.drain(at);

        expect(inFlight).toEqual(planned.map(() => 1));
        const units = await deliverUnits(campaignId);
        expect(units.every((unit) => unit.status === "done")).toBe(true);
        const batchSizes = requests().map(({ to }) => to.length);
        expect(batchSizes.every((size) => size <= 100)).toBe(true);
        expect(batchSizes.reduce((total, size) => total + size, 0)).toBe(300);
        expect(mailed().sort()).toEqual(customers.map(emailOf).sort());
        const runs = await read.runs(campaignId);
        expect(
          runs.every((run) => run.status === "ended" && run.outcome === "sent")
        ).toBe(true);
      });

      test("a non-test recipient is skipped outside-test-domain in development, ending its run skipped", async () => {
        const { campaignId } = await kit.seedActive(
          sendFlow("AccountCreated"),
          { at: start }
        );
        const insider = await signUp("d25-test", start.add({ minutes: 1 }));
        const outsider = await signUp(
          "d25-outside",
          start.add({ minutes: 1 }),
          {
            email: resendSimulatorAddress(
              "delivered",
              "automation-engine-outsider"
            ),
          }
        );

        const progress = await settleRuns(
          campaignId,
          start.add({ minutes: 1 }),
          start.add({ hours: 1 })
        );

        expect(progress.settled).toBe(true);
        expect(await outcomes(campaignId)).toEqual({
          [insider]: ["ended", "sent", null],
          [outsider]: ["ended", "skipped", "outside-test-domain"],
        });
        const recipients = await read.recipients(campaignId);
        expect(
          Object.fromEntries(
            recipients.map((recipient) => [
              recipient.dotypos_customer_id,
              [recipient.status, recipient.skip_reason],
            ])
          )
        ).toEqual({
          [insider]: ["sent", null],
          [outsider]: ["skipped", "outside-test-domain"],
        });
        expect(mailed()).toEqual([emailOf(insider)]);
      });

      test("an existing customer's account-created event recorded after activation starts no run, while a sign-up's does", async () => {
        const { campaignId } = await kit.seedActive(
          sendFlow("AccountCreated"),
          { at: start }
        );
        const newcomer = await signUp("d37-signup", start.add({ minutes: 1 }));
        // A deployment whose capture reconciler predates D37 records the
        // event once a legacy account's owner signs in.
        const existing = await fixtures.addCustomer("d37-legacy");
        const legacyEvent = await fixtures.recordEvent({
          kind: "account-created",
          customer: existing,
          occurredAt: start.add({ minutes: 1 }),
          legacy: true,
        });

        const progress = await settleRuns(
          campaignId,
          start.add({ minutes: 1 }),
          start.add({ hours: 1 })
        );

        expect(progress.settled).toBe(true);
        expect(await outcomes(campaignId)).toEqual({
          [newcomer]: ["ended", "sent", null],
        });
        const [event] = await read.events([legacyEvent]);
        expect(event.automation_processed_at).not.toBeNull();
        expect(event.automation_unit_id).toBeNull();
        const { rows: receipts } = await pool.query(
          "select 1 from email_campaign_automation_trigger_receipts where customer_event_id = $1",
          [legacyEvent]
        );
        expect(receipts).toEqual([]);
        expect(mailed()).toEqual([emailOf(newcomer)]);
      });

      test("an intake unit that took in an account-created event before its account became legacy starts no run", async () => {
        const { campaignId } = await kit.seedActive(
          sendFlow("AccountCreated"),
          { at: start }
        );
        const existing = await fixtures.addCustomer("d37-owned");
        const eventId = await fixtures.recordEvent({
          kind: "account-created",
          customer: existing,
          occurredAt: start.add({ minutes: 1 }),
        });
        const tick = start.add({ minutes: 15 });
        await scenario.plan(tick);
        const [owned] = await read.events([eventId]);
        expect(owned.automation_unit_id).not.toBeNull();
        // The migration marks the account legacy while the unit is queued.
        await pool.query(
          "update customer_accounts set legacy = true where id = $1",
          [owned.customer_account_id]
        );

        await scenario.drain(tick);

        expect(await read.runs(campaignId)).toEqual([]);
        const [event] = await read.events([eventId]);
        expect(event.automation_processed_at).not.toBeNull();
        const { rows: receipts } = await pool.query(
          "select 1 from email_campaign_automation_trigger_receipts where customer_event_id = $1",
          [eventId]
        );
        expect(receipts).toEqual([]);
        expect(mailed()).toEqual([]);
      });
    });

    describe("version-pinned content", () => {
      /** The campaign's working content, with `subject` in Czech. */
      const writeContent = (campaignId: CampaignId, subject: string) => {
        const content = campaignContentFixture(subject);
        return pool.query(
          "update email_campaigns set content = $2 where id = $1",
          [
            campaignId,
            JSON.stringify({
              "cs-CZ": { ...content["cs-CZ"], subject },
            }),
          ]
        );
      };

      /** Activates the current draft through a completed dry run of it. */
      const activate = async (campaignId: CampaignId, at: Temporal.Instant) => {
        const previewId = await kit.seedPreview(campaignId, {
          status: "completed",
        });
        return scenario.lifecycle(
          (lifecycle) =>
            lifecycle.activate({ campaignId, previewId, activatedBy: null }),
          at
        );
      };

      test("a v1 run sends v1 content after v2 is activated, and a run started after v2 sends v2 content", async () => {
        const flow: AutomationFlowType = waitThenSendFlow("AccountCreated");
        const { campaignId } = await kit.seedDraft({ flow });
        await writeContent(campaignId, "Verze 1");
        const v1 = await activate(campaignId, start);
        const early = await signUp("version-early", start.add({ minutes: 1 }));
        await scenario.tick(start.add({ minutes: 1 }));
        await scenario.tick(start.add({ minutes: 2 }));

        await writeContent(campaignId, "Verze 2");
        const v2 = await activate(campaignId, start.add({ minutes: 10 }));
        expect([v1.versionNumber, v2.versionNumber]).toEqual([1, 2]);
        // On the next tick, so its wait ends a tick after the early run's.
        const late = await signUp("version-late", start.add({ minutes: 16 }));

        const progress = await settleRuns(
          campaignId,
          start.add({ minutes: 16 }),
          start.add({ hours: 3 })
        );

        expect(progress.settled).toBe(true);
        const runs = new Map(
          (await read.runs(campaignId)).map((run) => [
            run.dotypos_customer_id,
            run,
          ])
        );
        const { rows: versions } = await pool.query<{
          id: string;
          version_number: number;
        }>(
          "select id, version_number from email_campaign_automation_versions where campaign_id = $1",
          [campaignId]
        );
        const versionNumbers = new Map(
          versions.map((version) => [version.id, version.version_number])
        );
        expect(versionNumbers.get(runs.get(early).version_id)).toBe(1);
        expect(versionNumbers.get(runs.get(late).version_id)).toBe(2);
        expect([runs.get(early).outcome, runs.get(late).outcome]).toEqual([
          "sent",
          "sent",
        ]);
        expect(subjects()).toEqual([
          { to: emailOf(early), subject: "Verze 1" },
          { to: emailOf(late), subject: "Verze 2" },
        ]);
      });
    });
  }
);

describe.skipIf(!database)(
  "the automation engine around pause, resume and archive",
  async () => {
    if (!database) return;
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

        // Intake starts the runs and plans their deliver units (D36).
        const plannedAt = start;
        await engine.planUntilQueued(plannedAt, "deliver");
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

        // Intake starts the run and plans its condition unit (D36).
        const plannedAt = start;
        await scenario.planUntilQueued(plannedAt, "condition");
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
        // On the next tick, so its hour ends a tick after the first run's.
        const deliverPlanned = await bookingCustomer(
          "archive-planned",
          start.add({ minutes: 15 })
        );
        await scenario.tick(start.add({ minutes: 15 }));
        await scenario.tick(start.add({ minutes: 16 }));
        const waiting = await bookingCustomer(
          "archive-waiting",
          start.add({ minutes: 30 })
        );
        await scenario.tick(start.add({ minutes: 30 }));
        await scenario.tick(start.add({ minutes: 31 }));

        // The first run's batch is persisted and with Resend when its consumer
        // is cut off: the unit stays claimed, holding the deliver slot. Its
        // consumer claims it late in the tick, so the claim outlasts the next.
        const sendingDue = start.add({ hours: 1 });
        expect(iso((await runOf(campaignId, sending.customer)).due_at)).toBe(
          sendingDue.toString()
        );
        await scenario.plan(sendingDue);
        const [persisted] = await unitsOf(campaignId, "deliver");
        takeMessage(persisted.id);
        scenario.resend.respondWith(() => "accept-hang");
        const reached = scenario.resend.nextRequest();
        const claimedAt = sendingDue.add({ minutes: 14 });
        const consumer = scenario.start(persisted.id, claimedAt);
        const cutOff = consumer.done.then(
          () => "finished",
          () => "cut off"
        );
        await reached;
        await consumer.interrupt();
        expect(await cutOff).toBe("cut off");
        scenario.resend.respondWith(() => "accept");
        await scenario.drain(claimedAt);

        // The second run reaches its send step while the slot is held.
        const plannedDue = start.add({ hours: 1, minutes: 15 });
        await scenario.tick(plannedDue);
        const units = await unitsOf(campaignId, "deliver");
        expect(units.map((unit) => unit.status)).toEqual([
          "claimed",
          "planned",
        ]);
        expect(await runOf(campaignId, sending.customer)).toMatchObject({
          status: "sending",
        });

        const archivedAt = start.add({ hours: 1, minutes: 16 });
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
        // Its event is taken in on the tick after it occurred.
        const progress = await scenario.runUntil({
          from: archivedAt.add({ minutes: 1 }),
          until: archivedAt.add({ hours: 1 }),
          settled: async () =>
            (await runOf(campaignId, sending.customer)).status === "ended" &&
            (await read.events([late.event]))[0]?.automation_processed_at !==
              null,
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

describe.skipIf(!database)(
  "the automation engine's schedules end to end",
  async () => {
    if (!database) return;
    /** Tuesday 13 October 2026, 08:00 in Prague. */
    const start = Temporal.Instant.from("2026-10-13T06:00:00Z");

    /** Story 2's Mondays at 10:00 in Prague (summer time ends on 25 October). */
    const mondays = [
      Temporal.Instant.from("2026-10-19T08:00:00Z"),
      Temporal.Instant.from("2026-10-26T09:00:00Z"),
      Temporal.Instant.from("2026-11-02T09:00:00Z"),
      Temporal.Instant.from("2026-11-09T09:00:00Z"),
    ] as const;
    const [firstMonday, secondMonday, thirdMonday, fourthMonday] = mondays;

    /** Story 2 moved to Tuesdays at 10:00 in Prague, as a second version. */
    const tuesdayOfferFlow = automationFlowFixture({
      ...comeBackOfferFlow,
      trigger: {
        _tag: "Schedule",
        calendar: { hours: [10], weekdays: ["tuesday"] },
      },
    });

    const iso = (value: Date | string | null | undefined) =>
      databaseInstant(value)?.toString() ?? null;

    const scenario = await makeAutomationEngineScenario({
      database,
      now: start,
    });
    const { fixtures, kit, read } = scenario;

    beforeEach(() => scenario.prepare(start));
    /**
     * Every schedule's pool is every consenting customer, so each test
     * archives its automations and withdraws its customers' consents.
     */
    afterEach(async () => {
      scenario.dotypos.onRequest(undefined);
      for (const campaignId of kit.campaignIds) {
        await scenario.lifecycle(
          (l) => l.archive(campaignId),
          start.add({ hours: 60 * 24 })
        );
      }
      await database.pool.query(
        "update customer_marketing_consents set withdrawn_at = $2 where dotypos_customer_id = any($1) and withdrawn_at is null",
        [fixtures.created.consents, start.toString()]
      );
      scenario.dotypos.setCustomers([]);
      scenario.dotypos.setReservations([]);
    });
    afterAll(() => scenario.cleanup());

    /** Story 2 activated at `at` with "Lapsed regulars" as its entry set. */
    const activateComeBackOffer = (
      input: { readonly audienceFilter?: typeof lapsedRegularsFilter } = {}
    ) =>
      kit.seedActive(comeBackOfferFlow, {
        at: start,
        audienceFilter: input.audienceFilter ?? lapsedRegularsFilter,
      });

    /** A visit of one day, 09:00–17:00 in Prague summer time. */
    const visit = (customer: DotyposCustomerId, label: string, day: string) =>
      fixtures.book({
        label,
        customer,
        startsAt: Temporal.Instant.from(`${day}T07:00:00Z`),
        endsAt: Temporal.Instant.from(`${day}T15:00:00Z`),
      });

    /** A consenting customer with two summer visits and none since: a lapsed regular. */
    const lapsedRegular = async (label: string) => {
      const customer = await fixtures.addCustomer(label);
      await visit(customer, `${label}-july`, "2026-07-06");
      await visit(customer, `${label}-august`, "2026-08-03");
      return customer;
    };

    const emailOf = (customer: DotyposCustomerId) =>
      testEmailAddress(customer.slice(-48));

    const mailedTo = (customer: DotyposCustomerId) =>
      scenario.resend.mailed().filter((to) => to === emailOf(customer)).length;

    const versionIds = async (campaignId: CampaignId) =>
      new Map(
        (
          await database.pool.query<{ id: string; version_number: number }>(
            "select id, version_number from email_campaign_automation_versions where campaign_id = $1",
            [campaignId]
          )
        ).rows.map((row) => [row.version_number, row.id])
      );

    const fireSummary = async (campaignId: CampaignId) =>
      (await read.fires(campaignId)).map((fire) => ({
        fireAt: iso(fire.fire_at),
        status: fire.status,
        versionId: fire.version_id,
        complete: fire.chunks_done === fire.chunks_total,
      }));

    const receiptSummary = async (campaignId: CampaignId) =>
      (await read.receipts(campaignId))
        .map((receipt) => ({
          key: receipt.dedup_key as string,
          disposition: receipt.disposition,
          versionId: receipt.version_id,
        }))
        .sort((a, b) => a.key.localeCompare(b.key));

    const allEnded = async (...campaignIds: CampaignId[]) => {
      for (const campaignId of campaignIds) {
        const runs = await read.runs(campaignId);
        if (runs.length === 0 || runs.some((run) => run.status !== "ended")) {
          return false;
        }
      }
      return true;
    };

    const firesEntered = async (campaignId: CampaignId, count: number) => {
      const fires = await read.fires(campaignId);
      return (
        fires.length >= count &&
        fires.every((fire) => fire.status === "entered")
      );
    };

    describe("story 2: weekly come-back offer", () => {
      test("a schedule fires once per period and a lapsed regular gets the offer at each fire", async () => {
        const { campaignId } = await activateComeBackOffer();
        const versions = await versionIds(campaignId);
        const regular = await lapsedRegular("period-regular");
        const recent = await lapsedRegular("period-recent");
        await visit(recent, "period-recent-october", "2026-10-10");

        const progress = await scenario.runUntil({
          from: start,
          until: secondMonday.add({ hours: 1 }),
          sameInstant: true,
          settled: async () =>
            (await firesEntered(campaignId, 2)) &&
            (await read.runs(campaignId)).length === 2 &&
            (await allEnded(campaignId)),
        });
        expect(progress.settled).toBe(true);
        // Later minutes of the same period fire nothing more.
        for (const at of [
          secondMonday.add({ minutes: 1 }),
          secondMonday.add({ hours: 6 }),
          thirdMonday.subtract({ minutes: 1 }),
        ]) {
          await scenario.tick(at);
        }

        expect(await fireSummary(campaignId)).toEqual([
          {
            fireAt: firstMonday.toString(),
            status: "entered",
            versionId: versions.get(1),
            complete: true,
          },
          {
            fireAt: secondMonday.toString(),
            status: "entered",
            versionId: versions.get(1),
            complete: true,
          },
        ]);
        expect(iso((await read.automation(campaignId)).next_fire_at)).toBe(
          thirdMonday.toString()
        );
        const runs = await read.runs(campaignId);
        expect(
          runs.map((run) => ({
            customer: run.dotypos_customer_id,
            triggerKind: run.trigger_kind,
            triggerAt: iso(run.trigger_at),
            outcome: run.outcome,
          }))
        ).toEqual([
          {
            customer: regular,
            triggerKind: "schedule",
            triggerAt: firstMonday.toString(),
            outcome: "sent",
          },
          {
            customer: regular,
            triggerKind: "schedule",
            triggerAt: secondMonday.toString(),
            outcome: "condition-failed",
          },
        ]);
        // The chain fire → chunk → condition → deliver completes at the fire.
        expect(iso(runs[0].ended_at)).toBe(firstMonday.toString());
        expect(mailedTo(regular)).toBe(1);
        expect(mailedTo(recent)).toBe(0);
      });

      test("three missed fires replay in order, one entering at a time, each run triggered at its own fire", async () => {
        const { campaignId } = await activateComeBackOffer();
        const versions = await versionIds(campaignId);
        const early = await lapsedRegular("replay-early");
        // The engine was down from activation until Tuesday 3 November.
        const back = Temporal.Instant.from("2026-11-03T11:00:00Z");

        await scenario.plan(back);
        expect(await fireSummary(campaignId)).toEqual([
          {
            fireAt: firstMonday.toString(),
            status: "entering",
            versionId: versions.get(1),
            complete: false,
          },
        ]);
        // Each fire's pool is fixed when the fire is created: a customer who
        // consents meanwhile joins the next fire, not the entering one.
        const second = await lapsedRegular("replay-second");
        let third: DotyposCustomerId | undefined;
        const snapshots: string[][] = [[`${firstMonday} entering`]];
        for (
          let next = scenario.processNext(back);
          next !== undefined;
          next = scenario.processNext(back)
        ) {
          const delivery = await next;
          expect(delivery.outcome).not.toBe("redelivered");
          const fires = await read.fires(campaignId);
          const entering = fires.filter((fire) => fire.status === "entering");
          expect(entering.length).toBeLessThanOrEqual(1);
          // Every fire before the entering one has entered.
          expect(
            fires
              .filter((fire) => fire.status !== "entering")
              .every((fire) => fire.status === "entered")
          ).toBe(true);
          const snapshot = fires.map(
            (fire) => `${iso(fire.fire_at)} ${fire.status}`
          );
          if (snapshot.join() !== snapshots.at(-1)?.join()) {
            snapshots.push(snapshot);
          }
          if (
            third === undefined &&
            entering.length === 1 &&
            iso(entering[0].fire_at) === secondMonday.toString()
          ) {
            third = await lapsedRegular("replay-third");
          }
        }

        // Each fire's last chunk entered it and created the next one at once.
        expect(snapshots).toEqual([
          [`${firstMonday} entering`],
          [`${firstMonday} entered`, `${secondMonday} entering`],
          [
            `${firstMonday} entered`,
            `${secondMonday} entered`,
            `${thirdMonday} entering`,
          ],
          [
            `${firstMonday} entered`,
            `${secondMonday} entered`,
            `${thirdMonday} entered`,
          ],
        ]);
        expect(await fireSummary(campaignId)).toEqual(
          [firstMonday, secondMonday, thirdMonday].map((fireAt) => ({
            fireAt: fireAt.toString(),
            status: "entered",
            versionId: versions.get(1),
            complete: true,
          }))
        );
        expect(iso((await read.automation(campaignId)).next_fire_at)).toBe(
          fourthMonday.toString()
        );
        expect(third).toBeDefined();
        expect(
          (await receiptSummary(campaignId)).map(({ key, disposition }) => ({
            key,
            disposition,
          }))
        ).toEqual(
          [
            {
              key: scheduleDedupKey(firstMonday, early),
              disposition: "started",
            },
            {
              key: scheduleDedupKey(secondMonday, early),
              disposition: "already-active",
            },
            // The first run sent within the fire that entered it (D36), so the
            // third fire starts the early customer again.
            {
              key: scheduleDedupKey(thirdMonday, early),
              disposition: "started",
            },
            {
              key: scheduleDedupKey(secondMonday, second),
              disposition: "started",
            },
            {
              key: scheduleDedupKey(thirdMonday, second),
              disposition: "already-active",
            },
            {
              key: scheduleDedupKey(thirdMonday, third!),
              disposition: "started",
            },
          ].sort((a, b) => a.key.localeCompare(b.key))
        );
        const progress = await scenario.runUntil({
          from: back,
          until: back.add({ hours: 1 }),
          sameInstant: true,
          settled: () => allEnded(campaignId),
        });
        expect(progress.settled).toBe(true);
        // Each run is triggered at its own fire; the early customer's second
        // run finds the offer sent at the first fire.
        expect(
          (await read.runs(campaignId))
            .map((run) => [
              run.dotypos_customer_id,
              iso(run.trigger_at),
              run.outcome,
            ])
            .sort()
        ).toEqual(
          [
            [early, firstMonday.toString(), "sent"],
            [early, thirdMonday.toString(), "condition-failed"],
            [second, secondMonday.toString(), "sent"],
            [third!, thirdMonday.toString(), "sent"],
          ].sort()
        );
        for (const customer of [early, second, third!]) {
          expect(mailedTo(customer)).toBe(1);
        }
      });

      test("a fire whose first step is a Calendar wait that holds sends on the fire's tick", async () => {
        const { campaignId } = await kit.seedActive(
          automationFlowFixture({
            ...comeBackOfferFlow,
            steps: [
              {
                _tag: "Wait",
                id: "ten-oclock",
                wait: { _tag: "Calendar", expression: { hours: [10] } },
              },
              { _tag: "Send", id: "send" },
            ],
          }),
          { at: start, audienceFilter: lapsedRegularsFilter }
        );
        const customer = await lapsedRegular("holding-wait");

        const progress = await scenario.runUntil({
          from: firstMonday,
          until: firstMonday.add({ hours: 1 }),
          onTicks: true,
          settled: () => allEnded(campaignId),
        });

        expect(progress.settled).toBe(true);
        const [run] = await read.runs(campaignId);
        expect(run).toMatchObject({ status: "ended", outcome: "sent" });
        // The fire chunk entered the wait at 10:00, and it held.
        expect(iso(run.ended_at)).toBe(firstMonday.toString());
        expect(
          (await read.timeline(run.id)).map((entry) => entry.kind)
        ).toEqual(["started", "woke", "send-queued", "sent"]);
        expect(mailedTo(customer)).toBe(1);
      });

      test("a customer sent the offer at one fire isn't offered it again at the next: condition-failed", async () => {
        const { campaignId } = await activateComeBackOffer();
        const regular = await lapsedRegular("again-regular");

        const first = await scenario.runUntil({
          from: start,
          until: firstMonday.add({ hours: 1 }),
          sameInstant: true,
          settled: () => allEnded(campaignId),
        });
        expect(first.settled).toBe(true);
        expect(mailedTo(regular)).toBe(1);
        // A lapsed regular who consents after the first fire gets the second one.
        const newcomer = await lapsedRegular("again-newcomer");

        const second = await scenario.runUntil({
          from: firstMonday.add({ hours: 1 }),
          until: secondMonday.add({ hours: 1 }),
          sameInstant: true,
          settled: async () =>
            (await read.runs(campaignId)).length === 3 &&
            (await allEnded(campaignId)),
        });
        expect(second.settled).toBe(true);

        const runs = await read.runs(campaignId);
        const again = runs.find(
          (run) =>
            run.dotypos_customer_id === regular &&
            iso(run.trigger_at) === secondMonday.toString()
        );
        expect(again).toMatchObject({
          status: "ended",
          outcome: "condition-failed",
        });
        const timeline = await read.timeline(again.id);
        expect(timeline.map((entry) => entry.kind)).toEqual([
          "started",
          "condition-failed",
        ]);
        expect(timeline.at(-1)).toMatchObject({
          step_id: "not-offered-recently",
          detail: { failedConditions: [0] },
        });
        expect(
          runs.find((run) => run.dotypos_customer_id === newcomer)
        ).toMatchObject({ outcome: "sent" });
        expect(mailedTo(regular)).toBe(1);
        expect(mailedTo(newcomer)).toBe(1);
      });

      test("a failing chunk blocks only its own automation's fires; another automation keeps firing", async () => {
        // Lapsed regulars reads visits; the other automation's entry set
        // (everyone) reads profiles only, so failing visit reads fails only
        // the first automation's chunks.
        const blocked = await activateComeBackOffer();
        const other = await kit.seedActive(comeBackOfferFlow, { at: start });
        const regular = await lapsedRegular("blocked-regular");
        scenario.dotypos.onRequest(({ method }) =>
          method === "listReservationsPage" ||
          method === "listReservations" ||
          method === "getReservationsByIds"
            ? Effect.fail(
                new DotyposUnavailable({
                  operation: method,
                  reason: "server",
                  httpStatus: 503,
                })
              )
            : Effect.void
        );

        const firstWeek = await scenario.runUntil({
          from: start,
          until: firstMonday.add({ minutes: 30 }),
          sameInstant: true,
          settled: () => allEnded(other.campaignId),
        });
        expect(firstWeek.settled).toBe(true);
        const [chunk] = (await read.units(blocked.campaignId)).filter(
          (unit) => unit.kind === "fire-chunk"
        );
        expect(chunk).toMatchObject({ status: "enqueued" });
        expect(chunk.attempts).toBeGreaterThanOrEqual(1);
        expect(
          scenario.delayed().map(({ message }) => message.unitId)
        ).toContain(chunk.id);

        // A week on, the other automation fires again; the blocked one waits.
        const secondWeek = await scenario.runUntil({
          from: secondMonday,
          until: secondMonday.add({ minutes: 30 }),
          sameInstant: true,
          settled: async () =>
            (await read.runs(other.campaignId)).length === 2 &&
            (await allEnded(other.campaignId)),
        });
        expect(secondWeek.settled).toBe(true);
        expect(
          (await fireSummary(other.campaignId)).map(({ fireAt, status }) => [
            fireAt,
            status,
          ])
        ).toEqual([
          [firstMonday.toString(), "entered"],
          [secondMonday.toString(), "entered"],
        ]);
        expect(
          (await fireSummary(blocked.campaignId)).map(({ fireAt, status }) => [
            fireAt,
            status,
          ])
        ).toEqual([[firstMonday.toString(), "entering"]]);
        expect(
          iso((await read.automation(blocked.campaignId)).next_fire_at)
        ).toBe(firstMonday.toString());
        expect(await read.runs(blocked.campaignId)).toEqual([]);
        expect(mailedTo(regular)).toBe(1);

        // Once visits read again, the blocked fire enters and the missed one follows.
        scenario.dotypos.onRequest(undefined);
        const recovered = await scenario.runUntil({
          from: secondMonday.add({ minutes: 30 }),
          until: secondMonday.add({ hours: 2 }),
          sameInstant: true,
          settled: async () =>
            (await firesEntered(blocked.campaignId, 2)) &&
            (await allEnded(blocked.campaignId)),
        });
        expect(recovered.settled).toBe(true);
        expect(
          (await fireSummary(blocked.campaignId)).map(({ fireAt, status }) => [
            fireAt,
            status,
          ])
        ).toEqual([
          [firstMonday.toString(), "entered"],
          [secondMonday.toString(), "entered"],
        ]);
        const [run] = await read.runs(blocked.campaignId);
        expect(iso(run.trigger_at)).toBe(firstMonday.toString());
        expect(run.outcome).toBe("sent");
        expect(mailedTo(regular)).toBe(2);
      });

      test("a version activated mid-backlog: fires before its activation use v1, later ones v2's calendar and version", async () => {
        const { campaignId } = await activateComeBackOffer();
        const regular = await lapsedRegular("midway-regular");
        // Wednesday 28 October, with the 19 and 26 October fires still due.
        const activatedAt = Temporal.Instant.from("2026-10-28T11:00:00Z");
        await kit.run(
          kit.lifecycle((l) =>
            l.updateFlow({ campaignId, flow: tuesdayOfferFlow })
          ),
          activatedAt
        );
        const previewId = await kit.seedPreview(campaignId, {
          status: "completed",
        });
        await kit.run(
          kit.lifecycle((l) =>
            l.activate({ campaignId, previewId, activatedBy: null })
          ),
          activatedAt
        );
        const versions = await versionIds(campaignId);
        expect(versions.size).toBe(2);
        expect(iso((await read.automation(campaignId)).next_fire_at)).toBe(
          firstMonday.toString()
        );

        const firstTuesday = Temporal.Instant.from("2026-11-03T09:00:00Z");
        const back = Temporal.Instant.from("2026-11-04T11:00:00Z");
        const progress = await scenario.runUntil({
          from: back,
          until: back.add({ hours: 1 }),
          sameInstant: true,
          settled: async () =>
            (await firesEntered(campaignId, 3)) && (await allEnded(campaignId)),
        });
        expect(progress.settled).toBe(true);

        // Monday 2 November never fires: v2 replaced v1's calendar on 28 October.
        expect(await fireSummary(campaignId)).toEqual([
          {
            fireAt: firstMonday.toString(),
            status: "entered",
            versionId: versions.get(1),
            complete: true,
          },
          {
            fireAt: secondMonday.toString(),
            status: "entered",
            versionId: versions.get(1),
            complete: true,
          },
          {
            fireAt: firstTuesday.toString(),
            status: "entered",
            versionId: versions.get(2),
            complete: true,
          },
        ]);
        expect(iso((await read.automation(campaignId)).next_fire_at)).toBe(
          "2026-11-10T09:00:00Z"
        );
        expect(await receiptSummary(campaignId)).toEqual([
          {
            key: scheduleDedupKey(firstMonday, regular),
            disposition: "started",
            versionId: versions.get(1),
          },
          {
            key: scheduleDedupKey(secondMonday, regular),
            disposition: "already-active",
            versionId: versions.get(1),
          },
          // The first run sent within the fire that entered it (D36), so
          // the next fire after it starts v2's run, whose condition ends it.
          {
            key: scheduleDedupKey(firstTuesday, regular),
            disposition: "started",
            versionId: versions.get(2),
          },
        ]);
        expect(
          (await read.runs(campaignId)).map((run) => ({
            versionId: run.version_id,
            triggerAt: iso(run.trigger_at),
            outcome: run.outcome,
          }))
        ).toEqual([
          {
            versionId: versions.get(1),
            triggerAt: firstMonday.toString(),
            outcome: "sent",
          },
          {
            versionId: versions.get(2),
            triggerAt: firstTuesday.toString(),
            outcome: "condition-failed",
          },
        ]);
      });
    });

    describe("Dotypos down", () => {
      test("units are redelivered every 60 s; after 24 h a condition run ends failed / evaluation-unavailable and an event gets a failed receipt, while a fire waits and enters once Dotypos recovers", async () => {
        const review = await kit.seedActive(reviewRequestFlow, { at: start });
        const offer = await activateComeBackOffer();
        const regular = await lapsedRegular("outage-regular");
        const waiting = await fixtures.addCustomer("outage-waiting");
        const waitingVisit = await visit(
          waiting,
          "outage-waiting-visit",
          "2026-10-12"
        );
        const late = await fixtures.addCustomer("outage-late");
        const lateVisit = await visit(late, "outage-late-visit", "2026-10-12");

        // Monday 19 October, an hour before the offer fires: a finished
        // visit enters the review request, whose intake queues its condition
        // unit (D36).
        const before = firstMonday.subtract({ hours: 1 });
        await fixtures.recordEvent({
          kind: "reservation-finished",
          customer: waiting,
          reservationId: waitingVisit,
          occurredAt: before,
          recordedAt: before,
        });
        await scenario.planUntilQueued(before, "condition");
        const [conditionRun] = await read.runs(review.campaignId);
        expect(conditionRun).toMatchObject({
          status: "active",
          step_id: "second-visit-within-a-month",
          phase: "ready",
        });

        // Dotypos goes down; a second visit that finished on the hour is
        // recorded a minute later.
        scenario.dotypos.onRequest(({ method }) =>
          Effect.fail(
            new DotyposUnavailable({
              operation: method,
              reason: "server",
              httpStatus: 503,
            })
          )
        );
        const down = before.add({ minutes: 1 });
        const lateEvent = await fixtures.recordEvent({
          kind: "reservation-finished",
          customer: late,
          reservationId: lateVisit,
          occurredAt: before,
          recordedAt: down,
        });
        const failing = await scenario.tick(down);
        const failedKinds = async () =>
          new Map(
            (await read.units())
              .filter((unit) =>
                failing.deliveries.some(
                  (delivery) =>
                    delivery.unitId === unit.id &&
                    delivery.outcome === "redelivered"
                )
              )
              .map((unit) => [unit.kind as string, unit])
          );
        const failed = await failedKinds();
        expect([...failed.keys()]).toEqual(
          expect.arrayContaining(["intake", "condition"])
        );
        for (const unit of failed.values()) {
          expect(unit).toMatchObject({ status: "enqueued", attempts: 1 });
        }
        const failedIds = [...failed.values()].map((unit) => unit.id);
        expect(
          scenario
            .delayed()
            .filter(({ message }) => failedIds.includes(message.unitId))
            .map(({ availableAt }) => availableAt.toString())
        ).toEqual(failedIds.map(() => down.add({ seconds: 60 }).toString()));

        // Not redelivered before 60 s, then redelivered and failing again.
        const early = await scenario.tick(down.add({ seconds: 59 }));
        expect(
          early.deliveries.filter((delivery) =>
            failedIds.includes(delivery.unitId)
          )
        ).toEqual([]);
        const retried = await scenario.tick(down.add({ seconds: 60 }));
        for (const unit of failed.values()) {
          expect(retried.deliveries).toContainEqual({
            unitId: unit.id,
            outcome: "redelivered",
          });
        }

        // The offer falls due and its chunk fails too.
        await scenario.tick(firstMonday);
        expect(
          (await fireSummary(offer.campaignId)).map(({ fireAt, status }) => [
            fireAt,
            status,
          ])
        ).toEqual([[firstMonday.toString(), "entering"]]);

        // 24 hours on, the condition run and the event give up; the fire waits.
        const dayLater = down.add({ hours: 24, minutes: 1 });
        await scenario.tick(dayLater);
        const [expiredRun] = await read.runs(review.campaignId);
        expect(expiredRun).toMatchObject({
          id: conditionRun.id,
          status: "ended",
          outcome: "failed",
          outcome_reason: "evaluation-unavailable",
        });
        expect(
          (await read.timeline(conditionRun.id)).map((entry) => entry.kind)
        ).toEqual(["started", "failed"]);
        expect(
          (await read.receipts(review.campaignId)).map((receipt) => ({
            customer: receipt.dotypos_customer_id,
            event: receipt.customer_event_id,
            disposition: receipt.disposition,
          }))
        ).toContainEqual({
          customer: late,
          event: lateEvent,
          disposition: "failed",
        });
        const [lateEventRow] = await read.events([lateEvent]);
        expect(lateEventRow.automation_processed_at).not.toBeNull();
        expect(await read.runs(review.campaignId)).toHaveLength(1);

        // Fires never expire: a week on, the first is still entering and the
        // second waits behind it.
        await scenario.tick(secondMonday);
        expect(
          (await fireSummary(offer.campaignId)).map(({ fireAt, status }) => [
            fireAt,
            status,
          ])
        ).toEqual([[firstMonday.toString(), "entering"]]);
        expect(
          iso((await read.automation(offer.campaignId)).next_fire_at)
        ).toBe(firstMonday.toString());
        const [chunk] = (await read.units(offer.campaignId)).filter(
          (unit) => unit.kind === "fire-chunk"
        );
        expect(chunk.status).toBe("enqueued");
        expect(chunk.attempts).toBeGreaterThanOrEqual(3);
        expect(await read.runs(offer.campaignId)).toEqual([]);

        // Dotypos recovers: the first fire enters and the second follows.
        scenario.dotypos.onRequest(undefined);
        const recovered = await scenario.runUntil({
          from: secondMonday.add({ minutes: 1 }),
          until: secondMonday.add({ hours: 1 }),
          sameInstant: true,
          settled: async () =>
            (await firesEntered(offer.campaignId, 2)) &&
            (await allEnded(offer.campaignId)),
        });
        expect(recovered.settled).toBe(true);
        expect(
          (await fireSummary(offer.campaignId)).map(({ fireAt, status }) => [
            fireAt,
            status,
          ])
        ).toEqual([
          [firstMonday.toString(), "entered"],
          [secondMonday.toString(), "entered"],
        ]);
        const [offered] = await read.runs(offer.campaignId);
        expect(offered).toMatchObject({
          dotypos_customer_id: regular,
          outcome: "sent",
        });
        expect(iso(offered.trigger_at)).toBe(firstMonday.toString());
        expect(mailedTo(regular)).toBe(1);
      });
    });
  }
);
