import "@/shared/testing/workspace-test-env";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { Effect, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
import {
  holdPostgresTransaction,
  waitForPostgresLockWaiter,
} from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { AudienceFilter } from "../../audience-filter";
import type { CampaignId } from "../../campaign-identifiers";
import type {
  AutomationVersionId,
  AutomationWorkUnitId,
} from "../automation-identifiers";
import { automationTickAtOrBefore } from "../automation-ticks";
import type { AutomationWorkUnitKind } from "../automation-work-units";
import {
  databaseInstant,
  makeAutomationEngineScenario,
} from "./automation-engine-scenario.test-utils";
import { AutomationLifecycle } from "./automation-lifecycle.service";
import {
  automationFlowFixture,
  bookedSendFlow,
} from "./automation-lifecycle.test-utils";
import { seedAutomationRun } from "./automation-steps.test-utils";
import type { AutomationUnitOutcome } from "./automation-unit-processor.service";
import { seedSendReadyRuns } from "./deliver.test-utils";

/**
 * The engine plans over whole tables, so the suite runs on a database of
 * its own.
 */
const database = await createWorkspacePostgresSuiteDatabase(
  "automation_engine_interleaving"
);
afterAll(() => database?.close());

/** Tuesday 13 October 2026, 08:00 in Prague: every automation activates then. */
const start = Temporal.Instant.from("2026-10-13T06:00:00Z");
/** When triggers occur and runs become ready. */
const occurredAt = start.add({ minutes: 1 });
/**
 * When units are planned and processed: two minutes into the tick after the
 * occurrence, the first that takes it in.
 */
const at = start.add({ minutes: 17 });
/** 10:00 in Prague that day, a schedule's first fire. */
const fireAt = Temporal.Instant.from("2026-10-13T08:00:00Z");

/** "Every day at 10:00, send." */
const scheduleFlow = automationFlowFixture({
  trigger: { _tag: "Schedule", calendar: { minutes: [0], hours: [10] } },
  steps: [{ _tag: "Send", id: "send" }],
});

const vipCustomers: AudienceFilter = {
  _tag: "Condition",
  attribute: "dotyposTags",
  operator: "anyOf",
  value: ["vip"],
};

/** "When a reservation is booked, send if the customer is tagged vip." */
const vipFlow = automationFlowFixture({
  trigger: { _tag: "ReservationBooked" },
  steps: [
    { _tag: "Condition", id: "vip", filter: vipCustomers },
    { _tag: "Send", id: "send" },
  ],
});

/**
 * The three orders of §5.4: the other side commits after the unit fetched
 * (`commit-between`), holds its lock while the unit's commit waits for it
 * (`lifecycle-holds`, same result), or waits for the unit's commit, which
 * took the shared lock first (`lock-wait`).
 */
const orders = ["commit-between", "lifecycle-holds", "lock-wait"] as const;
type Order = (typeof orders)[number];

/** A unit outcome, with a failed delivery (the queue redelivers it) as `redelivered`. */
const outcomeOf = (
  result: Result.Result<AutomationUnitOutcome, unknown>
): AutomationUnitOutcome | "redelivered" =>
  Result.isSuccess(result) ? result.success : "redelivered";

/**
 * Starts `promise` now and reports its failure only when the returned
 * function is awaited, so a racing operation can run in the background.
 */
const background = <A>(promise: Promise<A>) => {
  // Handled now; awaiting it later still rethrows.
  promise.catch(() => undefined);
  return () => promise;
};

describe.skipIf(!database)(
  "§5.4 interleavings of the engine with lifecycle operations",
  async () => {
    if (!database) return;
    const { db, pool } = database;
    // The sweep stays idle, so the only Dotypos requests are the units' own.
    const scenario = await makeAutomationEngineScenario({
      database,
      now: start,
      planning: ["intake", "timers", "conditions", "sends", "schedules"],
    });
    const { fixtures, kit, read } = scenario;
    /** Automations a test activated, archived after it. */
    const opened: CampaignId[] = [];

    beforeEach(async () => {
      await scenario.prepare(start);
      // Events an earlier suite left unprocessed would take slots.
      await pool.query(
        "update customer_events set automation_processed_at = $1 where automation_processed_at is null",
        [start.toString()]
      );
    });
    afterEach(async () => {
      for (const commit of [...openHolds]) await commit();
      // Later tests' planner runs and schedule pools see only their own
      // automations and customers.
      for (const campaignId of opened.splice(0)) {
        await scenario.lifecycle((l) => l.archive(campaignId), at);
      }
      await pool.query(
        "delete from customer_marketing_consents where dotypos_customer_id = any($1)",
        [fixtures.created.consents]
      );
      scenario.resend.respondWith(() => "accept");
      scenario.resend.beforeEachRequest(() => Promise.resolve());
      scenario.dotypos.onRequest(undefined);
    });
    afterAll(() => scenario.cleanup());

    // -- Lock injection ----------------------------------------------------

    /** Held transactions a failed test left open, committed after it. */
    const openHolds = new Set<() => Promise<void>>();

    /**
     * `holdPostgresTransaction`, committed after the test if it fails
     * before committing, so its locks can't stall later tests.
     */
    const hold = async (sql: string, values: readonly unknown[]) => {
      const held = await holdPostgresTransaction(pool, sql, values);
      const commit = async () => {
        if (openHolds.delete(commit)) await held.commit();
      };
      openHolds.add(commit);
      return { pid: held.pid, commit };
    };

    /** Resolves once a backend waits for a lock `holder` holds. */
    const blockedBy = (holder: { readonly pid: number }, description: string) =>
      waitForPostgresLockWaiter(pool, {
        condition: "$1::int = any(pg_blocking_pids(pid))",
        values: [holder.pid],
        description,
      });

    /** Resolves once a backend waits behind one that waits for `holder`. */
    const queuedBehind = (
      holder: { readonly pid: number },
      description: string
    ) =>
      waitForPostgresLockWaiter(pool, {
        condition: `exists (
          select 1 from unnest(pg_blocking_pids(pid)) as blocker(pid)
          where $1::int = any(pg_blocking_pids(blocker.pid))
        )`,
        values: [holder.pid],
        description,
      });

    /**
     * Holds the campaign row. A lifecycle operation that already holds the
     * lifecycle lock then waits for it at its campaign write (status, or
     * the new version's foreign key).
     */
    const holdCampaignRow = (campaignId: CampaignId) =>
      hold("select 1 from email_campaigns where id = $1 for update", [
        campaignId,
      ]);

    /**
     * Holds a unit's row. Its commit, which locks the unit row after the
     * lifecycle lock and its domain writes (§5.4), then waits for it while
     * holding the shared lifecycle lock.
     */
    const holdUnitRow = (unitId: AutomationWorkUnitId) =>
      hold(
        "select 1 from email_campaign_automation_work_units where id = $1 for update",
        [unitId]
      );

    /** Where one side of a race stops until released. */
    type Gate = {
      readonly reached: Promise<void>;
      readonly release: () => void;
    };

    /**
     * The other side of a race, stopped mid-transaction while holding its
     * locks: `unitWaits` resolves once the unit's commit waits for it, and
     * `finish` lets it commit.
     */
    type HeldOperation = {
      readonly unitWaits: () => Promise<void>;
      readonly finish: () => Promise<unknown>;
    };

    /** Holds the next Resend batch request before the provider sees it. */
    const resendGate = (): Gate => {
      let reached: () => void = () => {};
      let release: () => void = () => {};
      const arrived = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      scenario.resend.beforeEachRequest(() => {
        scenario.resend.beforeEachRequest(() => Promise.resolve());
        reached();
        return released;
      });
      return { reached: arrived, release };
    };

    /**
     * Races `operation` against unit `unitId` in `order`. The unit stops at
     * `gate` (default: its first Dotypos request), so the operation lands
     * after it claimed and fetched. `whileRacing` runs while both sides are
     * still open. Resolves with the unit's outcome once both finished.
     */
    const raceUnit = async (input: {
      readonly unitId: AutomationWorkUnitId;
      readonly campaignId: CampaignId;
      readonly order: Order;
      readonly operation: () => Promise<unknown>;
      readonly at?: Temporal.Instant;
      readonly engine?: Pick<typeof scenario, "start">;
      readonly gate?: () => Gate;
      /** The operation held mid-transaction (default: at its campaign write). */
      readonly hold?: (
        campaignId: CampaignId,
        operation: () => Promise<unknown>
      ) => Promise<HeldOperation>;
      readonly whileRacing?: () => Promise<void>;
    }) => {
      const gate = (input.gate ?? (() => scenario.dotypos.gate("any")))();
      const unit = (input.engine ?? scenario).start(
        input.unitId,
        input.at ?? at
      );
      await gate.reached;
      const whileRacing = input.whileRacing ?? (() => Promise.resolve());
      switch (input.order) {
        case "commit-between": {
          await input.operation();
          await whileRacing();
          gate.release();
          return outcomeOf(await unit.done);
        }
        case "lifecycle-holds": {
          const held = await (input.hold ?? holdLifecycleOperation)(
            input.campaignId,
            input.operation
          );
          gate.release();
          await held.unitWaits();
          await whileRacing();
          await held.finish();
          return outcomeOf(await unit.done);
        }
        case "lock-wait": {
          const hold = await holdUnitRow(input.unitId);
          gate.release();
          await blockedBy(hold, "the unit's commit holding the shared lock");
          const operation = background(input.operation());
          await queuedBehind(hold, "the operation waiting for the commit");
          await whileRacing();
          await hold.commit();
          const outcome = outcomeOf(await unit.done);
          await operation();
          return outcome;
        }
      }
    };

    /** Runs `operation`, stopped at its campaign write with the lifecycle lock held. */
    const holdLifecycleOperation = async (
      campaignId: CampaignId,
      operation: () => Promise<unknown>
    ): Promise<HeldOperation> => {
      const hold = await holdCampaignRow(campaignId);
      const running = background(operation());
      await blockedBy(hold, "the operation holding the lifecycle lock");
      return {
        unitWaits: () => queuedBehind(hold, "the unit waiting for it"),
        finish: async () => {
          await hold.commit();
          await running();
        },
      };
    };

    const pause =
      (campaignId: CampaignId, when = at) =>
      () =>
        scenario.lifecycle((l) => l.pause(campaignId), when);
    const archive =
      (campaignId: CampaignId, when = at) =>
      () =>
        scenario.lifecycle((l) => l.archive(campaignId), when);

    // -- Seeds ----------------------------------------------------------------

    /** An automation of `flow` activated at `start` through the lifecycle. */
    const activate = async (flow = bookedSendFlow) => {
      const { campaignId } = await kit.seedActive(flow, { at: start });
      opened.push(campaignId);
      const automation = await read.automation(campaignId);
      return {
        campaignId,
        versionId: automation.active_version_id as AutomationVersionId,
      };
    };

    /** The only unit of `kind` planned for `campaignId`, enqueued. */
    const enqueuedUnit = async (
      campaignId: CampaignId,
      kind: AutomationWorkUnitKind
    ) => {
      const units = (await read.units(campaignId)).filter(
        (unit) => unit.kind === kind
      );
      expect(units.map((unit) => unit.status)).toEqual(["enqueued"]);
      return units[0]!.id as AutomationWorkUnitId;
    };

    /** A Workspace booking two days ahead, with its live Dotypos visit. */
    const bookAhead = (
      label: string,
      customer: Awaited<ReturnType<typeof fixtures.addCustomer>>
    ) =>
      fixtures.book({
        label,
        customer,
        startsAt: start.add({ hours: 48 }),
        endsAt: start.add({ hours: 56 }),
      });

    /** A booking whose event, of a send-on-booking automation, is in an enqueued intake unit. */
    const plannedIntake = async (label: string) => {
      const { campaignId, versionId } = await activate();
      const customer = await fixtures.addCustomer(label);
      const reservation = await bookAhead(label, customer);
      const eventId = await fixtures.recordEvent({
        kind: "reservation-booked",
        customer,
        occurredAt,
        reservationId: reservation,
      });
      await scenario.plan(at);
      const { rows } = await pool.query<{
        id: AutomationWorkUnitId;
        status: string;
      }>(
        "select id, status from email_campaign_automation_work_units where kind = 'intake' and subject->'eventIds' ? $1",
        [eventId]
      );
      expect(rows.map((unit) => unit.status)).toEqual(["enqueued"]);
      return {
        campaignId,
        versionId,
        customer,
        eventId,
        at,
        unitId: rows[0]!.id,
      };
    };

    /** A schedule automation's fire at 10:00 entering, its one chunk enqueued. */
    const plannedChunk = async (label: string) => {
      const customer = await fixtures.addCustomer(label);
      const { campaignId } = await activate(scheduleFlow);
      await scenario.plan(fireAt);
      return {
        campaignId,
        customer,
        at: fireAt,
        unitId: await enqueuedUnit(campaignId, "fire-chunk"),
      };
    };

    /** A run of a vip-tagged customer ready at the condition step, in an enqueued condition unit. */
    const plannedCondition = async (label: string) => {
      const { campaignId, versionId } = await activate(vipFlow);
      const customer = await fixtures.addCustomer(label, {
        profile: { tags: ["vip"] },
      });
      const runId = await seedAutomationRun(db, {
        campaignId,
        versionId,
        customerId: customer,
        stepId: "vip",
        phase: "ready",
        stepEnteredAt: occurredAt,
        dueAt: occurredAt,
      });
      await scenario.plan(at);
      return {
        campaignId,
        runId,
        at,
        unitId: await enqueuedUnit(campaignId, "condition"),
      };
    };

    /** A booking's run ready at the send step of a send-on-booking automation. */
    const readyToSendRun = async (label: string) => {
      const { campaignId, versionId } = await activate();
      const customer = await fixtures.addCustomer(label);
      const reservation = await bookAhead(label, customer);
      const [runId] = await seedSendReadyRuns(db, {
        campaignId,
        versionId,
        runs: [
          {
            customer,
            triggerKind: "reservation-booked",
            reservationId: reservation,
          },
        ],
        at: occurredAt,
      });
      return {
        campaignId,
        customer,
        reservation,
        runId: runId!,
        email: scenario.dotypos.customers.get(customer)!.email!,
      };
    };

    /** A booking's run ready at the send step, in an enqueued deliver unit. */
    const plannedDeliver = async (
      label: string,
      engine: Pick<typeof scenario, "plan"> = scenario
    ) => {
      const run = await readyToSendRun(label);
      await engine.plan(at);
      return {
        ...run,
        at,
        unitId: await enqueuedUnit(run.campaignId, "deliver"),
      };
    };

    // -- Reads ----------------------------------------------------------------

    /** Each run's state, as the table's rows give it. */
    const runStates = async (campaignId: CampaignId) =>
      (await read.runs(campaignId)).map((run) => ({
        status: run.status,
        outcome: run.outcome,
        step: run.step_id,
        phase: run.phase,
      }));

    const readyToSend = {
      status: "active",
      outcome: null,
      step: "send",
      phase: "ready",
    };
    const endedAs = (outcome: string) => ({
      status: "ended",
      outcome,
      step: expect.anything(),
      phase: null,
    });

    /** How often `email` was really mailed. */
    const mailedTo = (email: string) =>
      scenario.resend.mailed().filter((address) => address === email).length;

    // -- §5.4 rows --------------------------------------------------------------

    describe("pause × intake; fire chunk", () => {
      for (const order of orders) {
        test(`intake, ${order}: ${order === "lock-wait" ? "its run exists and stays frozen" : "no run; the event is processed without a receipt"}`, async () => {
          const { campaignId, eventId, unitId } = await plannedIntake(
            `pause-intake-${order}`
          );

          const outcome = await raceUnit({
            unitId,
            campaignId,
            order,
            operation: pause(campaignId),
          });

          // An intake unit serves every automation, so pausing one doesn't
          // mark it: its commit sees the pause under the lock (§5.4).
          expect(outcome).toBe("done");
          const [event] = await read.events([eventId]);
          expect(event!.automation_processed_at).not.toBeNull();
          expect(event!.automation_unit_id).toBeNull();
          await scenario.plan(at.add({ minutes: 1 }));
          if (order === "lock-wait") {
            expect(await runStates(campaignId)).toEqual([readyToSend]);
            expect(
              (await read.receipts(campaignId)).map((r) => r.disposition)
            ).toEqual(["started"]);
            // Frozen: no deliver unit plans its send while paused.
            expect((await read.runs(campaignId))[0]!.work_unit_id).toBeNull();
          } else {
            expect(await read.runs(campaignId)).toEqual([]);
            expect(await read.receipts(campaignId)).toEqual([]);
          }
        });

        test(`fire chunk, ${order}: ${order === "lock-wait" ? "its runs exist and stay frozen" : "no run; the fire is dropped"}`, async () => {
          const { campaignId, unitId } = await plannedChunk(
            `pause-chunk-${order}`
          );

          const outcome = await raceUnit({
            unitId,
            campaignId,
            order,
            at: fireAt,
            operation: pause(campaignId, fireAt),
          });
          await scenario.plan(fireAt.add({ minutes: 1 }));

          const fires = await read.fires(campaignId);
          if (order === "lock-wait") {
            expect(outcome).toBe("done");
            expect(fires.map((fire) => fire.status)).toEqual(["entered"]);
            expect(await runStates(campaignId)).toEqual([readyToSend]);
            expect((await read.runs(campaignId))[0]!.work_unit_id).toBeNull();
            expect((await read.automation(campaignId)).next_fire_at).toBeNull();
          } else {
            expect(outcome).toBe("dropped");
            expect(fires.map((fire) => fire.status)).toEqual(["dropped"]);
            expect(await read.runs(campaignId)).toEqual([]);
            expect(await read.receipts(campaignId)).toEqual([]);
          }
        });
      }
    });

    describe("pause × deliver", () => {
      for (const order of orders) {
        test(`${order}: ${order === "lock-wait" ? "the persisted batch is submitted" : "no send or batch; the run stays at the send step"}`, async () => {
          const { campaignId, email, unitId } = await plannedDeliver(
            `pause-deliver-${order}`
          );

          const outcome = await raceUnit({
            unitId,
            campaignId,
            order,
            operation: pause(campaignId),
          });
          await scenario.plan(at.add({ minutes: 1 }));

          if (order === "lock-wait") {
            expect(outcome).toBe("done");
            expect(await read.sends(campaignId)).toHaveLength(1);
            expect(await runStates(campaignId)).toEqual([endedAs("sent")]);
            expect(mailedTo(email)).toBe(1);
          } else {
            expect(outcome).toBe("dropped");
            expect(await read.sends(campaignId)).toEqual([]);
            expect(await runStates(campaignId)).toEqual([readyToSend]);
            expect((await read.runs(campaignId))[0]!.work_unit_id).toBeNull();
            expect(mailedTo(email)).toBe(0);
          }
        });
      }
    });

    describe("archive × any unit", () => {
      for (const order of orders) {
        const unitCommits = order === "lock-wait";

        test(`intake, ${order}: no open run`, async () => {
          const { campaignId, unitId } = await plannedIntake(
            `archive-intake-${order}`
          );

          const outcome = await raceUnit({
            unitId,
            campaignId,
            order,
            operation: archive(campaignId),
          });

          // Unmarked, like on pause: the commit sees the archive instead.
          expect(outcome).toBe("done");
          if (unitCommits) {
            expect(await runStates(campaignId)).toEqual([endedAs("archived")]);
          } else {
            expect(await read.runs(campaignId)).toEqual([]);
            expect(await read.receipts(campaignId)).toEqual([]);
          }
        });

        test(`fire chunk, ${order}: no open run`, async () => {
          const { campaignId, unitId } = await plannedChunk(
            `archive-chunk-${order}`
          );

          const outcome = await raceUnit({
            unitId,
            campaignId,
            order,
            at: fireAt,
            operation: archive(campaignId, fireAt),
          });

          const fires = await read.fires(campaignId);
          if (unitCommits) {
            expect(outcome).toBe("done");
            expect(fires.map((fire) => fire.status)).toEqual(["entered"]);
            expect(await runStates(campaignId)).toEqual([endedAs("archived")]);
          } else {
            expect(outcome).toBe("dropped");
            expect(fires.map((fire) => fire.status)).toEqual(["dropped"]);
            expect(await read.runs(campaignId)).toEqual([]);
          }
        });

        test(`condition, ${order}: its active run ends archived`, async () => {
          const { campaignId, runId, unitId } = await plannedCondition(
            `archive-condition-${order}`
          );

          const outcome = await raceUnit({
            unitId,
            campaignId,
            order,
            operation: archive(campaignId),
          });

          expect(outcome).toBe(unitCommits ? "done" : "dropped");
          expect(await runStates(campaignId)).toEqual([endedAs("archived")]);
          // Only a commit before the archive moved the run on.
          expect(
            (await read.timeline(runId)).map((entry) => entry.kind)
          ).toEqual(
            unitCommits ? ["condition-passed", "archived"] : ["archived"]
          );
        });

        test(`deliver, ${order}: ${unitCommits ? "the persisted batch settles" : "no send; its active run ends archived"}`, async () => {
          const { campaignId, email, unitId } = await plannedDeliver(
            `archive-deliver-${order}`
          );

          const outcome = await raceUnit({
            unitId,
            campaignId,
            order,
            operation: archive(campaignId),
          });

          if (unitCommits) {
            expect(outcome).toBe("done");
            expect(await runStates(campaignId)).toEqual([endedAs("sent")]);
            expect(mailedTo(email)).toBe(1);
          } else {
            expect(outcome).toBe("dropped");
            expect(await read.sends(campaignId)).toEqual([]);
            expect(await runStates(campaignId)).toEqual([endedAs("archived")]);
            expect(mailedTo(email)).toBe(0);
          }
        });
      }
    });

    describe("archive × chunk mid-fetch; deliver mid-submission", () => {
      /** Units holding a slot (§5.3): enqueued or claimed, marked or not. */
      const inFlight = async () =>
        (
          await pool.query<{ id: AutomationWorkUnitId; kind: string }>(
            "select id, kind from email_campaign_automation_work_units where status in ('enqueued', 'claimed') order by id"
          )
        ).rows;

      /** A unit's row. */
      const unitRow = async (unitId: AutomationWorkUnitId) =>
        (
          await pool.query(
            "select * from email_campaign_automation_work_units where id = $1",
            [unitId]
          )
        ).rows[0]!;

      /**
       * The intake unit planned at `when` for a fresh booking of `campaignId`,
       * which occurred on the tick `when` falls in.
       */
      const competingIntake = async (
        engine: Pick<typeof scenario, "plan">,
        label: string,
        when: Temporal.Instant
      ) => {
        const customer = await fixtures.addCustomer(label);
        const reservation = await bookAhead(label, customer);
        const eventId = await fixtures.recordEvent({
          kind: "reservation-booked",
          customer,
          occurredAt: automationTickAtOrBefore(when),
          reservationId: reservation,
        });
        await engine.plan(when);
        const { rows } = await pool.query<{ id: AutomationWorkUnitId }>(
          "select id from email_campaign_automation_work_units where kind = 'intake' and subject->'eventIds' ? $1",
          [eventId]
        );
        return rows[0]!.id;
      };

      for (const order of orders) {
        const marked = order !== "lock-wait";

        test(`fire chunk, ${order}: ${marked ? "marked, not freed: its slot stays occupied until the claimant settles it" : "the commit settles first and hands its slot on"}`, async () => {
          // One slot, so the competing unit shows whether the slot is free.
          const single = await scenario.deployment({
            limits: { total: 1, deliver: 1 },
          });
          await fixtures.addCustomer(`marked-chunk-${order}`);
          const { campaignId } = await activate(scheduleFlow);
          await activate();
          await single.plan(fireAt);
          const chunkId = await enqueuedUnit(campaignId, "fire-chunk");
          let competitor: AutomationWorkUnitId | undefined;

          const outcome = await raceUnit({
            engine: single,
            unitId: chunkId,
            campaignId,
            order,
            at: fireAt,
            operation: archive(campaignId, fireAt),
            whileRacing: async () => {
              if (order === "commit-between") {
                const chunk = await unitRow(chunkId);
                expect(chunk.status).toBe("claimed");
                expect(chunk.cancel_requested_at).not.toBeNull();
              }
              competitor = await competingIntake(
                single,
                `marked-chunk-${order}-competitor`,
                fireAt.add({ minutes: 1 })
              );
              expect((await unitRow(competitor)).status).toBe("planned");
              expect((await inFlight()).map(({ id }) => id)).toEqual([chunkId]);
            },
          });

          expect(outcome).toBe(marked ? "dropped" : "done");
          expect(await runStates(campaignId)).toEqual(
            marked ? [] : [endedAs("archived")]
          );
          // The settling commit handed the slot to the competitor.
          expect((await inFlight()).map(({ id }) => id)).toEqual([competitor!]);
        });
      }

      test("fire chunk: a marked chunk whose claimant died keeps its slot until the reaper settles it after the claim expires", async () => {
        const single = await scenario.deployment({
          limits: { total: 1, deliver: 1 },
        });
        await fixtures.addCustomer("marked-chunk-crash");
        const { campaignId } = await activate(scheduleFlow);
        await activate();
        await single.plan(fireAt);
        const chunkId = await enqueuedUnit(campaignId, "fire-chunk");
        const fetch = scenario.dotypos.gate("any");
        const consumer = single.start(chunkId, fireAt);
        await fetch.reached;
        await archive(campaignId, fireAt)();
        await consumer.interrupt();
        // An interrupted consumer's delivery rejects: the platform cut it off.
        await consumer.done.catch(() => undefined);
        fetch.release();

        // The claim (330 s) hasn't expired: the slot stays taken.
        const competitor = await competingIntake(
          single,
          "marked-chunk-crash-competitor",
          fireAt.add({ minutes: 5 })
        );
        expect((await unitRow(competitor)).status).toBe("planned");
        expect((await inFlight()).map(({ id }) => id)).toEqual([chunkId]);
        await single.plan(fireAt.add({ minutes: 6 }));
        expect((await unitRow(chunkId)).status).toBe("dropped");
        expect((await inFlight()).map(({ id }) => id)).toEqual([competitor]);
        expect(await read.runs(campaignId)).toEqual([]);
      });

      for (const order of orders) {
        test(`deliver mid-submission, ${order}: never marked; one deliver slot stays taken until the batch settles`, async () => {
          const deliverSlot = await scenario.deployment({
            limits: { total: 4, deliver: 1 },
          });
          const submitting = await plannedDeliver(
            `submitting-${order}`,
            deliverSlot
          );
          let competitor: AutomationWorkUnitId | undefined;

          const outcome = await raceUnit({
            engine: deliverSlot,
            unitId: submitting.unitId,
            campaignId: submitting.campaignId,
            order,
            operation: archive(submitting.campaignId),
            gate: resendGate,
            whileRacing: async () => {
              const unit = await unitRow(submitting.unitId);
              expect(unit.send_id).not.toBeNull();
              expect(unit.cancel_requested_at).toBeNull();
              const next = await readyToSendRun(`submitting-${order}-next`);
              await deliverSlot.plan(at.add({ minutes: 1 }));
              const [planned] = (await read.units(next.campaignId)).filter(
                (u) => u.kind === "deliver"
              );
              competitor = planned!.id;
              expect(planned!.status).toBe("planned");
              expect(
                (await inFlight()).filter(({ kind }) => kind === "deliver")
              ).toEqual([{ id: submitting.unitId, kind: "deliver" }]);
            },
          });

          expect(outcome).toBe("done");
          expect(
            (await unitRow(submitting.unitId)).cancel_requested_at
          ).toBeNull();
          expect(await runStates(submitting.campaignId)).toEqual([
            endedAs("sent"),
          ]);
          expect(mailedTo(submitting.email)).toBe(1);
          expect(
            (await inFlight()).filter(({ kind }) => kind === "deliver")
          ).toEqual([{ id: competitor!, kind: "deliver" }]);
        });
      }
    });

    describe("pause; archive × deliver crashed before submitting, or after Resend accepted", () => {
      /** Cuts the deliver unit's consumer off with its batch persisted. */
      const crashDeliver = async (
        unitId: AutomationWorkUnitId,
        crash: "before submitting" | "after Resend accepted"
      ) => {
        if (crash === "before submitting") {
          const submission = resendGate();
          const consumer = scenario.start(unitId, at);
          await submission.reached;
          await consumer.interrupt();
          // An interrupted consumer's delivery rejects: the platform cut it off.
          await consumer.done.catch(() => undefined);
          return;
        }
        scenario.resend.respondWith(() => "accept-hang");
        const reached = scenario.resend.nextRequest();
        const consumer = scenario.start(unitId, at);
        await reached;
        await consumer.interrupt();
        // An interrupted consumer's delivery rejects: the platform cut it off.
        await consumer.done.catch(() => undefined);
        scenario.resend.respondWith(() => "accept");
      };

      for (const operation of ["pause", "archive"] as const) {
        for (const crash of [
          "before submitting",
          "after Resend accepted",
        ] as const) {
          for (const order of orders) {
            test(`${operation}, crashed ${crash}, ${order}: reaped, never marked; batch 0 replays under its key; one email; the run ends sent`, async () => {
              const { campaignId, email, unitId } = await plannedDeliver(
                `crashed-${operation}-${crash.split(" ")[0]}-${order}`
              );
              await crashDeliver(unitId, crash);
              const [send] = await read.sends(campaignId);
              const lifecycleOperation =
                operation === "pause" ? pause(campaignId) : archive(campaignId);
              const reapedAt = at.add({ minutes: 6 });

              let outcome: AutomationUnitOutcome | "redelivered";
              if (order === "commit-between") {
                // The operation lands while the consumer is dead.
                await lifecycleOperation();
                const [unit] = (await read.units(campaignId)).filter(
                  (u) => u.id === unitId
                );
                expect(unit!.status).toBe("claimed");
                expect(unit!.cancel_requested_at).toBeNull();
                await scenario.plan(reapedAt);
                outcome = (await scenario.process(unitId, reapedAt)).outcome;
              } else {
                // It races the replay's settlement instead.
                await scenario.plan(reapedAt);
                outcome = await raceUnit({
                  unitId,
                  campaignId,
                  order,
                  at: reapedAt,
                  operation: lifecycleOperation,
                  gate: resendGate,
                });
              }

              expect(outcome).toBe("done");
              const [unit] = (await read.units(campaignId)).filter(
                (u) => u.id === unitId
              );
              expect(unit!.cancel_requested_at).toBeNull();
              expect(unit!.enqueue_generation).toBe(1);
              expect(
                scenario.resend
                  .requests()
                  .filter(({ to }) => to.includes(email))
                  .map(({ key }) => key)
              ).toEqual(
                Array(crash === "before submitting" ? 1 : 2).fill(
                  `email-campaign:${send!.id}:attempt-1:batch-0`
                )
              );
              expect(mailedTo(email)).toBe(1);
              expect(await runStates(campaignId)).toEqual([endedAs("sent")]);
            });
          }
        }
      }
    });

    describe("activate v2 × intake planned with v1; replay backlog", () => {
      /** "When a reservation is booked, wait an hour, then send." */
      const settleFlow = automationFlowFixture({
        trigger: { _tag: "ReservationBooked" },
        steps: [
          {
            _tag: "Wait",
            id: "settle",
            wait: { _tag: "Duration", count: 1, unit: "hour" },
          },
          { _tag: "Send", id: "send" },
        ],
      });

      /** "Every day at 11:00, send." */
      const elevenOClockFlow = automationFlowFixture({
        trigger: { _tag: "Schedule", calendar: { minutes: [0], hours: [11] } },
        steps: [{ _tag: "Send", id: "send" }],
      });

      /** A completed dry run of `flow` as the campaign's working copy. */
      const draftV2 = async (
        campaignId: CampaignId,
        flow: typeof settleFlow
      ) => {
        await scenario.lifecycle(
          (l) => l.updateFlow({ campaignId, flow }),
          start
        );
        return kit.seedPreview(campaignId, { status: "completed" });
      };

      /**
       * Activates the draft at `activatedAt`. With `waitedUntil`, the clock
       * moves on to it once `clockMoves` is called, as time passes while
       * the activation waits for the lifecycle lock.
       */
      const activation = (input: {
        readonly campaignId: CampaignId;
        readonly previewId: Awaited<ReturnType<typeof kit.seedPreview>>;
        readonly activatedAt: Temporal.Instant;
        readonly waitedUntil?: Temporal.Instant;
      }) => {
        let passTime: () => void = () => {};
        const timePasses = new Promise<void>((resolve) => {
          passTime = resolve;
        });
        let clockMoved: () => void = () => {};
        const moved = new Promise<void>((resolve) => {
          clockMoved = resolve;
        });
        const activate = Effect.flatMap(AutomationLifecycle, (l) =>
          l.activate({
            campaignId: input.campaignId,
            previewId: input.previewId,
            activatedBy: null,
          })
        );
        const waitedUntil = input.waitedUntil;
        return {
          operation: () =>
            scenario.run(
              waitedUntil === undefined
                ? activate
                : Effect.forkChild(activate).pipe(
                    Effect.tap(() => Effect.promise(() => timePasses)),
                    Effect.tap(() =>
                      TestClock.setTime(waitedUntil.epochMilliseconds)
                    ),
                    Effect.tap(() => Effect.sync(clockMoved)),
                    Effect.flatMap(Fiber.join)
                  ),
              input.activatedAt
            ),
          passTime: async () => {
            passTime();
            await moved;
          },
        };
      };

      for (const order of orders) {
        test(`intake planned with v1, ${order}: occurrences before v2's activation use v1, later ones v2`, async () => {
          const { campaignId, versionId: v1 } = await activate();
          const book = async (label: string, when: Temporal.Instant) => {
            const customer = await fixtures.addCustomer(label);
            const eventId = await fixtures.recordEvent({
              kind: "reservation-booked",
              customer,
              occurredAt: when,
              reservationId: await bookAhead(label, customer),
            });
            return { customer, eventId, occurredAt: when };
          };
          const early = await book(
            `v2-early-${order}`,
            start.add({ minutes: 1 })
          );
          const late = await book(
            `v2-late-${order}`,
            start.add({ minutes: 3 })
          );
          const previewId = await draftV2(campaignId, settleFlow);
          // The tick after both occurrences takes them in.
          const plannedAt = start.add({ minutes: 15 });
          await scenario.plan(plannedAt);
          const { rows: intake } = await pool.query<{
            id: AutomationWorkUnitId;
          }>(
            "select id from email_campaign_automation_work_units where kind = 'intake' and subject->'eventIds' ?& $1",
            [[early.eventId, late.eventId]]
          );
          expect(intake).toHaveLength(1);

          // v2 activates between the two occurrences, after the planner
          // read v1 as in force. Waiting for the unit's lock, it activates
          // only once the time it waited has passed.
          const { operation, passTime } = activation({
            campaignId,
            previewId,
            activatedAt: start.add({ minutes: 2 }),
            ...(order === "lock-wait" && {
              waitedUntil: plannedAt.add({ minutes: 1 }),
            }),
          });
          const outcome = await raceUnit({
            unitId: intake[0]!.id,
            campaignId,
            order,
            at: plannedAt,
            operation,
            whileRacing: order === "lock-wait" ? passTime : undefined,
          });
          expect(outcome).toBe("done");
          // A released event is replanned with the version now in force.
          await scenario.tick(plannedAt.add({ minutes: 2 }));

          const automation = await read.automation(campaignId);
          const v2 = automation.active_version_id as AutomationVersionId;
          expect(v2).not.toBe(v1);
          const { rows: versions } = await pool.query(
            "select activated_at from email_campaign_automation_versions where id = $1",
            [v2]
          );
          const v2ActivatedAt = databaseInstant(versions[0]!.activated_at)!;
          const runs = await read.runs(campaignId);
          for (const occurrence of [early, late]) {
            const run = runs.find(
              (r) => r.dotypos_customer_id === occurrence.customer
            );
            expect(run?.version_id).toBe(
              Temporal.Instant.compare(occurrence.occurredAt, v2ActivatedAt) >=
                0
                ? v2
                : v1
            );
          }
          expect(runs.map((r) => r.version_id)).toEqual(
            order === "lock-wait" ? [v1, v1] : [v1, v2]
          );
        });

        test(`replay backlog, ${order}: fires before v2's activation use v1, later ones v2`, async () => {
          await fixtures.addCustomer(`backlog-${order}`);
          const { campaignId, versionId: v1 } = await activate(scheduleFlow);
          const previewId = await draftV2(campaignId, elevenOClockFlow);
          // The planner was down since the first fire: three are due.
          const resumedAt = Temporal.Instant.from("2026-10-15T10:00:00Z");
          await scenario.plan(resumedAt);
          const chunkId = await enqueuedUnit(campaignId, "fire-chunk");

          const outcome = await raceUnit({
            unitId: chunkId,
            campaignId,
            order,
            at: resumedAt,
            operation: activation({
              campaignId,
              previewId,
              activatedAt: resumedAt,
            }).operation,
          });
          expect(outcome).toBe("done");
          await scenario.runUntil({
            from: resumedAt,
            until: Temporal.Instant.from("2026-10-16T10:00:00Z"),
            settled: async () => (await read.fires(campaignId)).length >= 4,
          });

          const v2 = (await read.automation(campaignId))
            .active_version_id as AutomationVersionId;
          expect(
            (await read.fires(campaignId)).map((fire) => ({
              at: databaseInstant(fire.fire_at)?.toString(),
              version: fire.version_id,
            }))
          ).toEqual([
            { at: "2026-10-13T08:00:00Z", version: v1 },
            { at: "2026-10-14T08:00:00Z", version: v1 },
            { at: "2026-10-15T08:00:00Z", version: v1 },
            // 11:00 in Prague, the first fire after the activation.
            { at: "2026-10-16T09:00:00Z", version: v2 },
          ]);
        });
      }
    });

    describe("resume × timer for an overshot Calendar wait", () => {
      /** "When a reservation is booked, wait for a Wednesday, then send." */
      const wednesdayFlow = automationFlowFixture({
        trigger: { _tag: "ReservationBooked" },
        steps: [
          {
            _tag: "Wait",
            id: "wednesday",
            wait: {
              _tag: "Calendar",
              expression: { weekdays: ["wednesday"] },
            },
          },
          { _tag: "Send", id: "send" },
        ],
      });
      const settleFlow = automationFlowFixture({
        trigger: { _tag: "ReservationBooked" },
        steps: [
          {
            _tag: "Wait",
            id: "settle",
            wait: { _tag: "Duration", count: 1, unit: "hour" },
          },
          { _tag: "Send", id: "send" },
        ],
      });
      /** Wednesday 14 October in Prague, when the wait fell due. */
      const wednesday = Temporal.Instant.from("2026-10-13T22:00:00Z");
      /** Thursday 15 October, 08:01 in Prague: the wait no longer holds. */
      const timerAt = Temporal.Instant.from("2026-10-15T06:01:00Z");
      const nextWednesday = Temporal.Instant.from("2026-10-20T22:00:00Z");

      for (const order of orders) {
        test(`${order}: ${order === "lock-wait" ? "the timer advances on the resumed_at it read; the resume follows" : "reads resumed_at under the lock and waits for the next Wednesday"}`, async () => {
          const subject = await activate(wednesdayFlow);
          // An automation the timer locks first, so it reads the due runs
          // while the subject is still active and never paused.
          const first = await activate(settleFlow);
          const runId = await seedAutomationRun(db, {
            campaignId: subject.campaignId,
            versionId: subject.versionId,
            customerId: await fixtures.addCustomer(`calendar-${order}`),
            stepId: "wednesday",
            phase: "waiting",
            stepEnteredAt: start,
            dueAt: wednesday,
          });
          await seedAutomationRun(db, {
            campaignId: first.campaignId,
            versionId: first.versionId,
            customerId: await fixtures.addCustomer(`calendar-first-${order}`),
            stepId: "settle",
            phase: "waiting",
            stepEnteredAt: start,
            dueAt: start.add({ hours: 1 }),
          });
          const pauseSubject = () =>
            scenario.lifecycle((l) => l.pause(subject.campaignId), timerAt);
          const resumeSubject = () =>
            scenario.lifecycle((l) => l.resume(subject.campaignId), timerAt);

          const firstHold = await hold(
            "select 1 from email_campaign_automations where campaign_id = $1 for update",
            [first.campaignId]
          );
          const timers = background(scenario.plan(timerAt));
          await blockedBy(firstHold, "the timer at the first automation");
          switch (order) {
            case "commit-between": {
              await pauseSubject();
              await resumeSubject();
              await firstHold.commit();
              await timers();
              break;
            }
            case "lifecycle-holds": {
              await pauseSubject();
              const held = await holdLifecycleOperation(
                subject.campaignId,
                resumeSubject
              );
              await firstHold.commit();
              await held.unitWaits();
              await held.finish();
              await timers();
              break;
            }
            case "lock-wait": {
              const runHold = await hold(
                "select 1 from email_campaign_automation_runs where id = $1 for update",
                [runId]
              );
              await firstHold.commit();
              await blockedBy(runHold, "the timer holding the shared lock");
              const paused = background(pauseSubject());
              await queuedBehind(runHold, "the pause waiting for the timer");
              await runHold.commit();
              await timers();
              await paused();
              await resumeSubject();
              break;
            }
          }

          const [run] = await read.runs(subject.campaignId);
          if (order === "lock-wait") {
            // Never paused when the timer read it: due, so it advances
            // without rechecking the calendar (lateness rule).
            expect(run).toMatchObject({ step_id: "send", phase: "ready" });
          } else {
            expect(run).toMatchObject({
              step_id: "wednesday",
              phase: "waiting",
            });
            expect(databaseInstant(run!.due_at)?.toString()).toBe(
              nextWednesday.toString()
            );
          }
        });
      }
    });

    describe("Workspace cancellation × deliver", () => {
      const named = {
        "commit-between": "cancellation first: withdrawn",
        "lifecycle-holds":
          "cancellation holding its row while deliver waits: withdrawn",
        "lock-wait": "deliver first: the batch settles",
      } as const satisfies Record<Order, string>;
      for (const order of orders) {
        test(`${order}, ${named[order]}`, async () => {
          const { campaignId, email, reservation, unitId } =
            await plannedDeliver(`workspace-cancel-${order}`);

          const outcome = await raceUnit({
            unitId,
            campaignId,
            order,
            operation: () => fixtures.cancelInWorkspace(reservation, at),
            hold: async () => {
              const cancellation = await hold(
                "update workspace_reservations set reservation_cancelled_at = $2 where id = $1",
                [reservation, at.toString()]
              );
              return {
                unitWaits: () =>
                  blockedBy(
                    cancellation,
                    "deliver waiting for the cancellation"
                  ),
                finish: () => cancellation.commit(),
              };
            },
          });

          expect(outcome).toBe("done");
          if (order === "lock-wait") {
            expect(await runStates(campaignId)).toEqual([endedAs("sent")]);
            expect(mailedTo(email)).toBe(1);
          } else {
            expect(await read.sends(campaignId)).toEqual([]);
            expect(await runStates(campaignId)).toEqual([endedAs("withdrawn")]);
            expect(mailedTo(email)).toBe(0);
          }
        });
      }
    });

    // A Dotypos cancellation takes no Postgres lock, so only two orders
    // exist: before or after the unit's live verification read (§5.9).
    describe("Dotypos cancellation × deliver", () => {
      test("before the live verification: withdrawn", async () => {
        const { campaignId, email, reservation, unitId } = await plannedDeliver(
          "dotypos-cancel-before"
        );
        const verification = scenario.dotypos.gate("listReservationsPage");
        const unit = scenario.start(unitId, at);
        await verification.reached;
        fixtures.cancelVisit(reservation);
        verification.release();

        expect(outcomeOf(await unit.done)).toBe("done");
        expect(await read.sends(campaignId)).toEqual([]);
        expect(await runStates(campaignId)).toEqual([endedAs("withdrawn")]);
        expect(mailedTo(email)).toBe(0);
      });

      test("after the live verification: sent, the window §5.9 accepts", async () => {
        const { campaignId, email, reservation, unitId } = await plannedDeliver(
          "dotypos-cancel-after"
        );
        const submission = resendGate();
        const unit = scenario.start(unitId, at);
        await submission.reached;
        fixtures.cancelVisit(reservation);
        submission.release();

        expect(outcomeOf(await unit.done)).toBe("done");
        expect(await runStates(campaignId)).toEqual([endedAs("sent")]);
        expect(mailedTo(email)).toBe(1);
      });
    });

    // The legacy marking (D37) writes the account row intake's commit locks
    // `FOR SHARE` before any lifecycle lock, so it races intake's profile
    // fetch like a lifecycle operation.
    describe("legacy marking × intake", () => {
      const named = {
        "commit-between": "marked first: no run",
        "lifecycle-holds": "marking holding its row while intake waits: no run",
        "lock-wait": "intake first: its run exists",
      } as const satisfies Record<Order, string>;
      for (const order of orders) {
        test(`${order}, ${named[order]}`, async () => {
          const { campaignId } = await kit.seedActive(
            automationFlowFixture({
              trigger: { _tag: "AccountCreated" },
              steps: [{ _tag: "Send", id: "send" }],
            }),
            {
              at: start,
              // The audience reads the customer's profile, so intake fetches.
              audienceFilter: vipCustomers,
            }
          );
          opened.push(campaignId);
          const customer = await fixtures.addCustomer(`legacy-${order}`, {
            profile: { tags: ["vip"] },
          });
          const eventId = await fixtures.recordEvent({
            kind: "account-created",
            customer,
            occurredAt,
            legacy: false,
          });
          await scenario.plan(at);
          const { rows } = await pool.query<{
            unitId: AutomationWorkUnitId;
            accountId: string;
          }>(
            `select u.id as "unitId", e.customer_account_id as "accountId"
             from email_campaign_automation_work_units u, customer_events e
             where u.kind = 'intake' and u.subject->'eventIds' ? e.id::text
               and e.id = $1`,
            [eventId]
          );
          const { unitId, accountId } = rows[0]!;
          const marking = [
            "update customer_accounts set legacy = true where id = $1",
            [accountId],
          ] as const;

          const outcome = await raceUnit({
            unitId,
            campaignId,
            order,
            gate: () => scenario.dotypos.gate("getCustomersPage"),
            operation: () => pool.query(...marking),
            hold: async () => {
              const held = await hold(...marking);
              return {
                unitWaits: () =>
                  blockedBy(held, "intake waiting for the marking"),
                finish: () => held.commit(),
              };
            },
          });

          expect(outcome).toBe("done");
          const [event] = await read.events([eventId]);
          expect(event!.automation_processed_at).not.toBeNull();
          expect(event!.automation_unit_id).toBeNull();
          const receipts = await read.receipts(campaignId);
          if (order === "lock-wait") {
            expect(receipts.map((r) => r.disposition)).toEqual(["started"]);
            expect(await read.runs(campaignId)).toHaveLength(1);
          } else {
            expect(receipts).toEqual([]);
            expect(await read.runs(campaignId)).toEqual([]);
          }
        });
      }
    });

    describe("reaper re-claim × any unit commit", () => {
      /** At least two backends wait for locks. */
      const twoWaiters = () =>
        waitForPostgresLockWaiter(pool, {
          condition:
            "(select count(distinct waiting.pid) from pg_locks as waiting where not waiting.granted) >= 2",
          description: "both claimants' commits",
        });

      const named = {
        "commit-between":
          "the new claimant commits while the stale one fetches",
        "lifecycle-holds":
          "the new claimant's commit holds its locks while the stale one's waits",
        "lock-wait":
          "the stale commit holds its locks while the new claimant's waits",
      } as const satisfies Record<Order, string>;

      const kinds = {
        intake: async (label: string) => {
          const planned = await plannedIntake(label);
          return {
            ...planned,
            // Its commit marks the event processed after entering runs.
            holdCommit: () =>
              hold("select 1 from customer_events where id = $1 for update", [
                planned.eventId,
              ]),
            appliedOnce: async () => {
              expect(await runStates(planned.campaignId)).toEqual([
                readyToSend,
              ]);
              expect(await read.receipts(planned.campaignId)).toHaveLength(1);
            },
          };
        },
        "fire chunk": async (label: string) => {
          const planned = await plannedChunk(label);
          return {
            ...planned,
            // Its commit rechecks and completes the fire.
            holdCommit: () =>
              hold(
                "select 1 from email_campaign_automation_schedule_fires where campaign_id = $1 for update",
                [planned.campaignId]
              ),
            appliedOnce: async () => {
              expect(await runStates(planned.campaignId)).toEqual([
                readyToSend,
              ]);
              expect(await read.receipts(planned.campaignId)).toHaveLength(1);
              expect(
                (await read.fires(planned.campaignId)).map((fire) => ({
                  status: fire.status,
                  entered: fire.entered_count,
                  chunks: fire.chunks_done,
                }))
              ).toEqual([{ status: "entered", entered: 1, chunks: 1 }]);
            },
          };
        },
        condition: async (label: string) => {
          const planned = await plannedCondition(label);
          return {
            ...planned,
            // Its commit moves the run by CAS.
            holdCommit: () =>
              hold(
                "select 1 from email_campaign_automation_runs where id = $1 for update",
                [planned.runId]
              ),
            appliedOnce: async () => {
              expect(await runStates(planned.campaignId)).toEqual([
                readyToSend,
              ]);
              expect(
                (await read.timeline(planned.runId)).map((entry) => entry.kind)
              ).toEqual(["condition-passed"]);
            },
          };
        },
        deliver: async (label: string) => {
          const planned = await plannedDeliver(label);
          return {
            ...planned,
            // Its commit records the persisted send on the unit row last.
            holdCommit: () => holdUnitRow(planned.unitId),
            appliedOnce: async () => {
              expect(await read.sends(planned.campaignId)).toHaveLength(1);
              expect(await runStates(planned.campaignId)).toEqual([
                endedAs("sent"),
              ]);
              expect(mailedTo(planned.email)).toBe(1);
            },
          };
        },
      };

      for (const [kind, plan] of Object.entries(kinds)) {
        for (const order of orders) {
          test(`${kind}, ${named[order]}: the stale commit writes nothing; the new one applies once`, async () => {
            const planned = await plan(
              `reclaim-${kind.replace(" ", "-")}-${order}`
            );
            const staleGate = scenario.dotypos.gate("any");
            const stale = scenario.start(planned.unitId, planned.at);
            await staleGate.reached;
            // The claim (330 s) expires; the reaper requeues the unit.
            const reclaimedAt = planned.at.add({ minutes: 6 });
            await scenario.plan(reclaimedAt);
            const [requeued] = (
              await pool.query(
                "select status, enqueue_generation from email_campaign_automation_work_units where id = $1",
                [planned.unitId]
              )
            ).rows;
            expect(requeued).toEqual({
              status: "enqueued",
              enqueue_generation: 1,
            });

            let fresh: AutomationUnitOutcome | "redelivered";
            if (order === "commit-between") {
              fresh = (await scenario.process(planned.unitId, reclaimedAt))
                .outcome;
              staleGate.release();
            } else {
              // Both have claimed and fetched. The first commit stops at a
              // row it writes, holding its locks, and the other waits.
              const freshGate = scenario.dotypos.gate("any");
              const claimant = scenario.start(planned.unitId, reclaimedAt);
              await freshGate.reached;
              const commitHold = await planned.holdCommit();
              const [first, second] =
                order === "lifecycle-holds"
                  ? [freshGate, staleGate]
                  : [staleGate, freshGate];
              first.release();
              await blockedBy(commitHold, "the first commit");
              second.release();
              await twoWaiters();
              await commitHold.commit();
              fresh = outcomeOf(await claimant.done);
            }

            expect(fresh).toBe("done");
            expect(outcomeOf(await stale.done)).toBe("acknowledged");
            expect(
              (
                await pool.query(
                  "select status from email_campaign_automation_work_units where id = $1",
                  [planned.unitId]
                )
              ).rows[0]
            ).toEqual({ status: "done" });
            await planned.appliedOnce();
          });
        }
      }
    });

    describe("slot promotion × a hand-off holding planned units", () => {
      test("the top-up skips a planned unit another transaction holds, so it never waits for that transaction while holding the slot lock", async () => {
        const { rows: seeded } = await pool.query<{
          id: AutomationWorkUnitId;
        }>(
          `insert into email_campaign_automation_work_units
             (kind, priority, key, subject, request_cost, status, created_at)
           select 'intake', 2, 'slot-order:' || n, '{}'::jsonb, 1, 'planned',
                  $1::timestamptz + n * interval '1 second'
           from generate_series(1, 2) as n
           returning id`,
          [start.toString()]
        );
        const [held, free] = seeded.map(({ id }) => id) as [
          AutomationWorkUnitId,
          AutomationWorkUnitId,
        ];
        const statusOf = async (unitId: AutomationWorkUnitId) =>
          (
            await pool.query<{ status: string }>(
              "select status from email_campaign_automation_work_units where id = $1",
              [unitId]
            )
          ).rows[0]?.status;

        // A hand-off first writes its planned units, as a preview that
        // drops its siblings does, then asks for the slot lock at its fill.
        const handOff = await pool.connect();
        let topUp: (() => Promise<unknown>) | undefined;
        try {
          const {
            rows: [{ pid }],
          } = await handOff.query("select pg_backend_pid() as pid");
          await handOff.query("begin");
          await handOff.query(
            "update email_campaign_automation_work_units set status = status where id = $1",
            [held]
          );

          let settled = false;
          topUp = background(
            scenario.plan(at).finally(() => {
              settled = true;
            })
          );
          // Until the fix, the top-up took the slot lock and then waited
          // for the held row.
          let waited = false;
          for (const deadline = Date.now() + 5_000; !settled; ) {
            const { rows } = await pool.query(
              "select 1 from pg_locks where not granted and $1::int = any(pg_blocking_pids(pid))",
              [pid]
            );
            if (rows.length > 0) {
              waited = true;
              break;
            }
            if (Date.now() > deadline) break;
            await Bun.sleep(10);
          }
          // Taking the slot lock now formed the deadlock with a waiting
          // top-up; it is free once the top-up commits.
          await handOff.query(
            "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
            ["email-automation-unit-slots", "engine"]
          );
          await handOff.query("commit");
          await topUp();
          expect(waited).toBe(false);
        } finally {
          // A failure leaves the transaction open; end it before the
          // connection goes back, then let the top-up finish.
          await handOff.query("rollback").catch(() => undefined);
          handOff.release();
          await topUp?.().catch(() => undefined);
        }

        expect(await statusOf(free)).toBe("enqueued");
        expect(await statusOf(held)).toBe("planned");
        // The next top-up promotes the unit it skipped.
        await scenario.plan(at);
        expect(await statusOf(held)).toBe("enqueued");
      });
    });
  }
);
