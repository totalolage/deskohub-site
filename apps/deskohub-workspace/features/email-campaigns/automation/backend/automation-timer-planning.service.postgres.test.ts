import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import type { CalendarExpressionType as CalendarExpression } from "@deskohub/workspace-admin-api";
import { Effect, Layer } from "effect";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  deleteAutomatedCampaigns,
  seedAutomatedCampaign,
  seedAutomation,
  seedAutomationVersion,
} from "../../backend/email-campaigns.test-utils";
import type { CampaignId } from "../../campaign-identifiers";
import {
  automationFlowOf,
  conditionStep,
  detailInstant,
  readAutomationRun,
  readAutomationRunTimeline,
  seedAutomationRun,
  seedFlowAutomation,
  setAutomationLifecycle,
  testCustomerId,
  waitStep,
} from "./automation-steps.test-utils";
import { AutomationTimerPlanning } from "./automation-timer-planning.service";

/**
 * Timer planning reads every waiting run, so the suite runs on a database of
 * its own.
 */
const database = await createWorkspacePostgresSuiteDatabase(
  "automation_timer_planning"
);
afterAll(() => database?.close());
const customer = testCustomerId(`automation-timers-${crypto.randomUUID()}`);

/** Monday 2026-10-19 12:00 Prague (CEST). */
const at = Temporal.Instant.from("2026-10-19T10:00:00Z");
const activatedAt = Temporal.Instant.from("2026-10-01T00:00:00Z");

const oneDay = { _tag: "Duration", count: 1, unit: "day" } as const;
const mondays: CalendarExpression = { weekdays: ["monday"] };
const tuesdays: CalendarExpression = { weekdays: ["tuesday"] };
/** February 30th: no start within the eight-year horizon. */
const never: CalendarExpression = { months: [2], daysOfMonth: [30] };
const everyone = {
  _tag: "Group",
  operator: "and",
  filters: [],
} as const;

describe.skipIf(!database)("AutomationTimerPlanning on Postgres", () => {
  const postgres = database!;
  const campaignIds: CampaignId[] = [];
  const layer = AutomationTimerPlanning.Default.pipe(
    Layer.provide(postgres.layer)
  );
  const plan = (when = at) =>
    Effect.runPromise(
      Effect.flatMap(AutomationTimerPlanning, (timers) =>
        timers.plan(when)
      ).pipe(Effect.provide(layer))
    );

  const automation = async (...steps: Parameters<typeof automationFlowOf>) => {
    const seeded = await seedFlowAutomation(postgres.db, {
      flow: automationFlowOf(...steps),
      activatedAt,
    });
    campaignIds.push(seeded.campaignId);
    return seeded;
  };

  afterAll(() => deleteAutomatedCampaigns(postgres.db, campaignIds));

  test("a run reaching a Duration wait waits the delay from the tick it entered in", async () => {
    const seeded = await automation(waitStep("delay", oneDay));
    const enteredAt = at.subtract({ minutes: 5 });
    const runId = await seedAutomationRun(postgres.db, {
      ...seeded,
      customerId: customer("duration-enter"),
      stepId: "delay",
      phase: "ready",
      stepEnteredAt: enteredAt,
      dueAt: enteredAt,
    });

    await plan();

    const run = await readAutomationRun(postgres.db, runId);
    // Entered at 09:55, during the 09:45 tick.
    const dueAt = at.subtract({ minutes: 15 }).add({ hours: 24 });
    expect(run).toMatchObject({
      status: "active",
      stepId: "delay",
      phase: "waiting",
    });
    expect(run.dueAt?.equals(dueAt)).toBe(true);
    expect(run.stepEnteredAt.equals(enteredAt)).toBe(true);
    expect(await readAutomationRunTimeline(postgres.db, runId)).toEqual([
      {
        kind: "waiting",
        stepId: "delay",
        at: at.toString(),
        detail: { dueAt: detailInstant(dueAt) },
      },
    ]);
  });

  test("a due Duration wait advances to the next step ready, with a woke entry", async () => {
    const seeded = await automation(
      waitStep("delay", oneDay),
      conditionStep("check", everyone)
    );
    const runId = await seedAutomationRun(postgres.db, {
      ...seeded,
      customerId: customer("duration-due"),
      stepId: "delay",
      phase: "waiting",
      stepEnteredAt: at.subtract({ hours: 25 }),
      dueAt: at.subtract({ hours: 1 }),
    });

    await plan();

    const run = await readAutomationRun(postgres.db, runId);
    expect(run).toMatchObject({
      status: "active",
      stepId: "check",
      phase: "ready",
      workUnitId: null,
    });
    expect(run.dueAt?.equals(at)).toBe(true);
    expect(run.stepEnteredAt.equals(at)).toBe(true);
    expect(await readAutomationRunTimeline(postgres.db, runId)).toEqual([
      { kind: "woke", stepId: "delay", at: at.toString(), detail: {} },
    ]);
  });

  test("a Calendar wait advances while it holds and otherwise waits for its next start", async () => {
    const holding = await automation(
      waitStep("monday", { _tag: "Calendar", expression: mondays })
    );
    const holdingRun = await seedAutomationRun(postgres.db, {
      ...holding,
      customerId: customer("calendar-holds"),
      stepId: "monday",
      phase: "ready",
      stepEnteredAt: at,
      dueAt: at,
    });
    const waiting = await automation(
      waitStep("tuesday", { _tag: "Calendar", expression: tuesdays })
    );
    const waitingRun = await seedAutomationRun(postgres.db, {
      ...waiting,
      customerId: customer("calendar-waits"),
      stepId: "tuesday",
      phase: "ready",
      stepEnteredAt: at,
      dueAt: at,
    });

    await plan();

    expect(await readAutomationRun(postgres.db, holdingRun)).toMatchObject({
      stepId: "send",
      phase: "ready",
    });
    const tuesday = await readAutomationRun(postgres.db, waitingRun);
    // Tuesday 00:00 Prague (CEST).
    const nextStart = Temporal.Instant.from("2026-10-19T22:00:00Z");
    expect(tuesday).toMatchObject({ stepId: "tuesday", phase: "waiting" });
    expect(tuesday.dueAt?.equals(nextStart)).toBe(true);
  });

  test("a due Calendar wait advances without rechecking the calendar (lateness rule)", async () => {
    const seeded = await automation(
      waitStep("tuesday", { _tag: "Calendar", expression: tuesdays })
    );
    const runId = await seedAutomationRun(postgres.db, {
      ...seeded,
      customerId: customer("calendar-late"),
      stepId: "tuesday",
      phase: "waiting",
      stepEnteredAt: at.subtract({ hours: 7 * 24 }),
      // Last Tuesday's start; the planner is days late and it's Monday now.
      dueAt: Temporal.Instant.from("2026-10-12T22:00:00Z"),
    });

    await plan();

    expect(await readAutomationRun(postgres.db, runId)).toMatchObject({
      stepId: "send",
      phase: "ready",
    });
  });

  test("a calendar that never occurs again ends the run failed (evaluation unavailable)", async () => {
    const seeded = await automation(
      waitStep("never", { _tag: "Calendar", expression: never })
    );
    const runId = await seedAutomationRun(postgres.db, {
      ...seeded,
      customerId: customer("calendar-never"),
      stepId: "never",
      phase: "ready",
      stepEnteredAt: at,
      dueAt: at,
    });

    await plan();

    expect(await readAutomationRun(postgres.db, runId)).toMatchObject({
      status: "ended",
      outcome: "failed",
      outcomeReason: "evaluation-unavailable",
      phase: null,
      dueAt: null,
    });
    expect(await readAutomationRunTimeline(postgres.db, runId)).toEqual([
      {
        kind: "failed",
        stepId: "never",
        at: at.toString(),
        detail: { reason: "evaluation-unavailable" },
      },
    ]);
  });

  test("a run whose version flow no longer decodes ends failed instead of moving", async () => {
    const campaignId = await seedAutomatedCampaign(postgres.db, {
      purpose: "marketing",
    });
    campaignIds.push(campaignId);
    // The placeholder flow has no steps, so it doesn't decode.
    const versionId = await seedAutomationVersion(postgres.db, {
      campaignId,
      purpose: "marketing",
      activatedAt,
    });
    await seedAutomation(postgres.db, {
      campaignId,
      activeVersionId: versionId,
    });
    const runId = await seedAutomationRun(postgres.db, {
      campaignId,
      versionId,
      customerId: customer("undecodable"),
      stepId: "delay",
      phase: "waiting",
      stepEnteredAt: at.subtract({ hours: 1 * 24 }),
      dueAt: at,
    });

    const summary = await plan();

    expect(summary.ended).toBeGreaterThanOrEqual(1);
    expect(await readAutomationRun(postgres.db, runId)).toMatchObject({
      status: "ended",
      outcome: "failed",
      outcomeReason: "evaluation-unavailable",
    });
  });

  test("a deferred send-step run wakes back to ready at its send step", async () => {
    const seeded = await automation(waitStep("delay", oneDay));
    const enteredAt = at.subtract({ hours: 1 });
    const runId = await seedAutomationRun(postgres.db, {
      ...seeded,
      customerId: customer("deferred"),
      stepId: "send",
      phase: "waiting",
      stepEnteredAt: enteredAt,
      dueAt: at.subtract({ minutes: 1 }),
    });

    await plan();

    const run = await readAutomationRun(postgres.db, runId);
    expect(run).toMatchObject({
      status: "active",
      stepId: "send",
      phase: "ready",
    });
    expect(run.dueAt?.equals(at)).toBe(true);
    expect(run.stepEnteredAt.equals(enteredAt)).toBe(true);
    expect(await readAutomationRunTimeline(postgres.db, runId)).toEqual([
      { kind: "woke", stepId: "send", at: at.toString(), detail: {} },
    ]);
  });

  test("ready runs at Condition and Send steps are left to their unit planners", async () => {
    const seeded = await automation(conditionStep("check", everyone));
    const atCondition = await seedAutomationRun(postgres.db, {
      ...seeded,
      customerId: customer("ready-condition"),
      stepId: "check",
      phase: "ready",
      stepEnteredAt: at.subtract({ minutes: 3 }),
      dueAt: at.subtract({ minutes: 3 }),
    });
    const atSend = await seedAutomationRun(postgres.db, {
      ...seeded,
      customerId: customer("ready-send"),
      stepId: "send",
      phase: "ready",
      stepEnteredAt: at.subtract({ minutes: 3 }),
      dueAt: at.subtract({ minutes: 3 }),
    });

    await plan();

    for (const runId of [atCondition, atSend]) {
      const run = await readAutomationRun(postgres.db, runId);
      expect(run.phase).toBe("ready");
      expect(run.updatedAt.equals(run.startedAt)).toBe(true);
      expect(await readAutomationRunTimeline(postgres.db, runId)).toEqual([]);
    }
  });

  test("a paused automation's timers skip, so its runs stay frozen", async () => {
    const seeded = await automation(waitStep("delay", oneDay));
    const runId = await seedAutomationRun(postgres.db, {
      ...seeded,
      customerId: customer("paused"),
      stepId: "delay",
      phase: "waiting",
      stepEnteredAt: at.subtract({ hours: 2 * 24 }),
      dueAt: at.subtract({ hours: 1 * 24 }),
    });
    await setAutomationLifecycle(postgres.db, seeded.campaignId, {
      status: "paused",
      at: at.subtract({ hours: 25 }),
    });

    await plan();

    expect(await readAutomationRun(postgres.db, runId)).toMatchObject({
      status: "active",
      stepId: "delay",
      phase: "waiting",
    });
    expect(await readAutomationRunTimeline(postgres.db, runId)).toEqual([]);
  });

  describe("after a resume (D12)", () => {
    const pausedAt = at.subtract({ hours: 3 * 24 });
    const resumedAt = at.subtract({ minutes: 10 });

    const resumed = async (...steps: Parameters<typeof automationFlowOf>) => {
      const seeded = await automation(...steps);
      await setAutomationLifecycle(postgres.db, seeded.campaignId, {
        status: "paused",
        at: pausedAt,
      });
      await setAutomationLifecycle(postgres.db, seeded.campaignId, {
        status: "active",
        resumedAt,
      });
      return seeded;
    };

    test("a Duration wait the pause overshot proceeds at once", async () => {
      const seeded = await resumed(waitStep("delay", oneDay));
      const runId = await seedAutomationRun(postgres.db, {
        ...seeded,
        customerId: customer("overshot-duration"),
        stepId: "delay",
        phase: "waiting",
        stepEnteredAt: pausedAt.subtract({ hours: 1 }),
        dueAt: pausedAt.add({ hours: 23 }),
      });

      await plan();

      expect(await readAutomationRun(postgres.db, runId)).toMatchObject({
        stepId: "send",
        phase: "ready",
      });
    });

    test("a Calendar wait the pause overshot is re-evaluated: waits again when it no longer holds", async () => {
      const seeded = await resumed(
        waitStep("tuesday", { _tag: "Calendar", expression: tuesdays })
      );
      const runId = await seedAutomationRun(postgres.db, {
        ...seeded,
        customerId: customer("overshot-calendar-waits"),
        stepId: "tuesday",
        phase: "waiting",
        stepEnteredAt: pausedAt.subtract({ hours: 1 * 24 }),
        // Last Tuesday's start, during the pause.
        dueAt: Temporal.Instant.from("2026-10-12T22:00:00Z"),
      });
      expect(
        Temporal.Instant.compare(
          Temporal.Instant.from("2026-10-12T22:00:00Z"),
          resumedAt
        )
      ).toBe(-1);

      await plan();

      const run = await readAutomationRun(postgres.db, runId);
      const nextStart = Temporal.Instant.from("2026-10-19T22:00:00Z");
      expect(run).toMatchObject({ stepId: "tuesday", phase: "waiting" });
      expect(run.dueAt?.equals(nextStart)).toBe(true);
      expect(await readAutomationRunTimeline(postgres.db, runId)).toEqual([
        {
          kind: "waiting",
          stepId: "tuesday",
          at: at.toString(),
          detail: { dueAt: detailInstant(nextStart) },
        },
      ]);
    });

    test("a Calendar wait the pause overshot advances when it holds again", async () => {
      const seeded = await resumed(
        waitStep("monday", { _tag: "Calendar", expression: mondays })
      );
      const runId = await seedAutomationRun(postgres.db, {
        ...seeded,
        customerId: customer("overshot-calendar-holds"),
        stepId: "monday",
        phase: "waiting",
        stepEnteredAt: pausedAt.subtract({ hours: 1 * 24 }),
        dueAt: pausedAt.add({ hours: 1 }),
      });

      await plan();

      expect(await readAutomationRun(postgres.db, runId)).toMatchObject({
        stepId: "send",
        phase: "ready",
      });
    });
  });

  test("planning again moves nothing twice", async () => {
    const seeded = await automation(waitStep("delay", oneDay));
    const runId = await seedAutomationRun(postgres.db, {
      ...seeded,
      customerId: customer("idempotent"),
      stepId: "delay",
      phase: "ready",
      stepEnteredAt: at,
      dueAt: at,
    });

    await plan();
    await plan();

    expect(await readAutomationRunTimeline(postgres.db, runId)).toHaveLength(1);
  });
});
