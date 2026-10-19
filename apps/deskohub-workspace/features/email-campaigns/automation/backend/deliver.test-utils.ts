import {
  type DotyposCustomer,
  type DotyposCustomerId,
  type DotyposReservation,
  DotyposReservationIdSchema,
  type DotyposService,
} from "@deskohub/dotypos";
import {
  DotyposServiceMock,
  seededCustomerReads,
  seededReservationReads,
} from "@deskohub/dotypos/backend/service.mock";
import {
  EmailDeliveryIdSchema,
  type EmailMessage,
  type EmailSendError,
  type EmailSendResult,
  EmailServiceError,
  EmailServiceTag,
  NetworkError,
} from "@deskohub/email";
import { testEmailAddress } from "@deskohub/test-email";
import {
  type AutomationFlowType as AutomationFlow,
  AutomationFlow as automationFlowContractSchema,
} from "@deskohub/workspace-admin-api";
import { Effect, Fiber, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import {
  emailCampaignAutomationRuns,
  workspaceReservations,
} from "@/db/schema";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import { CustomerMarketingConsentRepository } from "@/features/legal/backend/customer-marketing-consent.repository";
import { MarketingManagementService } from "@/features/legal/backend/marketing-management.service";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import type { WorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { CampaignCandidateRepository } from "../../backend/campaign-candidate.repository";
import { CampaignDeliveryService } from "../../backend/campaign-delivery.service";
import { CampaignEmailConfig } from "../../backend/campaign-email.config";
import { CampaignUnsubscribeService } from "../../backend/campaign-unsubscribe.service";
import {
  seedAutomatedCampaign,
  seedAutomation,
  seedAutomationVersion,
} from "../../backend/email-campaigns.test-utils";
import type { CampaignPurpose } from "../../body/campaign-content";
import { campaignDeliveryPayloadHash } from "../../campaign-delivery-batches";
import type { CampaignId } from "../../campaign-identifiers";
import type {
  AutomationRunId,
  AutomationVersionId,
} from "../automation-identifiers";
import type { AutomationTriggerKind } from "../automation-states";
import { automationEngineTestLayer } from "./automation-engine.test-utils";
import { AutomationLifecycle } from "./automation-lifecycle.service";
import { AutomationPlanner } from "./automation-planner.service";
import { AutomationRunSettlement } from "./automation-run-settlement.service";
import { AutomationSendPlanning } from "./automation-send-planning.service";
import { AutomationUnitProcessor } from "./automation-unit-processor.service";
import {
  drainAutomationUnitQueue,
  makeAutomationUnitQueueFake,
} from "./automation-unit-queue.test-utils";
import { makeDeliverHandler } from "./deliver";

/** How the Resend stand-in answers one batch request. */
export type ResendFakeResponse =
  /** Mails the batch and answers with its ids. */
  | "accept"
  /** Mails the batch but the answer never arrives (a lost response). */
  | "accept-lost"
  /** Refuses the batch and mails nothing. */
  | "refuse"
  /** Mails the batch, then never answers, as when the consumer is cut off. */
  | "accept-hang"
  /** Never answers and mails nothing. */
  | "hang";

/**
 * Resend's batch API with its idempotency contract: a key replayed with the
 * identical payload answers the accepted batch without mailing it again,
 * and one reused with a different payload is refused as 409 (an unknown
 * outcome). `respond` decides how each fresh request is answered.
 */
export const makeResendFake = () => {
  const accepted = new Map<
    string,
    { readonly payloadHash: string; readonly ids: readonly string[] }
  >();
  const requests: { readonly key: string; readonly to: string[] }[] = [];
  const mailed: string[] = [];
  let respond: (key: string) => ResendFakeResponse = () => "accept";
  let reached: () => void = () => {};
  let beforeRequest: () => Promise<void> = () => Promise.resolve();
  // Provider message ids are unique across sends.
  const fakeId = crypto.randomUUID();
  let nextId = 0;

  const recipientsOf = (messages: readonly EmailMessage[]) =>
    messages.flatMap((message) => [message.to].flat().map((to) => to.email));

  const accept = (key: string, messages: readonly EmailMessage[]) => {
    const payloadHash = campaignDeliveryPayloadHash(messages);
    const earlier = accepted.get(key);
    if (earlier !== undefined) {
      return earlier.payloadHash === payloadHash ? earlier.ids : undefined;
    }
    const ids = messages.map(() => `resend-fake-${fakeId}-${++nextId}`);
    accepted.set(key, { payloadHash, ids });
    mailed.push(...recipientsOf(messages));
    return ids;
  };

  const layer = Layer.mock(EmailServiceTag, {
    sendBatch: (messages, { idempotencyKey: key }) =>
      Effect.promise(() => beforeRequest()).pipe(
        Effect.andThen(
          Effect.suspend(
            (): Effect.Effect<readonly EmailSendResult[], EmailSendError> => {
              requests.push({ key, to: recipientsOf(messages) });
              reached();
              const response = accepted.has(key) ? "accept" : respond(key);
              if (response === "refuse") {
                return Effect.fail(new EmailServiceError("Invalid batch"));
              }
              if (response === "hang") return Effect.never;
              const ids = accept(key, messages);
              if (ids === undefined) {
                return Effect.fail(
                  new NetworkError({ message: "invalid_idempotent_request" })
                );
              }
              if (response === "accept-hang") return Effect.never;
              if (response === "accept-lost") {
                return Effect.fail(
                  new NetworkError({ message: "response lost" })
                );
              }
              return Effect.succeed(
                ids.map((id) => ({
                  id: EmailDeliveryIdSchema.make(id),
                  status: "sent" as const,
                  provider: "resend",
                  timestamp: new Date(),
                }))
              );
            }
          )
        )
      ),
  });

  return {
    layer,
    /** Every request, replays included, in order. */
    requests: () => [...requests],
    /** Every address really mailed. */
    mailed: () => [...mailed],
    respondWith: (next: (key: string) => ResendFakeResponse) => {
      respond = next;
    },
    /** Runs `check` as each request reaches the provider. */
    beforeEachRequest: (check: () => Promise<void>) => {
      beforeRequest = check;
    },
    /** Resolves when the next request reaches the provider. */
    nextRequest: () =>
      new Promise<void>((resolve) => {
        reached = () => {
          reached = () => {};
          resolve();
        };
      }),
  };
};
export type ResendFake = ReturnType<typeof makeResendFake>;

/**
 * Dotypos with seeded profiles and reservations that a test can change
 * between invocations, counting the reads a deliver unit makes.
 */
export const makeDeliverDotypos = (input: {
  readonly customers: readonly DotyposCustomer[];
  readonly reservations?: readonly DotyposReservation[];
}) => {
  let customers = [...input.customers];
  let reservations = [...(input.reservations ?? [])];
  const calls = {
    getCustomersPage: 0,
    getCustomers: 0,
    listReservationsPage: 0,
  };
  const layer = DotyposServiceMock({
    getCustomersPage: (ids) => {
      calls.getCustomersPage += 1;
      return seededCustomerReads(customers).getCustomersPage(ids);
    },
    // Delivery's replay re-reads its batch's profiles.
    getCustomers: ({ ids }) => {
      calls.getCustomers += 1;
      const selected = new Set<string>(ids);
      return Effect.succeed(
        customers.filter(({ id }) => id !== undefined && selected.has(id))
      );
    },
    listReservationsPage: (options) => {
      calls.listReservationsPage += 1;
      return seededReservationReads(reservations).listReservationsPage(options);
    },
  });
  return {
    layer,
    calls,
    setCustomers: (next: readonly DotyposCustomer[]) => {
      customers = [...next];
    },
    setReservations: (next: readonly DotyposReservation[]) => {
      reservations = [...next];
    },
  };
};
export type DeliverDotypos = ReturnType<typeof makeDeliverDotypos>;

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

/**
 * The registered deliver handler over the test database, `dotypos` and
 * `resend`, with delivery's recheck as in `deploymentEnvironment`.
 */
export const makeDeliverTestHandler = (input: {
  readonly database: WorkspacePostgresTestDatabase;
  readonly dotypos: Layer.Layer<DotyposService>;
  readonly resend: ResendFake;
  readonly deploymentEnvironment?: "production" | "development";
}) =>
  Effect.runPromise(
    makeDeliverHandler.pipe(
      Effect.provide(
        Layer.mergeAll(
          input.dotypos,
          CampaignCandidateRepository.Default,
          CampaignDeliveryService.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                input.dotypos,
                input.resend.layer,
                AutomationRunSettlement.Default,
                Layer.succeed(CampaignEmailConfig, {
                  deploymentEnvironment:
                    input.deploymentEnvironment ?? "development",
                  from: { email: testEmailAddress("campaigns") },
                  replyTo: { email: testEmailAddress("hello") },
                  adminInbox: testEmailAddress("admin"),
                }),
                CampaignUnsubscribeService.Default.pipe(
                  Layer.provide(
                    Layer.mergeAll(
                      CustomerMarketingConsentRepository.Default,
                      MarketingManagementService.Default
                    )
                  )
                )
              )
            )
          )
        ).pipe(Layer.provideMerge(input.database.layer))
      )
    )
  );

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
  const rows = visits.map((visit) => {
    const id = workspaceReservationIdSchema.make(`${prefix}-${visit.label}`);
    return {
      id,
      checkoutAttemptKey: checkoutAttemptKeySchema.make(id),
      dotyposCustomerId: visit.customer,
      dotyposReservationId: DotyposReservationIdSchema.make(
        `${prefix}-dotypos-${visit.label}`
      ),
      reservationState: "confirmed" as const,
      reservationConfirmedAt: confirmedAt,
      reservationCancelledAt: visit.cancelledAt ?? null,
      paymentState: "paid" as const,
      paidAt: confirmedAt,
      fulfillmentState: "fulfilled" as const,
      fulfilledAt: confirmedAt,
      reservationDetails: {
        kind: "cowork" as const,
        entryTier: "open-space" as const,
        coffee: false,
      },
      locale: "cs-CZ" as const,
      createdAt: confirmedAt,
    };
  });
  if (rows.length > 0) {
    await Effect.runPromise(db.insert(workspaceReservations).values(rows));
  }
  const ids = new Map(rows.map((row, index) => [visits[index]!.label, row.id]));
  const dotypos = visits.map(
    (visit, index): DotyposReservation => ({
      id: rows[index]!.dotyposReservationId,
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
 * An engine running deliver units only (plus `AutomationLifecycle`), with send planning live, over
 * the given Dotypos profiles and visits and a Resend stand-in.
 */
export const makeDeliverEngine = async (input: {
  readonly database: WorkspacePostgresTestDatabase;
  readonly customers: readonly DotyposCustomer[];
  readonly deploymentEnvironment?: "production" | "development";
}) => {
  const dotypos = makeDeliverDotypos({ customers: input.customers });
  const resend = makeResendFake();
  const handler = await makeDeliverTestHandler({
    database: input.database,
    dotypos: dotypos.layer,
    resend,
    deploymentEnvironment: input.deploymentEnvironment,
  });
  const queue = makeAutomationUnitQueueFake();
  const engine = Layer.provideMerge(
    AutomationLifecycle.Default,
    automationEngineTestLayer({
      database: input.database,
      queue,
      handlers: [handler],
      sendPlanning: AutomationSendPlanning.Default.pipe(
        Layer.provide(input.database.layer)
      ),
    })
  );
  type Engine = Layer.Success<typeof engine>;

  const runAt = <A, E>(
    effect: Effect.Effect<A, E, Engine>,
    at: Temporal.Instant
  ) =>
    Effect.runPromise(
      TestClock.setTime(at.epochMilliseconds).pipe(
        Effect.andThen(effect),
        Effect.provide(Layer.merge(engine, TestClock.layer()))
      )
    );

  const plan = Effect.flatMap(AutomationPlanner, (planner) => planner.plan);

  /** One planner minute, then every queued unit until none is left. */
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
export type DeliverEngine = Awaited<ReturnType<typeof makeDeliverEngine>>;
