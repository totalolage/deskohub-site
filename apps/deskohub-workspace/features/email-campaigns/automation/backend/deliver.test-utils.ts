import type {
  DotyposCustomer,
  DotyposCustomerId,
  DotyposReservation,
} from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import {
  type AutomationFlowType as AutomationFlow,
  AutomationFlow as automationFlowContractSchema,
} from "@deskohub/workspace-admin-api";
import { Effect, Fiber, Schema } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import { emailCampaignAutomationRuns } from "@/db/schema";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import type { WorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  seedAutomatedCampaign,
  seedAutomation,
  seedAutomationVersion,
} from "../../backend/email-campaigns.test-utils";
import type { CampaignPurpose } from "../../body/campaign-content";
import type { CampaignId } from "../../campaign-identifiers";
import type {
  AutomationRunId,
  AutomationVersionId,
} from "../automation-identifiers";
import type { AutomationTriggerKind } from "../automation-states";
import {
  type AutomationScenarioServices,
  automationScenarioLayer,
  makeEngineDotypos,
  makeResendFake,
  runEngineAt,
} from "./automation-engine-scenario.test-utils";
import { AutomationLifecycle } from "./automation-lifecycle.service";
import { AutomationPlanner } from "./automation-planner.service";
import { AutomationUnitProcessor } from "./automation-unit-processor.service";
import {
  drainAutomationUnitQueue,
  makeAutomationUnitQueueFake,
} from "./automation-unit-queue.test-utils";

/** A Dotypos profile with a test-domain email. */
export const deliverProfile = (
  id: DotyposCustomerId,
  overrides: Partial<DotyposCustomer> = {}
) =>
  ({
    id,
    _cloudId: "cloud",
    email: testEmailAddress(id),
    points: "0",
    flags: "0",
    display: true,
    deleted: false,
    ...overrides,
  }) as DotyposCustomer;

const decodeFlow = Schema.decodeUnknownSync(automationFlowContractSchema);

/** A flow whose trigger is `trigger` and whose only step sends. */
export const sendOnlyFlow = (
  trigger: AutomationFlow["trigger"] = { _tag: "AccountCreated" }
): AutomationFlow =>
  decodeFlow({ trigger, steps: [{ _tag: "Send", id: "send" }] });

/** An active automated campaign with one version of `flow` in force. */
export const seedDeliverAutomation = async (
  db: WorkspaceDatabaseClient,
  input: {
    readonly purpose?: CampaignPurpose;
    readonly flow?: AutomationFlow;
    readonly text?: string;
    readonly activatedAt: Temporal.Instant;
  }
) => {
  const purpose = input.purpose ?? "operational";
  const flow = input.flow ?? sendOnlyFlow();
  const campaignId = await seedAutomatedCampaign(db, { purpose });
  const versionId = await seedAutomationVersion(db, {
    campaignId,
    purpose,
    flow,
    text: input.text,
    activatedAt: input.activatedAt,
  });
  await seedAutomation(db, {
    campaignId,
    activeVersionId: versionId,
    acceptingSince: input.activatedAt,
  });
  return { campaignId, versionId };
};

/** A send-ready run to seed, with its triggering reservation if any. */
export type SeedSendReadyRun = {
  readonly customer: DotyposCustomerId;
  readonly triggerKind?: AutomationTriggerKind;
  readonly reservationId?: WorkspaceReservationId;
};

/** Inserts `ready` runs at the send step, as the steps before it leave them. */
export const seedSendReadyRuns = async (
  db: WorkspaceDatabaseClient,
  input: {
    readonly campaignId: CampaignId;
    readonly versionId: AutomationVersionId;
    readonly runs: readonly SeedSendReadyRun[];
    readonly at: Temporal.Instant;
    readonly stepId?: string;
  }
) => {
  const inserted = await Effect.runPromise(
    db
      .insert(emailCampaignAutomationRuns)
      .values(
        input.runs.map((run) => ({
          campaignId: input.campaignId,
          versionId: input.versionId,
          dotyposCustomerId: run.customer,
          triggerKind: run.triggerKind ?? "account-created",
          triggerAt: input.at,
          triggerReservationId: run.reservationId ?? null,
          status: "active" as const,
          stepId: (input.stepId ?? "send") as never,
          phase: "ready" as const,
          stepEnteredAt: input.at,
          dueAt: input.at,
        }))
      )
      .returning({ id: emailCampaignAutomationRuns.id })
  );
  return inserted.map(({ id }) => id as AutomationRunId);
};

/** A Workspace-booked reservation and its live Dotypos visit. */
export type SeedVisit = {
  readonly label: string;
  readonly customer: DotyposCustomerId;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  readonly dotyposStatus?: "CONFIRMED" | "CANCELLED";
  /** Workspace cancelled it too. */
  readonly cancelledAt?: Temporal.Instant;
};

/**
 * Inserts confirmed `workspace_reservations` rows and returns their ids
 * and the Dotypos reservations behind them, keyed by `prefix`.
 */
export const seedDeliverReservations = async (
  db: WorkspaceDatabaseClient,
  prefix: string,
  visits: readonly SeedVisit[]
) => {
  const confirmedAt = Temporal.Instant.from("2026-10-01T10:00:00Z");
  const rows = await Effect.runPromise(
    workspaceFixtures(db).reservations(
      visits.map((visit) => ({
        stage: {
          reservation: "confirmed",
          payment: "paid",
          fulfillment: "fulfilled",
        },
        customer: visit.customer,
        at: confirmedAt,
        locale: "cs-CZ",
        overrides: {
          id: workspaceReservationIdSchema.make(`${prefix}-${visit.label}`),
          reservationCancelledAt: visit.cancelledAt ?? null,
          createdAt: confirmedAt,
        },
      }))
    )
  );
  const ids = new Map(rows.map((row, index) => [visits[index]!.label, row.id]));
  const dotypos = visits.map(
    (visit, index): DotyposReservation => ({
      id: rows[index]!.dotyposReservationId!,
      _branchId: "deliver-branch" as DotyposReservation["_branchId"],
      _cloudId: "deliver-cloud" as DotyposReservation["_cloudId"],
      _customerId: visit.customer,
      startDate: visit.startsAt.toString(),
      endDate: visit.endsAt.toString(),
      seats: "1",
      status: visit.dotyposStatus ?? "CONFIRMED",
    })
  );
  return { ids, dotypos };
};

/**
 * An engine running deliver units only (plus `AutomationLifecycle`), with
 * send planning live, over the given Dotypos profiles and a Resend
 * stand-in. A failed delivery is redelivered at once, within the same drain.
 */
export const makeDeliverEngine = async (input: {
  readonly database: WorkspacePostgresSuiteDatabase;
  readonly customers: readonly DotyposCustomer[];
  readonly deploymentEnvironment?: "production" | "development";
}) => {
  const dotypos = makeEngineDotypos();
  dotypos.setCustomers(input.customers);
  const resend = makeResendFake();
  const queue = makeAutomationUnitQueueFake();
  const layer = await automationScenarioLayer({
    database: input.database,
    dotypos,
    queue,
    resend,
    kinds: ["deliver"],
    planning: ["sends"],
    deploymentEnvironment: input.deploymentEnvironment,
  });

  const runAt = <A, E>(
    effect: Effect.Effect<A, E, AutomationScenarioServices>,
    at: Temporal.Instant
  ) => runEngineAt(effect, layer, at);

  const plan = Effect.flatMap(AutomationPlanner, (planner) => planner.plan);

  /** One planner run, then every queued unit until none is left. */
  const tick = (at: Temporal.Instant) =>
    runAt(plan.pipe(Effect.andThen(drainAutomationUnitQueue(queue))), at);
  const planOnly = (at: Temporal.Instant) => runAt(plan, at);
  const drain = (at: Temporal.Instant) =>
    runAt(drainAutomationUnitQueue(queue), at);

  /**
   * Plans, then cuts the consumer of the next deliver unit off while its
   * batch request is with the provider, as the platform's time limit
   * would. The unit stays claimed with its batch persisted.
   */
  const killDuringRequest = (at: Temporal.Instant) => {
    const reached = resend.nextRequest();
    return runAt(
      plan.pipe(
        Effect.andThen(
          Effect.suspend(() =>
            Effect.fromNullishOr(queue.take()).pipe(
              Effect.orDie,
              Effect.flatMap((message) =>
                Effect.flatMap(AutomationUnitProcessor, (processor) =>
                  Effect.forkChild(processor.process(message.unitId))
                )
              )
            )
          )
        ),
        Effect.tap(() => Effect.promise(() => reached)),
        Effect.flatMap(Fiber.interrupt)
      ),
      at
    );
  };

  const lifecycle = <A, E>(
    operation: (service: AutomationLifecycle["Service"]) => Effect.Effect<A, E>,
    at: Temporal.Instant
  ) => runAt(Effect.flatMap(AutomationLifecycle, operation), at);

  return {
    dotypos,
    resend,
    queue,
    tick,
    planOnly,
    drain,
    killDuringRequest,
    lifecycle,
  };
};
