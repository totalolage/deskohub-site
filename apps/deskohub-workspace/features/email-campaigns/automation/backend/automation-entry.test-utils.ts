import {
  DotyposCloudIdSchema,
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposReservation,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import {
  DotyposServiceMock,
  seededCustomerReads,
  seededReservationReads,
} from "@deskohub/dotypos/backend/service.mock";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import {
  customerAccounts,
  customerEvents,
  customerMarketingConsents,
  workspaceReservations,
} from "@/db/schema";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import type {
  CustomerEventId,
  CustomerEventKind,
} from "@/shared/backend/customer-events/customer-event";
import type { WorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { AudienceFactsService } from "../../backend/audience-facts.service";
import { CampaignCandidateRepository } from "../../backend/campaign-candidate.repository";
import { CampaignRecipientService } from "../../backend/campaign-recipient.service";
import { automationEngineTestLayer } from "./automation-engine.test-utils";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import { AutomationIntakePlanning } from "./automation-intake-planning.service";
import { AutomationPlanner } from "./automation-planner.service";
import { AutomationSchedulePlanning } from "./automation-schedule-planning.service";
import {
  type AutomationUnitQueueFake,
  drainAutomationUnitQueue,
} from "./automation-unit-queue.test-utils";
import { makeFireChunkHandler } from "./fire-chunk";
import { makeIntakeHandler } from "./intake";

/**
 * A Dotypos fake whose customers and visits tests change between
 * invocations, as Dotypos would, and which counts single-request calls.
 */
export const makeEntryDotypos = () => {
  const customers = new Map<DotyposCustomerId, DotyposCustomer>();
  const reservations = new Map<string, DotyposReservation>();
  const calls = { getCustomersPage: 0, listReservationsPage: 0 };
  const reservationReads = () =>
    seededReservationReads([...reservations.values()]);
  return {
    customers,
    reservations,
    calls,
    resetCalls: () => {
      calls.getCustomersPage = 0;
      calls.listReservationsPage = 0;
    },
    layer: DotyposServiceMock({
      getCustomersPage: (ids) => {
        calls.getCustomersPage += 1;
        return seededCustomerReads([...customers.values()]).getCustomersPage(
          ids
        );
      },
      listReservationsPage: (options) => {
        calls.listReservationsPage += 1;
        return reservationReads().listReservationsPage(options);
      },
      listReservations: (options) =>
        reservationReads().listReservations(options),
      listActiveReservationsPage: (interval, page) =>
        reservationReads().listActiveReservationsPage(interval, page),
    }),
  };
};
type EntryDotypos = ReturnType<typeof makeEntryDotypos>;

/**
 * The engine with the real intake and fire-chunk handlers and planner
 * steps 4 and 8 over the test database and `dotypos`; every other step is
 * idle.
 */
export const entryEngineLayer = async (input: {
  readonly database: WorkspacePostgresTestDatabase;
  readonly dotypos: EntryDotypos;
  readonly queue: AutomationUnitQueueFake;
  readonly limits?: { readonly total: number; readonly deliver: number };
}) => {
  const base = Layer.merge(input.database.layer, input.dotypos.layer);
  const candidates = CampaignCandidateRepository.Default.pipe(
    Layer.provide(input.database.layer)
  );
  const audienceFacts = AudienceFactsService.Default.pipe(
    Layer.provide(Layer.merge(candidates, input.dotypos.layer))
  );
  const recipients = CampaignRecipientService.Default.pipe(
    Layer.provide(Layer.merge(candidates, audienceFacts))
  );
  const evaluationFacts = AutomationEvaluationFacts.Default.pipe(
    Layer.provide(base)
  );
  const dependencies = Layer.mergeAll(base, recipients, evaluationFacts);
  const handlers = await Effect.runPromise(
    Effect.all([makeIntakeHandler, makeFireChunkHandler]).pipe(
      Effect.provide(dependencies)
    )
  );
  return automationEngineTestLayer({
    database: input.database,
    queue: input.queue,
    handlers,
    ...(input.limits && { limits: input.limits }),
    intakePlanning: AutomationIntakePlanning.Default.pipe(
      Layer.provide(Layer.merge(input.database.layer, evaluationFacts))
    ),
    schedulePlanning: AutomationSchedulePlanning.Default.pipe(
      Layer.provide(Layer.merge(input.database.layer, evaluationFacts))
    ),
  });
};

/**
 * A profile Dotypos returns, reachable at a test-domain address; the local
 * part keeps the id's end, within the 64 characters an address allows.
 */
const entryCustomer = (
  id: DotyposCustomerId,
  email = `${id.slice(-48)}@example.test`
): DotyposCustomer =>
  ({
    id,
    _cloudId: DotyposCloudIdSchema.make("automation-entry-cloud"),
    firstName: "Test",
    email,
    points: "0",
    flags: "0",
    display: true,
    deleted: false,
    tags: [],
  }) as DotyposCustomer;

/**
 * Seeds the Workspace and Dotypos side of entry scenarios under one run
 * prefix and removes everything it created.
 */
export const makeEntryFixtures = (
  database: WorkspacePostgresTestDatabase,
  dotypos: EntryDotypos,
  prefix: string
) => {
  const { db } = database;
  const created = {
    reservations: [] as WorkspaceReservationId[],
    events: [] as CustomerEventId[],
    consents: [] as DotyposCustomerId[],
    accounts: [] as CustomerAccountId[],
  };
  const dotyposReservationId = (id: WorkspaceReservationId) =>
    DotyposReservationIdSchema.make(`${id}-dotypos`);

  const customerId = (label: string) =>
    DotyposCustomerIdSchema.make(`${prefix}-${label}`);

  /** A customer Dotypos returns, with an active marketing consent. */
  const addCustomer = async (
    label: string,
    options: { readonly consent?: boolean; readonly email?: string } = {}
  ) => {
    const id = customerId(label);
    dotypos.customers.set(id, entryCustomer(id, options.email));
    if (options.consent ?? true) {
      created.consents.push(id);
      await Effect.runPromise(
        db.insert(customerMarketingConsents).values({
          dotyposCustomerId: id,
          documentHash: "hash",
          locale: "cs-CZ",
          grantedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
          withdrawnAt: null,
        })
      );
    }
    return id;
  };

  /** A Workspace-booked reservation with its visit in Dotypos. */
  const book = async (input: {
    readonly label: string;
    readonly customer: DotyposCustomerId;
    readonly startsAt: Temporal.Instant;
    readonly endsAt: Temporal.Instant;
    readonly reservedDesk?: boolean;
  }) => {
    const id = workspaceReservationIdSchema.make(`${prefix}-${input.label}`);
    created.reservations.push(id);
    const confirmedAt = input.startsAt.subtract({ hours: 48 });
    await Effect.runPromise(
      db.insert(workspaceReservations).values({
        id,
        checkoutAttemptKey: checkoutAttemptKeySchema.make(id),
        dotyposCustomerId: input.customer,
        dotyposReservationId: dotyposReservationId(id),
        reservationState: "confirmed",
        reservationConfirmedAt: confirmedAt,
        paymentState: "paid",
        paidAt: confirmedAt,
        fulfillmentState: "fulfilled",
        fulfilledAt: confirmedAt,
        reservationDetails: input.reservedDesk
          ? { kind: "cowork", entryTier: "reserved-desk", coffee: true }
          : { kind: "cowork", entryTier: "open-space", coffee: false },
        locale: "cs-CZ",
        createdAt: confirmedAt,
      })
    );
    moveVisit(id, input);
    return id;
  };

  /** Changes a visit in Dotypos only, as a reschedule or cancellation there does. */
  const moveVisit = (
    id: WorkspaceReservationId,
    visit: {
      readonly startsAt: Temporal.Instant;
      readonly endsAt: Temporal.Instant;
      readonly customer?: DotyposCustomerId;
      readonly status?: "CONFIRMED" | "CANCELLED";
    }
  ) => {
    const existing = dotypos.reservations.get(dotyposReservationId(id));
    dotypos.reservations.set(dotyposReservationId(id), {
      id: dotyposReservationId(id),
      _branchId: "automation-entry-branch",
      _cloudId: "automation-entry-cloud",
      _customerId: visit.customer ?? existing?._customerId ?? "",
      startDate: visit.startsAt.toString(),
      endDate: visit.endsAt.toString(),
      seats: "1",
      status: visit.status ?? "CONFIRMED",
    } as DotyposReservation);
  };

  /** Removes a visit from Dotypos, as deleting it there does. */
  const deleteVisit = (id: WorkspaceReservationId) =>
    dotypos.reservations.delete(dotyposReservationId(id));

  const recordEvent = async (input: {
    readonly kind: CustomerEventKind;
    readonly customer: DotyposCustomerId;
    readonly occurredAt: Temporal.Instant;
    readonly reservationId?: WorkspaceReservationId;
    readonly recordedAt?: Temporal.Instant;
  }) => {
    let customerAccountId: CustomerAccountId | null = null;
    if (input.kind === "account-created") {
      customerAccountId =
        `${prefix}-account-${created.accounts.length}` as CustomerAccountId;
      created.accounts.push(customerAccountId);
      await Effect.runPromise(
        db.insert(customerAccounts).values({ id: customerAccountId })
      );
    }
    const [event] = await Effect.runPromise(
      db
        .insert(customerEvents)
        .values({
          kind: input.kind,
          occurredAt: input.occurredAt,
          recordedAt: input.recordedAt ?? input.occurredAt,
          dotyposCustomerId: input.customer,
          workspaceReservationId: input.reservationId ?? null,
          customerAccountId,
        })
        .returning({ id: customerEvents.id })
    );
    created.events.push(event!.id);
    return event!.id;
  };

  const cleanup = async () => {
    const { pool } = database;
    await pool.query(
      "delete from email_campaign_automation_work_units where kind = 'intake' and subject->'eventIds' ?| $1",
      [created.events]
    );
    await pool.query(
      "update email_campaign_automation_runs set trigger_event_id = null where trigger_event_id = any($1)",
      [created.events]
    );
    await pool.query("delete from customer_events where id = any($1)", [
      created.events,
    ]);
    await pool.query(
      "delete from customer_marketing_consents where dotypos_customer_id = any($1)",
      [created.consents]
    );
    await pool.query("delete from workspace_reservations where id = any($1)", [
      created.reservations,
    ]);
    await pool.query("delete from customer_accounts where id = any($1)", [
      created.accounts,
    ]);
  };

  return {
    customerId,
    addCustomer,
    book,
    moveVisit,
    deleteVisit,
    recordEvent,
    cleanup,
    created,
  };
};

type EntryEngineLayer = Awaited<ReturnType<typeof entryEngineLayer>>;

/** Runs `effect` on the engine with the clock at `at`. */
export const runEngineAt = <A, E>(
  effect: Effect.Effect<A, E, Layer.Success<EntryEngineLayer>>,
  layer: EntryEngineLayer,
  at: Temporal.Instant
) =>
  Effect.runPromise(
    TestClock.setTime(at.epochMilliseconds).pipe(
      Effect.andThen(effect),
      Effect.provide(Layer.merge(layer, TestClock.layer()))
    )
  );

/** One planner run, then every unit it enqueued, as the minute cron and queue would. */
export const planAndProcess = (queue: AutomationUnitQueueFake) =>
  Effect.flatMap(AutomationPlanner, (planner) => planner.plan).pipe(
    Effect.flatMap((summary) =>
      drainAutomationUnitQueue(queue).pipe(
        Effect.map((deliveries) => ({ summary, deliveries }))
      )
    )
  );
