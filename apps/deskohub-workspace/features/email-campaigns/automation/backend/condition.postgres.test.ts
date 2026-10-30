import { seededCustomerReads } from "@deskohub/dotypos/backend/service.mock";
import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposUnavailable,
} from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import type { AutomationConditionFilter } from "@deskohub/workspace-admin-api";
import { eq, inArray } from "drizzle-orm";
import { Effect, Layer, Result } from "effect";
import { TestClock } from "effect/testing";
import {
  emailCampaignAudiences,
  emailCampaignAutomationWorkUnits as units,
} from "@/db/schema";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { canonicalJson } from "@/shared/utils/canonical-json";
import type { AudienceCondition, AudienceFilter } from "../../audience-filter";
import { AudienceFactsService } from "../../backend/audience-facts.service";
import { CampaignCandidateRepository } from "../../backend/campaign-candidate.repository";
import { deleteAutomatedCampaigns } from "../../backend/email-campaigns.test-utils";
import type {
  CampaignAudienceId,
  CampaignId,
} from "../../campaign-identifiers";
import type {
  AutomationRunId,
  AutomationWorkUnitId,
} from "../automation-identifiers";
import { AutomationConditionEvaluation } from "./automation-condition-evaluation.service";
import { AutomationConditionPlanning } from "./automation-condition-planning.service";
import { automationEngineTestLayer } from "./automation-engine.test-utils";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import { AutomationPlanner } from "./automation-planner.service";
import { maxChainedSteps } from "./automation-reached-step";
import {
  automationFlowOf,
  conditionStep,
  deleteKnownCustomers,
  readAutomationRun,
  readAutomationRunTimeline,
  seedAutomationRun,
  seedFlowAutomation,
  seedKnownCustomers,
  setAutomationLifecycle,
  testCustomerId,
  waitStep,
} from "./automation-steps.test-utils";
import { AutomationUnitProcessor } from "./automation-unit-processor.service";
import {
  drainAutomationUnitQueue,
  makeAutomationUnitQueueFake,
} from "./automation-unit-queue.test-utils";
import { makeConditionHandler } from "./condition";

/**
 * The engine plans over whole tables, so the suite runs on a database of
 * its own.
 */
const database = await createWorkspacePostgresSuiteDatabase(
  "automation_condition"
);
afterAll(() => database?.close());
const customer = testCustomerId(
  `automation-condition-unit-${crypto.randomUUID()}`
);
const at = Temporal.Instant.from("2026-10-19T10:00:00Z");
const activatedAt = Temporal.Instant.from("2026-10-01T00:00:00Z");

const oneDay = { _tag: "Duration", count: 1, unit: "day" } as const;

const locale = (value: "cs-CZ" | "en-US") =>
  ({
    _tag: "Condition",
    attribute: "locale",
    operator: "anyOf",
    value: [value],
  }) as const satisfies AudienceCondition;

const noAccount = {
  _tag: "Condition",
  attribute: "hasAccount",
  operator: "is",
  value: false,
} as const satisfies AudienceCondition;

const taggedVip = {
  _tag: "Condition",
  attribute: "dotyposTags",
  operator: "anyOf",
  value: ["vip"],
} as const satisfies AudienceCondition;

const all = (
  ...filters: readonly AutomationConditionFilter[]
): AutomationConditionFilter => ({ _tag: "Group", operator: "and", filters });

const inAudience = (
  audienceId: CampaignAudienceId
): AutomationConditionFilter => ({
  _tag: "InAudience",
  audienceId,
  operator: "in",
});

const audienceOf = (condition: AudienceCondition): AudienceFilter => ({
  _tag: "Group",
  operator: "and",
  filters: [condition],
});

const filterHash = (filter: AudienceFilter) =>
  createHash("sha256").update(canonicalJson(filter)).digest("hex");

const profile = (id: DotyposCustomerId, tags: readonly string[]) =>
  ({
    id,
    _cloudId: "automation-condition-unit-cloud",
    firstName: "Test",
    points: "0",
    flags: "0",
    display: true,
    deleted: false,
    tags,
  }) as DotyposCustomer;

describe.skipIf(!database)("condition units on Postgres", () => {
  if (!database) return;
  const campaignIds: CampaignId[] = [];
  const customerIds: DotyposCustomerId[] = [];
  const audienceIds: CampaignAudienceId[] = [];
  const dotypos = {
    failing: false,
    profiles: [] as DotyposCustomer[],
    profilePages: 0,
  };

  const dotyposLayer = DotyposServiceMock({
    getCustomersByIds: (ids) => {
      dotypos.profilePages += 1;
      const wanted = new Set<string>(ids);
      return (
        dotypos.failing
          ? Effect.fail(
              new DotyposUnavailable({
                operation: "getCustomersByIds",
                reason: "transport",
              })
            )
          : Effect.succeed(
              dotypos.profiles.filter(
                ({ id }) => id !== undefined && wanted.has(id)
              )
            )
      ).pipe(
        Effect.flatMap((records) =>
          seededCustomerReads(records).getCustomersByIds(ids)
        )
      );
    },
  });
  const candidates = CampaignCandidateRepository.Default.pipe(
    Layer.provide(database.layer)
  );
  const audienceFacts = AudienceFactsService.Default.pipe(
    Layer.provide(Layer.mergeAll(candidates, dotyposLayer))
  );
  const evaluation = AutomationConditionEvaluation.Default.pipe(
    Layer.provide(Layer.mergeAll(candidates, audienceFacts))
  );
  const evaluationFacts = AutomationEvaluationFacts.Default.pipe(
    Layer.provide(Layer.merge(database.layer, dotyposLayer))
  );

  const makeEngine = async () => {
    const queue = makeAutomationUnitQueueFake();
    const handler = await Effect.runPromise(
      makeConditionHandler.pipe(
        Effect.provide(
          Layer.mergeAll(database.layer, evaluationFacts, evaluation)
        )
      )
    );
    const layer = automationEngineTestLayer({
      database,
      queue,
      handlers: [handler],
      conditionPlanning: AutomationConditionPlanning.Default.pipe(
        Layer.provide(Layer.merge(database.layer, evaluationFacts))
      ),
    });
    const atInstant = <A, E>(
      effect: Effect.Effect<A, E, Layer.Success<typeof layer>>,
      when: Temporal.Instant
    ) =>
      Effect.runPromise(
        TestClock.setTime(when.epochMilliseconds).pipe(
          Effect.andThen(effect),
          Effect.provide(layer),
          Effect.provide(TestClock.layer())
        )
      );
    return {
      queue,
      plan: (when = at) =>
        atInstant(
          Effect.flatMap(AutomationPlanner, (planner) => planner.plan),
          when
        ),
      drain: (when = at) => atInstant(drainAutomationUnitQueue(queue), when),
      /** One delivery of `unitId`, outside the queue fake. */
      process: (unitId: AutomationWorkUnitId, when: Temporal.Instant) =>
        atInstant(
          Effect.result(
            Effect.flatMap(AutomationUnitProcessor, (processor) =>
              processor.process(unitId)
            )
          ).pipe(
            Effect.map((result) =>
              Result.isSuccess(result) ? result.success : "redelivered"
            )
          ),
          when
        ),
    };
  };

  const automation = async (filter: AutomationConditionFilter) => {
    const seeded = await seedFlowAutomation(database.db, {
      flow: automationFlowOf(
        conditionStep("check", filter),
        waitStep("delay", oneDay)
      ),
      activatedAt,
    });
    campaignIds.push(seeded.campaignId);
    return seeded;
  };

  /** Ready runs at the condition, entered at `at`, of known customers unless `unknown`. */
  const readyRuns = async (
    seeded: Awaited<ReturnType<typeof automation>>,
    labels: readonly string[],
    options: { readonly unknown?: readonly string[] } = {}
  ) => {
    const ids = labels.map(customer);
    const known = ids.filter(
      (_, index) => !options.unknown?.includes(labels[index]!)
    );
    customerIds.push(...known);
    if (known.length > 0) await seedKnownCustomers(database.db, known);
    const runIds: AutomationRunId[] = [];
    for (const customerId of ids) {
      runIds.push(
        await seedAutomationRun(database.db, {
          ...seeded,
          customerId,
          stepId: "check",
          phase: "ready",
          stepEnteredAt: at,
          dueAt: at,
        })
      );
    }
    return runIds;
  };

  const insertAudience = async (filter: AudienceFilter) => {
    const [audience] = await Effect.runPromise(
      database.db
        .insert(emailCampaignAudiences)
        .values({ title: `Condition unit ${crypto.randomUUID()}`, filter })
        .returning({ id: emailCampaignAudiences.id })
    );
    audienceIds.push(audience!.id);
    return audience!.id;
  };

  const editAudience = (
    audienceId: CampaignAudienceId,
    filter: AudienceFilter
  ) =>
    Effect.runPromise(
      database.db
        .update(emailCampaignAudiences)
        .set({ filter })
        .where(eq(emailCampaignAudiences.id, audienceId))
    );

  const deleteAudience = (audienceId: CampaignAudienceId) =>
    Effect.runPromise(
      database.db
        .delete(emailCampaignAudiences)
        .where(eq(emailCampaignAudiences.id, audienceId))
    );

  const unitsOf = (campaignId: CampaignId) =>
    Effect.runPromise(
      database.db.select().from(units).where(eq(units.campaignId, campaignId))
    );

  beforeEach(async () => {
    dotypos.failing = false;
    dotypos.profiles = [];
    dotypos.profilePages = 0;
    await database.pool.query(
      "delete from email_campaign_automation_work_units"
    );
    // Earlier tests' automations stop competing for planning and slots.
    for (const campaignId of campaignIds) {
      await setAutomationLifecycle(database.db, campaignId, {
        status: "paused",
        at,
      });
    }
  });

  afterAll(async () => {
    await deleteAutomatedCampaigns(database.db, campaignIds);
    await deleteKnownCustomers(database.db, customerIds);
    if (audienceIds.length > 0) {
      await Effect.runPromise(
        database.db
          .delete(emailCampaignAudiences)
          .where(inArray(emailCampaignAudiences.id, audienceIds))
      );
    }
  });

  test("a local condition plans one unit without Dotypos requests and advances matching runs once", async () => {
    const engine = await makeEngine();
    const seeded = await automation(all(locale("cs-CZ")));
    const runIds = await readyRuns(seeded, ["match-a", "match-b"]);

    const summary = await engine.plan();
    expect(summary.conditions).toEqual({
      runsPlanned: 2,
      unitsPlanned: 1,
      runsEnded: 0,
    });
    const [planned] = await unitsOf(seeded.campaignId);
    expect(planned).toMatchObject({ kind: "condition", requestCost: 0 });
    expect(planned?.subject).toEqual({
      versionId: seeded.versionId,
      stepId: "check",
      runIds: [...runIds].sort(),
      chainedSteps: 0,
    });
    for (const runId of runIds) {
      expect((await readAutomationRun(database.db, runId)).workUnitId).toBe(
        planned!.id
      );
    }

    const deliveries = await engine.drain(at.add({ seconds: 5 }));
    expect(deliveries.map(({ outcome }) => outcome)).toEqual(["done"]);
    expect(dotypos.profilePages).toBe(0);
    for (const runId of runIds) {
      const run = await readAutomationRun(database.db, runId);
      // The commit enters the delay that the run reached (D36).
      expect(run).toMatchObject({
        status: "active",
        stepId: "delay",
        phase: "waiting",
        workUnitId: null,
      });
      expect(run.stepEnteredAt.equals(at.add({ seconds: 5 }))).toBe(true);
      expect(await readAutomationRunTimeline(database.db, runId)).toMatchObject(
        [
          {
            kind: "condition-passed",
            stepId: "check",
            at: at.add({ seconds: 5 }).toString(),
            detail: {},
          },
          {
            kind: "waiting",
            stepId: "delay",
            at: at.add({ seconds: 5 }).toString(),
          },
        ]
      );
    }

    // A duplicate delivery of the settled unit decides nothing again.
    engine.queue.redeliver({
      unitId: planned!.id,
      idempotencyKey: "duplicate",
    });
    await engine.drain(at.add({ seconds: 6 }));
    expect(
      await readAutomationRunTimeline(database.db, runIds[0]!)
    ).toHaveLength(2);
    expect(
      (await engine.plan(at.add({ minutes: 1 }))).conditions.runsPlanned
    ).toBe(0);
  });

  /** Three conditions before the delay; the first two pass Czech customers. */
  const chainedAutomation = async (last: AutomationConditionFilter) => {
    const seeded = await seedFlowAutomation(database.db, {
      flow: automationFlowOf(
        conditionStep("check", all(locale("cs-CZ"))),
        conditionStep("check-2", all(locale("cs-CZ"))),
        conditionStep("check-3", last),
        waitStep("delay", oneDay)
      ),
      activatedAt,
    });
    campaignIds.push(seeded.campaignId);
    return seeded;
  };

  /** Each unit's step and chain depth, by step. */
  const chainOf = async (campaignId: CampaignId) =>
    Object.fromEntries(
      (await unitsOf(campaignId)).map((unit) => {
        const subject = unit.subject as {
          readonly stepId: string;
          readonly chainedSteps?: number;
        };
        return [subject.stepId, subject.chainedSteps ?? 0];
      })
    );

  test("consecutive conditions take their runs into the wait within one planner run", async () => {
    const engine = await makeEngine();
    const seeded = await chainedAutomation(all(locale("cs-CZ")));
    const runIds = await readyRuns(seeded, ["chain-a", "chain-b"]);

    // One plan and the queue drained after it, with no planning in between.
    expect((await engine.plan()).conditions.unitsPlanned).toBe(1);
    const drainedAt = at.add({ seconds: 5 });
    const deliveries = await engine.drain(drainedAt);

    expect(deliveries.map(({ outcome }) => outcome)).toEqual([
      "done",
      "done",
      "done",
    ]);
    expect(await chainOf(seeded.campaignId)).toEqual({
      check: 0,
      "check-2": 1,
      "check-3": 2,
    });
    expect(dotypos.profilePages).toBe(0);
    for (const runId of runIds) {
      const run = await readAutomationRun(database.db, runId);
      expect(run).toMatchObject({
        status: "active",
        stepId: "delay",
        phase: "waiting",
        workUnitId: null,
      });
      expect(run.stepEnteredAt.equals(drainedAt)).toBe(true);
      expect(
        (await readAutomationRunTimeline(database.db, runId)).map(
          ({ kind, stepId, at: entryAt }) => [kind, stepId, entryAt]
        )
      ).toEqual([
        ...["check", "check-2", "check-3"].map((stepId) => [
          "condition-passed",
          stepId,
          drainedAt.toString(),
        ]),
        ["waiting", "delay", drainedAt.toString()],
      ]);
    }

    // Duplicate deliveries of the settled chain decide and plan nothing again.
    for (const unit of await unitsOf(seeded.campaignId)) {
      engine.queue.redeliver({
        unitId: unit.id,
        idempotencyKey: `duplicate-${unit.id}`,
      });
    }
    await engine.drain(drainedAt.add({ seconds: 1 }));
    expect(await unitsOf(seeded.campaignId)).toHaveLength(3);
    for (const runId of runIds) {
      expect(await readAutomationRunTimeline(database.db, runId)).toHaveLength(
        4
      );
    }
    expect(
      (await engine.plan(at.add({ minutes: 15 }))).conditions.runsPlanned
    ).toBe(0);
  });

  test("a condition failing mid-chain ends the run condition-failed there", async () => {
    const engine = await makeEngine();
    const seeded = await chainedAutomation(all(locale("en-US")));
    const [runId] = await readyRuns(seeded, ["chain-failed"]);

    await engine.plan();
    const drainedAt = at.add({ seconds: 5 });
    await engine.drain(drainedAt);

    expect(await readAutomationRun(database.db, runId!)).toMatchObject({
      status: "ended",
      outcome: "condition-failed",
      stepId: "check-3",
      workUnitId: null,
    });
    expect(
      (await readAutomationRunTimeline(database.db, runId!)).map(
        ({ kind, stepId }) => [kind, stepId]
      )
    ).toEqual([
      ["condition-passed", "check"],
      ["condition-passed", "check-2"],
      ["condition-failed", "check-3"],
    ]);
  });

  test("past the chain cap, passed runs stay ready for the next planner run", async () => {
    const engine = await makeEngine();
    const seeded = await chainedAutomation(all(locale("cs-CZ")));
    const [runId] = await readyRuns(seeded, ["chain-capped"]);

    await engine.plan();
    const [planned] = await unitsOf(seeded.campaignId);
    // As if the unit ended a chain already as deep as the cap allows.
    await database.pool.query(
      "update email_campaign_automation_work_units set subject = subject || $1::jsonb where id = $2",
      [JSON.stringify({ chainedSteps: maxChainedSteps }), planned!.id]
    );
    await engine.drain(at.add({ seconds: 5 }));

    expect(await unitsOf(seeded.campaignId)).toHaveLength(1);
    expect(await readAutomationRun(database.db, runId!)).toMatchObject({
      status: "active",
      stepId: "check-2",
      phase: "ready",
      workUnitId: null,
    });
    const next = at.add({ minutes: 15 });
    expect((await engine.plan(next)).conditions).toEqual({
      runsPlanned: 1,
      unitsPlanned: 1,
      runsEnded: 0,
    });
    expect((await chainOf(seeded.campaignId))["check-2"]).toBe(0);
  });

  test("failing runs end condition-failed with their failed clauses and the saved audiences' hashes", async () => {
    const engine = await makeEngine();
    const englishOnly = audienceOf(locale("en-US"));
    const audienceId = await insertAudience(englishOnly);
    const seeded = await automation(all(noAccount, inAudience(audienceId)));
    const [known, unknown] = await readyRuns(seeded, ["fails", "unknown"], {
      unknown: ["unknown"],
    });

    await engine.plan();
    await engine.drain();

    const savedAudiences = [
      { audienceId, filterHash: filterHash(englishOnly) },
    ];
    expect(await readAutomationRun(database.db, known!)).toMatchObject({
      status: "ended",
      outcome: "condition-failed",
      stepId: "check",
      workUnitId: null,
    });
    expect(await readAutomationRunTimeline(database.db, known!)).toEqual([
      {
        kind: "condition-failed",
        stepId: "check",
        at: at.toString(),
        detail: { failedConditions: [1], savedAudiences },
      },
    ]);
    // Workspace doesn't know this customer: unknown, so it can't pass.
    expect(await readAutomationRunTimeline(database.db, unknown!)).toEqual([
      {
        kind: "condition-failed",
        stepId: "check",
        at: at.toString(),
        detail: { failedConditions: [], savedAudiences },
      },
    ]);
  });

  test("a saved audience deleted before planning ends the runs failed instead of planning them", async () => {
    const engine = await makeEngine();
    const audienceId = await insertAudience(audienceOf(locale("cs-CZ")));
    const seeded = await automation(all(inAudience(audienceId)));
    const [runId] = await readyRuns(seeded, ["missing-at-planning"]);
    await deleteAudience(audienceId);

    const summary = await engine.plan();

    expect(summary.conditions).toEqual({
      runsPlanned: 0,
      unitsPlanned: 0,
      runsEnded: 1,
    });
    expect(await unitsOf(seeded.campaignId)).toEqual([]);
    expect(await readAutomationRun(database.db, runId!)).toMatchObject({
      status: "ended",
      outcome: "failed",
      outcomeReason: "evaluation-unavailable",
    });
  });

  test("a saved audience deleted after planning ends the unit's runs failed", async () => {
    const engine = await makeEngine();
    const audienceId = await insertAudience(audienceOf(locale("cs-CZ")));
    const seeded = await automation(all(inAudience(audienceId)));
    const [runId] = await readyRuns(seeded, ["missing-at-fetch"]);
    await engine.plan();
    await deleteAudience(audienceId);

    expect((await engine.drain()).map(({ outcome }) => outcome)).toEqual([
      "done",
    ]);

    expect(await readAutomationRun(database.db, runId!)).toMatchObject({
      status: "ended",
      outcome: "failed",
      outcomeReason: "evaluation-unavailable",
    });
  });

  test("a saved audience edited between planning and fetch is evaluated by its new definition", async () => {
    const engine = await makeEngine();
    const audienceId = await insertAudience(audienceOf(locale("cs-CZ")));
    const seeded = await automation(all(inAudience(audienceId)));
    const [runId] = await readyRuns(seeded, ["edited"]);
    await engine.plan();
    const [planned] = await unitsOf(seeded.campaignId);
    expect(planned?.requestCost).toBe(0);

    // The edit needs a profile request the unit didn't plan; it proceeds anyway.
    const vipOnly = audienceOf(taggedVip);
    await editAudience(audienceId, vipOnly);
    dotypos.profiles = [profile(customer("edited"), ["regular"])];
    await engine.drain();

    expect(dotypos.profilePages).toBe(1);
    expect(await readAutomationRunTimeline(database.db, runId!)).toEqual([
      {
        kind: "condition-failed",
        stepId: "check",
        at: at.toString(),
        detail: {
          failedConditions: [0],
          savedAudiences: [{ audienceId, filterHash: filterHash(vipOnly) }],
        },
      },
    ]);
  });

  test("with Dotypos down the unit is redelivered until its runs fail after 24 hours", async () => {
    const engine = await makeEngine();
    const seeded = await automation(all(taggedVip));
    const [runId] = await readyRuns(seeded, ["dotypos-down"]);
    dotypos.failing = true;
    await engine.plan();
    const [planned] = await unitsOf(seeded.campaignId);
    expect(planned?.requestCost).toBe(1);

    for (const when of [at, at.add({ hours: 1 }), at.add({ hours: 23 })]) {
      expect(await engine.process(planned!.id, when)).toBe("redelivered");
      const [unit] = await unitsOf(seeded.campaignId);
      expect(unit).toMatchObject({
        status: "enqueued",
        lastErrorCode: "dotypos-unavailable",
      });
      expect(await readAutomationRun(database.db, runId!)).toMatchObject({
        status: "active",
        phase: "ready",
        workUnitId: planned!.id,
      });
    }
    const pagesBeforeExpiry = dotypos.profilePages;

    expect(
      await engine.process(planned!.id, at.add({ hours: 24, minutes: 1 }))
    ).toBe("done");

    expect(dotypos.profilePages).toBe(pagesBeforeExpiry);
    expect(await readAutomationRun(database.db, runId!)).toMatchObject({
      status: "ended",
      outcome: "failed",
      outcomeReason: "evaluation-unavailable",
    });
    expect((await unitsOf(seeded.campaignId))[0]?.status).toBe("done");
  });

  test("a unit at the deadline-miss limit ends its runs failed without fetching", async () => {
    const engine = await makeEngine();
    const seeded = await automation(all(taggedVip));
    const [runId] = await readyRuns(seeded, ["deadline-misses"]);
    await engine.plan();
    await database.pool.query(
      "update email_campaign_automation_work_units set deadline_misses = 3 where campaign_id = $1",
      [seeded.campaignId]
    );

    await engine.drain();

    expect(dotypos.profilePages).toBe(0);
    expect(await readAutomationRun(database.db, runId!)).toMatchObject({
      status: "ended",
      outcome: "failed",
      outcomeReason: "evaluation-unavailable",
    });
  });

  test("a pause before the commit drops the unit and leaves its runs to be replanned after resume", async () => {
    const engine = await makeEngine();
    const seeded = await automation(all(locale("cs-CZ")));
    const [runId] = await readyRuns(seeded, ["paused"]);
    await engine.plan();
    await setAutomationLifecycle(database.db, seeded.campaignId, {
      status: "paused",
      at,
    });

    expect((await engine.drain()).map(({ outcome }) => outcome)).toEqual([
      "dropped",
    ]);
    expect(await readAutomationRun(database.db, runId!)).toMatchObject({
      status: "active",
      stepId: "check",
      phase: "ready",
      workUnitId: null,
    });
    expect(await readAutomationRunTimeline(database.db, runId!)).toEqual([]);

    const resumedAt = at.add({ minutes: 5 });
    await setAutomationLifecycle(database.db, seeded.campaignId, {
      status: "active",
      resumedAt,
    });
    expect((await engine.plan(resumedAt)).conditions.runsPlanned).toBe(1);
    await engine.drain(resumedAt);

    expect(await readAutomationRun(database.db, runId!)).toMatchObject({
      stepId: "delay",
      phase: "waiting",
    });
  });
});
