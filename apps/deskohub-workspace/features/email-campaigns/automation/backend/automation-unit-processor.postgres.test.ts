import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { eq, inArray } from "drizzle-orm";
import { Cause, Effect, Exit, Fiber, Layer, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import {
  emailCampaigns,
  emailCampaignAutomationWorkUnits as units,
} from "@/db/schema";
import {
  holdPostgresTransaction,
  waitForAdvisoryLockWaiter,
} from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  campaignContentFixture,
  deleteAutomatedCampaigns,
  deleteCampaigns,
  seedAutomatedCampaign,
  seedAutomatedSend,
  seedAutomationVersion,
} from "../../backend/email-campaigns.test-utils";
import type { CampaignId } from "../../campaign-identifiers";
import type {
  AutomationRunId,
  AutomationWorkUnitId,
} from "../automation-identifiers";
import { automationWorkUnitKinds } from "../automation-work-units";
import { AutomationConditionPlanning } from "./automation-condition-planning.service";
import {
  automationEngineTestLayer,
  seedAutomationUnit,
  testUnitHandler,
} from "./automation-engine.test-utils";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import { AutomationPlanner } from "./automation-planner.service";
import {
  automationFlowOf,
  conditionStep,
  readAutomationRun,
  seedAutomationRun,
  seedFlowAutomation,
  testCustomerId,
} from "./automation-steps.test-utils";
import {
  AutomationUnitDefect,
  AutomationUnitFetchFailure,
  AutomationUnitRecheckFailed,
  registerAutomationUnitHandler,
} from "./automation-unit-handler";
import {
  type AutomationUnitOutcome,
  AutomationUnitProcessor,
} from "./automation-unit-processor.service";
import {
  drainAutomationUnitQueue,
  makeAutomationUnitQueueFake,
} from "./automation-unit-queue.test-utils";

/**
 * Settling a unit promotes planned units of any automation into free slots,
 * so the suite runs on a database of its own.
 */
const database = await createWorkspacePostgresSuiteDatabase(
  "automation_unit_processor"
);
afterAll(() => database?.close());
const startedAt = Temporal.Instant.from("2026-10-19T10:00:00Z");

type EngineLayer = ReturnType<typeof automationEngineTestLayer>;
type Engine = Layer.Success<EngineLayer>;

const atInstant = <A, E>(
  effect: Effect.Effect<A, E, Engine>,
  layer: EngineLayer,
  at: Temporal.Instant
) =>
  TestClock.setTime(at.epochMilliseconds).pipe(
    Effect.andThen(effect),
    Effect.provide(layer),
    Effect.provide(TestClock.layer())
  );

const run = <A, E>(
  effect: Effect.Effect<A, E, Engine>,
  layer: EngineLayer,
  at = startedAt
) => Effect.runPromise(atInstant(effect, layer, at));

const runExit = <A, E>(
  effect: Effect.Effect<A, E, Engine>,
  layer: EngineLayer,
  at = startedAt
) => Effect.runPromiseExit(atInstant(effect, layer, at));

const processUnit = (unitId: AutomationWorkUnitId) =>
  Effect.flatMap(AutomationUnitProcessor, (processor) =>
    processor.process(unitId)
  );

const plan = Effect.flatMap(AutomationPlanner, (planner) => planner.plan);

/** A fetch that waits for `release` and reports when it started. */
const makeGate = () => {
  const started = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  return {
    fetch: Effect.promise(() => {
      started.resolve();
      return released.promise;
    }),
    started: started.promise,
    release: () => released.resolve(),
  };
};

describe.skipIf(!database)("automation unit processor", () => {
  const postgres = database!;
  const campaignIds: Array<CampaignId> = [];

  const seed = (input: Parameters<typeof seedAutomationUnit>[1]) =>
    Effect.runPromise(seedAutomationUnit(postgres.db, input));

  const readUnit = async (unitId: AutomationWorkUnitId) => {
    const [unit] = await Effect.runPromise(
      postgres.db.select().from(units).where(eq(units.id, unitId))
    );
    return unit!;
  };

  const statuses = async (unitIds: ReadonlyArray<AutomationWorkUnitId>) => {
    const rows = await Effect.runPromise(
      postgres.db
        .select({ id: units.id, status: units.status })
        .from(units)
        .where(inArray(units.id, [...unitIds]))
    );
    return unitIds.map((id) => rows.find((row) => row.id === id)?.status);
  };

  const seedCampaign = async () => {
    const [campaign] = await Effect.runPromise(
      postgres.db
        .insert(emailCampaigns)
        .values({
          title: "Automation slots",
          purpose: "marketing",
          templateKey: "workspace",
          content: campaignContentFixture(),
          status: "draft",
        })
        .returning({ id: emailCampaigns.id })
    );
    campaignIds.push(campaign!.id);
    return campaign!.id;
  };

  beforeEach(async () => {
    await postgres.pool.query(
      "delete from email_campaign_automation_work_units"
    );
  });

  afterAll(async () => {
    await postgres.pool.query(
      "delete from email_campaign_automation_work_units"
    );
    await deleteCampaigns(postgres.pool, campaignIds);
    await deleteAutomatedCampaigns(postgres.db, automatedCampaignIds);
  });

  const automatedCampaignIds: Array<CampaignId> = [];

  /** A deliver unit whose batch an earlier invocation persisted. */
  const seedPersistedUnit = async (
    input: Pick<
      Parameters<typeof seedAutomationUnit>[1],
      "status" | "cancelRequestedAt" | "claimId" | "claimExpiresAt"
    >
  ) => {
    const campaignId = await seedAutomatedCampaign(postgres.db, {
      purpose: "operational",
    });
    automatedCampaignIds.push(campaignId);
    const versionId = await seedAutomationVersion(postgres.db, {
      campaignId,
      purpose: "operational",
    });
    const sendId = await seedAutomatedSend(postgres.db, {
      campaignId,
      versionId,
      purpose: "operational",
      recipients: [],
    });
    const unit = await seed({ kind: "deliver", campaignId, ...input });
    await Effect.runPromise(
      postgres.db.update(units).set({ sendId }).where(eq(units.id, unit.id))
    );
    return { unit, sendId };
  };

  /** A deliver handler whose submit `submit` scripts, recording its calls. */
  const persistingHandler = (options: {
    readonly submit?: () => Effect.Effect<void, AutomationUnitDefect>;
  }) => {
    const submitted: Array<{ sendId: string; fetched: boolean }> = [];
    const handler = registerAutomationUnitHandler({
      kind: "deliver",
      subject: Schema.Struct({ label: Schema.String }),
      fetch: () => Effect.die("a persisted unit is never fetched"),
      commit: () => Effect.succeed([]),
      submit: (unit, fetched) =>
        Effect.sync(() =>
          submitted.push({
            sendId: unit.sendId,
            fetched: Option.isSome(fetched),
          })
        ).pipe(
          Effect.andThen(options.submit?.() ?? Effect.void),
          Effect.as(() => Effect.void)
        ),
    });
    return { handler, submitted };
  };

  test("a duplicate delivery acknowledges without work", async () => {
    let fetches = 0;
    const gate = makeGate();
    const queue = makeAutomationUnitQueueFake();
    const layer = automationEngineTestLayer({
      database: postgres,
      queue,
      handlers: [
        testUnitHandler("intake", {
          fetch: (unit) =>
            Effect.sync(() => {
              fetches += 1;
            }).pipe(
              Effect.andThen(
                unit.subject.label === "gated" ? gate.fetch : Effect.void
              )
            ),
        }),
      ],
    });

    const settled = await seed({ kind: "intake", status: "enqueued" });
    expect(await run(processUnit(settled.id), layer)).toBe("done");
    expect(await run(processUnit(settled.id), layer)).toBe("acknowledged");

    const live = await seed({
      kind: "intake",
      status: "enqueued",
      key: "gated",
    });
    const first = run(processUnit(live.id), layer);
    await gate.started;
    expect(await run(processUnit(live.id), layer)).toBe("acknowledged");
    gate.release();
    expect(await first).toBe("done");

    expect(fetches).toBe(2);
    expect((await readUnit(settled.id)).attempts).toBe(1);
    expect((await readUnit(live.id)).attempts).toBe(1);
  });

  test("a failed fetch requeues the unit holding its slot and throws", async () => {
    let failures = 1;
    const queue = makeAutomationUnitQueueFake();
    const layer = automationEngineTestLayer({
      database: postgres,
      queue,
      limits: { total: 1, deliver: 1 },
      handlers: [
        testUnitHandler("intake", {
          fetch: () =>
            failures-- > 0
              ? Effect.fail(
                  new AutomationUnitFetchFailure({ code: "dotypos-429" })
                )
              : Effect.void,
        }),
      ],
    });
    const failing = await seed({
      kind: "intake",
      status: "enqueued",
      enqueuedAt: startedAt.subtract({ minutes: 1 }),
    });
    const waiting = await seed({ kind: "intake", status: "planned" });

    const exit = await runExit(processUnit(failing.id), layer);
    expect(Exit.isFailure(exit)).toBe(true);
    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({
      _tag: "AutomationUnitRedelivery",
      code: "dotypos-429",
    });
    expect(await readUnit(failing.id)).toMatchObject({
      status: "enqueued",
      claimId: null,
      lastErrorCode: "dotypos-429",
      attempts: 1,
    });
    expect((await readUnit(failing.id)).enqueuedAt?.equals(startedAt)).toBe(
      true
    );

    await run(plan, layer, startedAt.add({ seconds: 30 }));
    expect(await statuses([waiting.id])).toEqual(["planned"]);

    expect(
      await run(processUnit(failing.id), layer, startedAt.add({ minutes: 1 }))
    ).toBe("done");
    expect(await statuses([waiting.id])).toEqual(["enqueued"]);
    expect(queue.published().map((message) => message.unitId)).toEqual([
      waiting.id,
    ]);
  });

  test("a deadline miss requeues the unit and counts the miss", async () => {
    const gate = makeGate();
    const queue = makeAutomationUnitQueueFake();
    const layer = automationEngineTestLayer({
      database: postgres,
      queue,
      handlers: [testUnitHandler("intake", { fetch: () => gate.fetch })],
    });
    const unit = await seed({ kind: "intake", status: "enqueued" });

    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(startedAt.epochMilliseconds);
        const fiber = yield* Effect.forkChild(processUnit(unit.id));
        yield* Effect.promise(() => gate.started);
        yield* TestClock.adjust("270 seconds");
        return yield* Fiber.await(fiber);
      }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer()))
    );

    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({
      _tag: "AutomationUnitRedelivery",
      code: "deadline",
    });
    expect(await readUnit(unit.id)).toMatchObject({
      status: "enqueued",
      deadlineMisses: 1,
      lastErrorCode: "deadline",
    });
  });

  test("a unit whose subjects all expired settles done without fetching", async () => {
    let fetches = 0;
    const queue = makeAutomationUnitQueueFake();
    const layer = automationEngineTestLayer({
      database: postgres,
      queue,
      handlers: [
        testUnitHandler("condition", {
          expire: (unit) =>
            Effect.succeed(
              unit.subject.label === "expired" ? "settled" : "remaining"
            ),
          fetch: () =>
            Effect.sync(() => {
              fetches += 1;
            }),
        }),
      ],
    });
    const expired = await seed({
      kind: "condition",
      status: "enqueued",
      key: "expired",
    });
    const remaining = await seed({ kind: "condition", status: "enqueued" });

    expect(await run(processUnit(expired.id), layer)).toBe("done");
    expect(fetches).toBe(0);
    expect(await run(processUnit(remaining.id), layer)).toBe("done");
    expect(fetches).toBe(1);
  });

  test("an expiry that loses its claim to a mark settles dropped", async () => {
    let fetches = 0;
    const queue = makeAutomationUnitQueueFake();
    const layer = automationEngineTestLayer({
      database: postgres,
      queue,
      handlers: [
        testUnitHandler("condition", {
          // Pause marks the unit, on its own connection, while its subjects expire.
          expire: (unit) =>
            Effect.promise(() =>
              postgres.pool.query(
                "update email_campaign_automation_work_units set cancel_requested_at = now() where id = $1",
                [unit.id]
              )
            ).pipe(Effect.as("settled" as const)),
          fetch: () =>
            Effect.sync(() => {
              fetches += 1;
            }),
        }),
      ],
    });
    const unit = await seed({ kind: "condition", status: "enqueued" });

    expect(await run(processUnit(unit.id), layer)).toBe("dropped");
    expect(fetches).toBe(0);
    expect((await readUnit(unit.id)).status).toBe("dropped");
  });

  test("a failed lifecycle recheck drops an unmarked unit", async () => {
    const queue = makeAutomationUnitQueueFake();
    const layer = automationEngineTestLayer({
      database: postgres,
      queue,
      handlers: [
        registerAutomationUnitHandler({
          kind: "condition",
          subject: Schema.Struct({ label: Schema.String }),
          fetch: () => Effect.void,
          commit: () =>
            Effect.fail(
              new AutomationUnitRecheckFailed({ code: "automation-paused" })
            ),
        }),
      ],
    });
    const unit = await seed({ kind: "condition", status: "enqueued" });

    expect(await run(processUnit(unit.id), layer)).toBe("dropped");
    expect(await readUnit(unit.id)).toMatchObject({
      status: "dropped",
      lastErrorCode: "automation-paused",
    });
  });

  test("a defect settles the unit failed and hands off its slot", async () => {
    const queue = makeAutomationUnitQueueFake();
    const layer = automationEngineTestLayer({
      database: postgres,
      queue,
      limits: { total: 1, deliver: 1 },
      handlers: [
        testUnitHandler("intake", {
          fetch: (unit) =>
            unit.subject.label === "broken"
              ? Effect.fail(new AutomationUnitDefect({ code: "flow-invalid" }))
              : Effect.void,
        }),
      ],
    });
    const broken = await seed({
      kind: "intake",
      status: "enqueued",
      key: "broken",
    });
    const next = await seed({ kind: "intake", status: "planned" });

    expect(await run(processUnit(broken.id), layer)).toBe("failed");
    expect(await readUnit(broken.id)).toMatchObject({
      status: "failed",
      lastErrorCode: "flow-invalid",
      claimId: null,
    });
    expect(await statuses([next.id])).toEqual(["enqueued"]);
  });

  test("a unit with a persisted send skips its mark and fetch, submits it and settles done with it", async () => {
    const { handler, submitted } = persistingHandler({});
    const layer = automationEngineTestLayer({
      database: postgres,
      queue: makeAutomationUnitQueueFake(),
      handlers: [handler],
    });
    // Lifecycle never marks such a unit; a mark must not drop it anyway.
    const { unit, sendId } = await seedPersistedUnit({
      status: "enqueued",
      cancelRequestedAt: startedAt,
    });

    expect(await run(processUnit(unit.id), layer)).toBe("done");
    expect(submitted).toEqual([{ sendId, fetched: false }]);
    expect(await readUnit(unit.id)).toMatchObject({ status: "done", sendId });
  });

  test("the reaper requeues a marked unit with a persisted send instead of dropping it", async () => {
    const { handler } = persistingHandler({});
    const queue = makeAutomationUnitQueueFake();
    const layer = automationEngineTestLayer({
      database: postgres,
      queue,
      handlers: [handler],
    });
    const crashed = await seedPersistedUnit({
      status: "claimed",
      claimId: "dead-consumer",
      claimExpiresAt: startedAt.subtract({ seconds: 1 }),
      cancelRequestedAt: startedAt,
    });
    const lost = await seedPersistedUnit({
      status: "enqueued",
      cancelRequestedAt: startedAt,
    });
    await Effect.runPromise(
      postgres.db
        .update(units)
        .set({ enqueuedAt: startedAt.subtract({ minutes: 11 }) })
        .where(eq(units.id, lost.unit.id))
    );

    const summary = await run(plan, layer);
    expect(summary.reaped).toMatchObject({
      dropped: 0,
      requeued: 1,
      resent: 1,
    });
    expect(await statuses([crashed.unit.id, lost.unit.id])).toEqual([
      "enqueued",
      "enqueued",
    ]);
    expect(await run(processUnit(crashed.unit.id), layer)).toBe("done");
  });

  test("a persisted unit whose submit fails or is defective requeues, marked or not", async () => {
    let failures = 2;
    const { handler } = persistingHandler({
      submit: () =>
        failures-- > 0
          ? Effect.fail(new AutomationUnitDefect({ code: "test-defect" }))
          : Effect.void,
    });
    const layer = automationEngineTestLayer({
      database: postgres,
      queue: makeAutomationUnitQueueFake(),
      handlers: [handler],
    });
    const { unit } = await seedPersistedUnit({
      status: "enqueued",
      cancelRequestedAt: startedAt,
    });

    const exit = await runExit(processUnit(unit.id), layer);
    expect(Exit.isFailure(exit)).toBe(true);
    expect(await readUnit(unit.id)).toMatchObject({
      status: "enqueued",
      lastErrorCode: "test-defect",
      failures: 0,
    });
    expect(Exit.isFailure(await runExit(processUnit(unit.id), layer))).toBe(
      true
    );
    expect(await run(processUnit(unit.id), layer)).toBe("done");
  });

  test("a commit that persists a send keeps the unit claimed and submits it with this invocation's facts", async () => {
    const submitted: Array<{ sendId: string; fetched: boolean }> = [];
    const { unit, sendId } = await seedPersistedUnit({ status: "enqueued" });
    // Not yet persisted: the commit sets `send_id`, as a deliver commit does.
    await Effect.runPromise(
      postgres.db
        .update(units)
        .set({ sendId: null })
        .where(eq(units.id, unit.id))
    );
    const persistingCommit = registerAutomationUnitHandler({
      kind: "deliver",
      subject: Schema.Struct({ label: Schema.String }),
      fetch: () => Effect.succeed("fetched"),
      commit: (tx, claimed) =>
        tx
          .update(units)
          .set({ sendId })
          .where(eq(units.id, claimed.id))
          .pipe(Effect.as([])),
      submit: (persisted, fetched) =>
        Effect.sync(() =>
          submitted.push({
            sendId: persisted.sendId,
            fetched: Option.contains(fetched, "fetched"),
          })
        ).pipe(Effect.as(() => Effect.void)),
    });

    expect(
      await run(
        processUnit(unit.id),
        automationEngineTestLayer({
          database: postgres,
          queue: makeAutomationUnitQueueFake(),
          handlers: [persistingCommit],
        })
      )
    ).toBe("done");
    expect(submitted).toEqual([{ sendId, fetched: true }]);
    expect(await readUnit(unit.id)).toMatchObject({ status: "done", sendId });
  });

  test("a stale claimant writes nothing after a reap", async () => {
    const gate = makeGate();
    const queue = makeAutomationUnitQueueFake();
    const layer = automationEngineTestLayer({
      database: postgres,
      queue,
      handlers: [
        testUnitHandler("intake", {
          fetch: (unit) => (unit.attempt === 1 ? gate.fetch : Effect.void),
          followUps: (unit) =>
            unit.subject.label === "origin"
              ? [
                  {
                    kind: "intake",
                    key: `follow-up:${unit.attempt}`,
                    subject: { label: `follow-up:${unit.attempt}` },
                    requestCost: 1,
                  },
                ]
              : [],
        }),
      ],
    });
    const unit = await seed({
      kind: "intake",
      status: "enqueued",
      key: "origin",
    });

    const stale = run(processUnit(unit.id), layer);
    await gate.started;

    const reapedAt = startedAt.add({ seconds: 331 });
    const summary = await run(plan, layer, reapedAt);
    expect(summary.reaped.requeued).toBe(1);
    expect(queue.published()).toEqual([
      {
        unitId: unit.id,
        idempotencyKey: `email-automation-unit:${unit.id}:1`,
      },
    ]);
    expect(await run(processUnit(unit.id), layer, reapedAt)).toBe("done");

    gate.release();
    expect(await stale).toBe("acknowledged");

    const keys = await Effect.runPromise(
      postgres.db.select({ key: units.key }).from(units)
    );
    expect(keys.map((row) => row.key).toSorted()).toEqual([
      "follow-up:2",
      "origin",
    ]);
    expect(await readUnit(unit.id)).toMatchObject({
      status: "done",
      attempts: 2,
    });
  });

  test("a kind outside the allowlist is never claimed, promoted or reaped", async () => {
    const queue = makeAutomationUnitQueueFake();
    const layer = automationEngineTestLayer({
      database: postgres,
      queue,
      handlers: [testUnitHandler("intake")],
    });
    const enqueued = await seed({
      kind: "test-only",
      status: "enqueued",
      enqueuedAt: startedAt,
    });
    const planned = await seed({ kind: "test-only", status: "planned" });
    const expiredClaim = await seed({
      kind: "test-only",
      status: "claimed",
      claimId: "elsewhere",
      claimExpiresAt: startedAt.subtract({ minutes: 1 }),
    });
    const lostMessage = await seed({
      kind: "test-only",
      status: "enqueued",
      enqueuedAt: startedAt.subtract({ minutes: 30 }),
    });

    expect(await run(processUnit(enqueued.id), layer)).toBe("acknowledged");
    await run(plan, layer);

    expect(await readUnit(enqueued.id)).toMatchObject({
      status: "enqueued",
      attempts: 0,
    });
    expect(await readUnit(planned.id)).toMatchObject({ status: "planned" });
    expect(await readUnit(expiredClaim.id)).toMatchObject({
      status: "claimed",
      claimId: "elsewhere",
    });
    expect(await readUnit(lostMessage.id)).toMatchObject({
      status: "enqueued",
      enqueueGeneration: 0,
    });
    expect(queue.published()).toEqual([]);
  });

  test("a marked unit keeps its slot until its claimant settles it", async () => {
    const gate = makeGate();
    const queue = makeAutomationUnitQueueFake();
    const layer = automationEngineTestLayer({
      database: postgres,
      queue,
      limits: { total: 1, deliver: 1 },
      handlers: [testUnitHandler("intake", { fetch: () => gate.fetch })],
    });
    const marked = await seed({ kind: "intake", status: "enqueued" });
    const next = await seed({ kind: "intake", status: "planned" });

    const claimant = run(processUnit(marked.id), layer);
    await gate.started;
    await postgres.pool.query(
      "update email_campaign_automation_work_units set cancel_requested_at = $2 where id = $1",
      [marked.id, startedAt.toString()]
    );

    await run(plan, layer, startedAt.add({ seconds: 10 }));
    expect(await statuses([marked.id, next.id])).toEqual([
      "claimed",
      "planned",
    ]);

    gate.release();
    expect(await claimant).toBe("dropped");
    expect(await statuses([marked.id, next.id])).toEqual([
      "dropped",
      "enqueued",
    ]);
  });

  test("a marked unit keeps its slot until its claim expires", async () => {
    const queue = makeAutomationUnitQueueFake();
    const layer = automationEngineTestLayer({
      database: postgres,
      queue,
      limits: { total: 1, deliver: 1 },
      handlers: [testUnitHandler("intake")],
    });
    const marked = await seed({
      kind: "intake",
      status: "claimed",
      claimId: "crashed",
      claimExpiresAt: startedAt.add({ seconds: 330 }),
      cancelRequestedAt: startedAt,
    });
    const next = await seed({ kind: "intake", status: "planned" });

    await run(plan, layer, startedAt.add({ seconds: 100 }));
    expect(await statuses([marked.id, next.id])).toEqual([
      "claimed",
      "planned",
    ]);

    await run(plan, layer, startedAt.add({ seconds: 330 }));
    expect(await statuses([marked.id, next.id])).toEqual([
      "dropped",
      "enqueued",
    ]);
  });

  test("a unit marked before its claim settles dropped at once", async () => {
    let fetches = 0;
    const queue = makeAutomationUnitQueueFake();
    const layer = automationEngineTestLayer({
      database: postgres,
      queue,
      handlers: [
        testUnitHandler("intake", {
          fetch: () =>
            Effect.sync(() => {
              fetches += 1;
            }),
        }),
      ],
    });
    const marked = await seed({
      kind: "intake",
      status: "enqueued",
      cancelRequestedAt: startedAt,
    });

    expect(await run(processUnit(marked.id), layer)).toBe("dropped");
    expect(fetches).toBe(0);
  });

  test("never more than K units or one deliver unit in flight", async () => {
    const queue = makeAutomationUnitQueueFake();
    const layer = automationEngineTestLayer({
      database: postgres,
      queue,
      handlers: [testUnitHandler("intake"), testUnitHandler("deliver")],
    });
    const settling = await Promise.all(
      Array.from({ length: 4 }, () =>
        seed({ kind: "intake", status: "enqueued" })
      )
    );
    await Promise.all([
      ...Array.from({ length: 3 }, () =>
        seed({ kind: "intake", status: "planned" })
      ),
      ...Array.from({ length: 5 }, () =>
        seed({ kind: "deliver", status: "planned" })
      ),
    ]);

    const slotLock = await holdPostgresTransaction(
      postgres.pool,
      "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      ["email-automation-unit-slots", "engine"]
    );
    const handOffs = Promise.all([
      ...settling.map((unit) => run(processUnit(unit.id), layer)),
      run(plan, layer),
    ]);
    await waitForAdvisoryLockWaiter(postgres.pool, [
      "email-automation-unit-slots",
      "engine",
    ]);
    await slotLock.commit();
    const outcomes = await handOffs;

    expect(outcomes.slice(0, 4)).toEqual(["done", "done", "done", "done"]);
    const inFlight = await postgres.pool.query<{ kind: string }>(
      "select kind from email_campaign_automation_work_units where status in ('enqueued', 'claimed')"
    );
    expect(inFlight.rows.map((row) => row.kind).toSorted()).toEqual([
      "deliver",
      "intake",
      "intake",
      "intake",
    ]);
  });

  test("hands slots off by priority, then age", async () => {
    const queue = makeAutomationUnitQueueFake();
    const layer = automationEngineTestLayer({
      database: postgres,
      queue,
      limits: { total: 1, deliver: 1 },
      handlers: automationWorkUnitKinds.map((kind) => testUnitHandler(kind)),
    });
    const running = await seed({ kind: "intake", status: "enqueued" });
    const ageOf = (minutes: number) => startedAt.subtract({ minutes });
    const fireChunk = await seed({
      kind: "fire-chunk",
      status: "planned",
      createdAt: ageOf(9),
    });
    const deliver = await seed({
      kind: "deliver",
      status: "planned",
      createdAt: ageOf(8),
    });
    const preview = await seed({
      kind: "preview",
      status: "planned",
      createdAt: ageOf(7),
    });
    const newerIntake = await seed({
      kind: "intake",
      status: "planned",
      createdAt: ageOf(2),
    });
    const olderIntake = await seed({
      kind: "intake",
      status: "planned",
      createdAt: ageOf(3),
    });
    const condition = await seed({
      kind: "condition",
      status: "planned",
      createdAt: ageOf(6),
    });
    const sweepPage = await seed({
      kind: "sweep-page",
      status: "planned",
      createdAt: ageOf(1),
    });

    queue.redeliver({ unitId: running.id, idempotencyKey: "seeded" });
    const deliveries = await run(drainAutomationUnitQueue(queue), layer);

    expect(deliveries.map((delivery) => delivery.unitId)).toEqual([
      running.id,
      sweepPage.id,
      olderIntake.id,
      newerIntake.id,
      deliver.id,
      condition.id,
      preview.id,
      fireChunk.id,
    ]);
    expect(
      deliveries.every(
        (delivery) =>
          delivery.outcome === ("done" satisfies AutomationUnitOutcome)
      )
    ).toBe(true);
  });

  test("hands a slot to the automation with the fewest units in flight", async () => {
    const queue = makeAutomationUnitQueueFake();
    const layer = automationEngineTestLayer({
      database: postgres,
      queue,
      limits: { total: 2, deliver: 1 },
      handlers: [testUnitHandler("intake"), testUnitHandler("condition")],
    });
    const busy = await seedCampaign();
    const idle = await seedCampaign();
    await seed({
      kind: "condition",
      status: "claimed",
      campaignId: busy,
      claimId: "running",
      claimExpiresAt: startedAt.add({ minutes: 5 }),
    });
    const settling = await seed({ kind: "intake", status: "enqueued" });
    const busyNext = await seed({
      kind: "condition",
      status: "planned",
      campaignId: busy,
      createdAt: startedAt.subtract({ minutes: 2 }),
    });
    const idleNext = await seed({
      kind: "condition",
      status: "planned",
      campaignId: idle,
      createdAt: startedAt.subtract({ minutes: 1 }),
    });

    expect(await run(processUnit(settling.id), layer)).toBe("done");
    expect(await statuses([busyNext.id, idleNext.id])).toEqual([
      "planned",
      "enqueued",
    ]);
  });
});

describe.skipIf(!database)(
  "settling a unit releases its runs for replanning",
  () => {
    const postgres = database!;
    const campaignIds: Array<CampaignId> = [];
    const customer = testCustomerId(
      `automation-release-${crypto.randomUUID()}`
    );
    /** A condition handler whose fetch or commit fails as the test says. */
    const failingConditionHandler = (failure: {
      readonly fetch?: AutomationUnitDefect;
      readonly commit?: AutomationUnitRecheckFailed;
    }) =>
      registerAutomationUnitHandler({
        kind: "condition",
        subject: Schema.Struct({ runIds: Schema.Array(Schema.String) }),
        fetch: () =>
          failure.fetch === undefined
            ? Effect.void
            : Effect.fail(failure.fetch),
        commit: () =>
          failure.commit === undefined
            ? Effect.succeed([])
            : Effect.fail(failure.commit),
      });

    const engine = (handler: ReturnType<typeof failingConditionHandler>) =>
      automationEngineTestLayer({
        database: postgres,
        queue: makeAutomationUnitQueueFake(),
        handlers: [handler],
        conditionPlanning: AutomationConditionPlanning.Default.pipe(
          Layer.provide(
            Layer.merge(
              postgres.layer,
              AutomationEvaluationFacts.Default.pipe(
                Layer.provide(
                  Layer.merge(postgres.layer, DotyposServiceMock({}))
                )
              )
            )
          )
        ),
      });

    /** A ready run at a condition step, owned by a seeded condition unit. */
    const ownedRun = async (
      label: string,
      unit: Omit<Parameters<typeof seedAutomationUnit>[1], "kind">
    ) => {
      const seeded = await seedFlowAutomation(postgres.db, {
        flow: automationFlowOf(
          conditionStep("check", {
            _tag: "Group",
            operator: "and",
            filters: [],
          })
        ),
        activatedAt: startedAt.subtract({ hours: 24 }),
      });
      campaignIds.push(seeded.campaignId);
      const owner = await Effect.runPromise(
        seedAutomationUnit(postgres.db, {
          ...unit,
          kind: "condition",
          campaignId: seeded.campaignId,
        })
      );
      const runId = await seedAutomationRun(postgres.db, {
        ...seeded,
        customerId: customer(label),
        stepId: "check",
        phase: "ready",
        stepEnteredAt: startedAt,
        dueAt: startedAt,
        workUnitId: owner.id,
      });
      await Effect.runPromise(
        postgres.db
          .update(units)
          .set({ subject: { label: owner.key, runIds: [runId] } })
          .where(eq(units.id, owner.id))
      );
      return { owner, runId };
    };

    /** The run's owner after planning, which must be a new condition unit. */
    const expectReplanned = async (
      runId: AutomationRunId,
      previous: AutomationWorkUnitId,
      layer: ReturnType<typeof engine>,
      at: Temporal.Instant
    ) => {
      const summary = await run(plan, layer, at);
      expect(summary.conditions.runsPlanned).toBeGreaterThanOrEqual(1);
      const { workUnitId } = await readAutomationRun(postgres.db, runId);
      expect(workUnitId).not.toBeNull();
      expect(workUnitId).not.toBe(previous);
    };

    beforeEach(async () => {
      await postgres.pool.query(
        "delete from email_campaign_automation_work_units"
      );
    });

    afterAll(async () => {
      await postgres.pool.query(
        "delete from email_campaign_automation_work_units"
      );
      await deleteAutomatedCampaigns(postgres.db, campaignIds);
    });

    test("a unit that settles failed frees its runs", async () => {
      const layer = engine(
        failingConditionHandler({
          fetch: new AutomationUnitDefect({ code: "test-defect" }),
        })
      );
      const { owner, runId } = await ownedRun("failed", { status: "enqueued" });

      expect(await run(processUnit(owner.id), layer)).toBe("failed");
      expect(
        (await readAutomationRun(postgres.db, runId)).workUnitId
      ).toBeNull();
      await expectReplanned(
        runId,
        owner.id,
        layer,
        startedAt.add({ minutes: 1 })
      );
    });

    test("a unit dropped by a failed recheck frees its runs", async () => {
      const layer = engine(
        failingConditionHandler({
          commit: new AutomationUnitRecheckFailed({
            code: "automation-paused",
          }),
        })
      );
      const { owner, runId } = await ownedRun("dropped", {
        status: "enqueued",
      });

      expect(await run(processUnit(owner.id), layer)).toBe("dropped");
      expect(
        (await readAutomationRun(postgres.db, runId)).workUnitId
      ).toBeNull();
      await expectReplanned(
        runId,
        owner.id,
        layer,
        startedAt.add({ minutes: 1 })
      );
    });

    test("the reaper's drop of a marked unit frees its runs, and the same planner run replans them", async () => {
      const layer = engine(failingConditionHandler({}));
      const { owner, runId } = await ownedRun("reaped", {
        status: "enqueued",
        enqueuedAt: startedAt,
        cancelRequestedAt: startedAt,
      });

      await expectReplanned(
        runId,
        owner.id,
        layer,
        startedAt.add({ minutes: 1 })
      );
      expect((await readUnit(owner.id)).status).toBe("dropped");
    });

    const readUnit = async (unitId: AutomationWorkUnitId) => {
      const [unit] = await Effect.runPromise(
        postgres.db.select().from(units).where(eq(units.id, unitId))
      );
      return unit!;
    };
  }
);
