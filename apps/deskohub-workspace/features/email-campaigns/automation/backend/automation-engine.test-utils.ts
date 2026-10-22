import { Effect, Layer, Schema } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { emailCampaignAutomationWorkUnits } from "@/db/schema";
import type { WorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { AutomationWorkUnitStatus } from "../automation-work-units";
import { automationWorkUnitPriorities } from "../automation-work-units";
import {
  AutomationConditionPlanning,
  emptyAutomationConditionPlan,
} from "./automation-condition-planning.service";
import {
  AutomationIntakePlanning,
  emptyAutomationIntakePlan,
} from "./automation-intake-planning.service";
import { AutomationPlanner } from "./automation-planner.service";
import {
  AutomationSchedulePlanning,
  emptyAutomationSchedulePlan,
} from "./automation-schedule-planning.service";
import {
  AutomationSendPlanning,
  emptyAutomationSendPlan,
} from "./automation-send-planning.service";
import { AutomationSweepPlanning } from "./automation-sweep-planning.service";
import {
  AutomationTimerPlanning,
  emptyAutomationTimerPlan,
} from "./automation-timer-planning.service";
import {
  type AutomationUnitDefect,
  type AutomationUnitExpiry,
  type AutomationUnitFetchFailure,
  type ClaimedAutomationUnit,
  type PlannedAutomationUnit,
  type RegisteredAutomationUnitHandler,
  registerAutomationUnitHandler,
} from "./automation-unit-handler";
import { AutomationUnitHandlers } from "./automation-unit-handlers.service";
import { AutomationUnitProcessor } from "./automation-unit-processor.service";
import type { AutomationUnitQueueFake } from "./automation-unit-queue.test-utils";
import {
  AutomationUnitSlotLimits,
  AutomationUnitSlots,
} from "./automation-unit-slots";

const idleSweepPlanning = Layer.succeed(AutomationSweepPlanning, {
  plan: () =>
    Effect.succeed({
      sweepPagesPlanned: 0,
      sweepPagesReplanned: 0,
      eventsReconciled: 0,
    }),
});

const idleIntakePlanning = Layer.succeed(AutomationIntakePlanning, {
  plan: () => Effect.succeed(emptyAutomationIntakePlan),
});

const idleTimerPlanning = Layer.succeed(AutomationTimerPlanning, {
  plan: () => Effect.succeed(emptyAutomationTimerPlan),
});

const idleConditionPlanning = Layer.succeed(AutomationConditionPlanning, {
  plan: () => Effect.succeed(emptyAutomationConditionPlan),
});

const idleSendPlanning = Layer.succeed(AutomationSendPlanning, {
  plan: () => Effect.succeed(emptyAutomationSendPlan),
});

const idleSchedulePlanning = Layer.succeed(AutomationSchedulePlanning, {
  plan: () => Effect.succeed(emptyAutomationSchedulePlan),
});

/**
 * The processor and planner over the suite's own database and a queue
 * fake, running `handlers` only. Slot limits default to production's, and each planner
 * step after the sweep is idle unless a test supplies it.
 */
export const automationEngineTestLayer = (input: {
  readonly database: WorkspacePostgresSuiteDatabase;
  readonly queue: AutomationUnitQueueFake;
  readonly handlers: ReadonlyArray<RegisteredAutomationUnitHandler>;
  readonly limits?: { readonly total: number; readonly deliver: number };
  readonly sweepPlanning?: Layer.Layer<AutomationSweepPlanning>;
  readonly intakePlanning?: Layer.Layer<AutomationIntakePlanning>;
  readonly timerPlanning?: Layer.Layer<AutomationTimerPlanning>;
  readonly conditionPlanning?: Layer.Layer<AutomationConditionPlanning>;
  readonly sendPlanning?: Layer.Layer<AutomationSendPlanning>;
  readonly schedulePlanning?: Layer.Layer<AutomationSchedulePlanning>;
}) => {
  const capabilities = Layer.mergeAll(
    input.database.layer,
    WorkspaceDatabaseAdvisoryLock.makeLayer(input.database.pool),
    AutomationUnitHandlers.layer(Effect.succeed(input.handlers)),
    input.queue.layer,
    input.sweepPlanning ?? idleSweepPlanning,
    input.intakePlanning ?? idleIntakePlanning,
    input.timerPlanning ?? idleTimerPlanning,
    input.conditionPlanning ?? idleConditionPlanning,
    input.sendPlanning ?? idleSendPlanning,
    input.schedulePlanning ?? idleSchedulePlanning,
    Layer.succeed(
      AutomationUnitSlotLimits,
      input.limits ?? AutomationUnitSlotLimits.defaultValue()
    )
  );

  return Layer.mergeAll(
    AutomationUnitProcessor.Default,
    AutomationPlanner.Default
  ).pipe(
    Layer.provideMerge(AutomationUnitSlots.Default),
    Layer.provideMerge(capabilities)
  );
};

const testSubjectSchema = Schema.Struct({ label: Schema.String });
type TestSubject = typeof testSubjectSchema.Type;

/**
 * A handler for tests: `fetch` defaults to an instant success and `commit`
 * plans the units `followUps` returns, writing nothing else.
 */
export const testUnitHandler = (
  kind: RegisteredAutomationUnitHandler["kind"],
  options: {
    readonly fetch?: (
      unit: ClaimedAutomationUnit<TestSubject>
    ) => Effect.Effect<void, AutomationUnitFetchFailure | AutomationUnitDefect>;
    readonly followUps?: (
      unit: ClaimedAutomationUnit<TestSubject>
    ) => ReadonlyArray<PlannedAutomationUnit>;
    readonly expire?: (
      unit: ClaimedAutomationUnit<TestSubject>
    ) => Effect.Effect<AutomationUnitExpiry>;
  } = {}
) => {
  const { expire } = options;
  return registerAutomationUnitHandler<TestSubject, void>({
    kind,
    subject: testSubjectSchema,
    ...(expire !== undefined && { expire: (_tx, unit) => expire(unit) }),
    fetch: (unit) => options.fetch?.(unit) ?? Effect.void,
    commit: (_tx, unit) => Effect.succeed(options.followUps?.(unit) ?? []),
  });
};

/**
 * Inserts one unit row directly. `kind` is free text, so a test can seed a
 * kind no registry supports.
 */
export const seedAutomationUnit = (
  db: WorkspaceDatabaseClient,
  input: {
    readonly kind: string;
    readonly status: AutomationWorkUnitStatus;
    readonly key?: string;
    readonly priority?: number;
    readonly campaignId?: typeof emailCampaignAutomationWorkUnits.$inferInsert.campaignId;
    readonly claimId?: string;
    readonly claimExpiresAt?: Temporal.Instant;
    readonly cancelRequestedAt?: Temporal.Instant;
    readonly enqueuedAt?: Temporal.Instant;
    readonly createdAt?: Temporal.Instant;
    readonly settledAt?: Temporal.Instant;
  }
) => {
  const key = input.key ?? `test:${crypto.randomUUID()}`;
  return db
    .insert(emailCampaignAutomationWorkUnits)
    .values({
      kind: input.kind,
      priority:
        input.priority ??
        new Map(Object.entries(automationWorkUnitPriorities)).get(input.kind) ??
        0,
      key,
      subject: { label: key },
      requestCost: 1,
      status: input.status,
      campaignId: input.campaignId ?? null,
      claimId: input.claimId ?? null,
      claimExpiresAt: input.claimExpiresAt ?? null,
      cancelRequestedAt: input.cancelRequestedAt ?? null,
      enqueuedAt: input.enqueuedAt ?? null,
      settledAt: input.settledAt ?? null,
      ...(input.createdAt && { createdAt: input.createdAt }),
    })
    .returning()
    .pipe(Effect.map(([unit]) => unit!));
};
