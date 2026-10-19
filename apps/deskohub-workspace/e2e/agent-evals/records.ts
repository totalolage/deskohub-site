import {
  type DotyposCustomer,
  type DotyposCustomerId,
  type DotyposReservationId,
  DotyposService,
  ExternalAPIError,
} from "@deskohub/dotypos";
import { eq, inArray } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { paymentAttempts } from "@/db/schema/payment-attempts";
import { workspaceReservations } from "@/db/schema/workspace-reservations";
import {
  type StoredWorkspaceReservationDetails,
  storedWorkspaceReservationDetailsSchema,
} from "@/features/reservation/persistence-contracts";
import { sensitiveDatabaseParameter } from "@/shared/backend/logging/database-query-parameter-classifier";
import { readSyntheticCustomerProfile } from "../account/fixtures";
import type { WorkspaceE2EAccountJournal } from "../account/journal";
import {
  isNotFound,
  type WorkspaceE2EAccountJournalEvidence,
} from "../account/reconcile";
import type { DatasourceConfig } from "../config";
import { toWorkspaceE2EError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { runDatabaseOperation } from "../integrations/database-operation";
import { getDotyposLayer, parseDotyposInstant } from "../integrations/dotypos";
import type { AgentEvalReservationRecord } from "./judges";

const decodeStoredDetails = Schema.decodeUnknownOption(
  storedWorkspaceReservationDetailsSchema
);

const toProduct = (
  details: StoredWorkspaceReservationDetails
): AgentEvalReservationRecord["product"] => {
  switch (details.kind) {
    case "cowork":
      return { family: "cowork", tier: details.entryTier };
    case "meeting-room":
      return details.duration
        ? { duration: details.duration, family: "meeting-room" }
        : { family: "meeting-room" };
    case "office":
      return {
        family: "office",
        ...(details.seats === undefined ? {} : { seats: details.seats }),
        ...(details.dayCount === undefined
          ? {}
          : { dayCount: details.dayCount }),
      };
  }
};

/**
 * Every reservation the run's account authored, with the customer each is
 * for (the seeded profile or another contact) and its payment-provider
 * orders. The account exists only for this run, so all of them are the
 * run's.
 */
const readAgentEvalAuthoredReservations = Effect.fn(
  "readAgentEvalAuthoredReservations"
)(function* (accountId: string) {
  const { db } = yield* E2EDatabase;
  const reservations = yield* runDatabaseOperation(
    "read agent eval authored reservations",
    db
      .select({
        dotyposCustomerId: workspaceReservations.dotyposCustomerId,
        dotyposReservationId: workspaceReservations.dotyposReservationId,
        id: workspaceReservations.id,
      })
      .from(workspaceReservations)
      .where(
        eq(
          workspaceReservations.authorAccountId,
          sensitiveDatabaseParameter(accountId)
        )
      )
  );
  if (reservations.length === 0) return { orderIds: [], reservations };
  const attempts = yield* runDatabaseOperation(
    "read agent eval payment orders",
    db
      .select({ providerOrderId: paymentAttempts.providerOrderId })
      .from(paymentAttempts)
      .where(
        inArray(
          paymentAttempts.workspaceReservationId,
          reservations.map((reservation) => reservation.id)
        )
      )
  );
  return {
    orderIds: attempts.flatMap((attempt) =>
      attempt.providerOrderId ? [attempt.providerOrderId] : []
    ),
    reservations,
  };
});

/**
 * Whether Dotypos created the profile after the run started. Checkout's
 * find-or-create reuses an existing contact's profile, which the run must
 * leave alone.
 */
export const isCreatedDuringAgentEvalRun = (
  customer: Pick<DotyposCustomer, "created">,
  runStartedAt: string
) =>
  typeof customer.created === "string" &&
  Date.parse(customer.created) >= Date.parse(runStartedAt);

const readCustomerIfPresent = (
  datasourceConfig: DatasourceConfig,
  customerId: string
) =>
  readSyntheticCustomerProfile(
    datasourceConfig,
    customerId as DotyposCustomerId
  ).pipe(
    Effect.map(Option.some),
    Effect.catchIf(isNotFound("getCustomer"), () => Effect.succeedNone)
  );

/** The Dotypos and payment identifiers a run produced, for its journal and redaction. */
export type AgentEvalRunResources = {
  readonly dotyposReservationIds: readonly string[];
  /** Profiles the run created: the seeded one and any new contact's. */
  readonly dotyposCustomerIds: readonly string[];
  /** Every identifier that must not reach the run's artifacts. */
  readonly identifiers: readonly string[];
};

/**
 * Reads what the run's account created through checkout: every reservation
 * it authored, for whichever contact, and each contact profile Dotypos
 * created during the run. A booking for an existing customer journals the
 * hold but not that customer's profile.
 */
export const readAgentEvalRunResources = Effect.fn("readAgentEvalRunResources")(
  function* (
    datasourceConfig: DatasourceConfig,
    accountId: string,
    runStartedAt: string
  ) {
    const authored = yield* readAgentEvalAuthoredReservations(accountId);
    const contactIds = [
      ...new Set(
        authored.reservations.flatMap((reservation) =>
          reservation.dotyposCustomerId ? [reservation.dotyposCustomerId] : []
        )
      ),
    ];
    const createdContactIds = yield* Effect.forEach(
      contactIds,
      (customerId) =>
        readCustomerIfPresent(datasourceConfig, customerId).pipe(
          Effect.map((customer) =>
            Option.isSome(customer) &&
            isCreatedDuringAgentEvalRun(customer.value, runStartedAt)
              ? [customerId]
              : []
          )
        ),
      { concurrency: 4 }
    ).pipe(Effect.map((ids) => ids.flat()));
    const dotyposReservationIds = [
      ...new Set(
        authored.reservations.flatMap((reservation) =>
          reservation.dotyposReservationId
            ? [reservation.dotyposReservationId]
            : []
        )
      ),
    ];
    return {
      dotyposCustomerIds: createdContactIds,
      dotyposReservationIds,
      identifiers: [
        accountId,
        ...contactIds,
        ...dotyposReservationIds,
        ...authored.reservations.map((reservation) => reservation.id),
        ...authored.orderIds,
      ],
    } satisfies AgentEvalRunResources;
  }
);

const settledReservationIds = (
  datasourceConfig: DatasourceConfig,
  reservationIds: readonly string[]
) =>
  Effect.forEach(reservationIds, (reservationId) =>
    readProviderReservation(datasourceConfig, reservationId).pipe(
      Effect.map((reservation) =>
        Option.isSome(reservation) && reservation.value.status === "CANCELLED"
          ? [reservationId]
          : []
      )
    )
  ).pipe(Effect.map((ids) => new Set(ids.flat())));

const settledCustomerIds = (
  datasourceConfig: DatasourceConfig,
  customerIds: readonly string[]
) =>
  Effect.forEach(customerIds, (customerId) =>
    readCustomerIfPresent(datasourceConfig, customerId).pipe(
      Effect.map((customer) =>
        Option.isSome(customer) &&
        customer.value.expireDate != null &&
        Date.parse(customer.value.expireDate) <= Date.now()
          ? [customerId]
          : []
      )
    )
  ).pipe(Effect.map((ids) => new Set(ids.flat())));

/**
 * Proves the run created the journaled resources of another contact: the
 * run's account authored the hold, and Dotypos created the contact's profile
 * during the run. Cleanup deletes the reservation rows that prove authorship
 * only after it cancelled and expired everything they prove, so on a repeat
 * a resource they no longer prove is already cancelled or expired and counts
 * as settled; anything else unproven still fails validation.
 */
export const proveAgentEvalRunOwnership = Effect.fn(
  "proveAgentEvalRunOwnership"
)(function* (
  datasourceConfig: DatasourceConfig,
  journal: WorkspaceE2EAccountJournal
) {
  const [accountId] = journal.authUserIds;
  const owned = accountId
    ? yield* readAgentEvalRunResources(
        datasourceConfig,
        accountId,
        journal.startedAt
      )
    : undefined;
  const ownedReservationIds = new Set(owned?.dotyposReservationIds);
  const ownedCustomerIds = new Set(owned?.dotyposCustomerIds);
  return {
    dotyposCustomerIds: {
      ownedIds: ownedCustomerIds,
      settledIds: yield* settledCustomerIds(
        datasourceConfig,
        journal.dotyposCustomerIds.filter((id) => !ownedCustomerIds.has(id))
      ),
    },
    dotyposReservationIds: {
      ownedIds: ownedReservationIds,
      settledIds: yield* settledReservationIds(
        datasourceConfig,
        journal.dotyposReservationIds.filter(
          (id) => !ownedReservationIds.has(id)
        )
      ),
    },
  } satisfies WorkspaceE2EAccountJournalEvidence;
});

/**
 * The reservations among `dotyposReservationIds` that reached payment. Their
 * payment attempts carry accounting snapshots and invoices the database
 * refuses to delete, so cleanup cancels them in Dotypos but keeps their rows.
 */
export const readAgentEvalPaymentLedgerReservationIds = Effect.fn(
  "readAgentEvalPaymentLedgerReservationIds"
)(function* (dotyposReservationIds: readonly string[]) {
  if (dotyposReservationIds.length === 0) return [];
  const { db } = yield* E2EDatabase;
  const rows = yield* runDatabaseOperation(
    "read agent eval payment ledger reservation ids",
    db
      .selectDistinct({
        dotyposReservationId: workspaceReservations.dotyposReservationId,
      })
      .from(workspaceReservations)
      .innerJoin(
        paymentAttempts,
        eq(paymentAttempts.workspaceReservationId, workspaceReservations.id)
      )
      .where(
        inArray(
          workspaceReservations.dotyposReservationId,
          dotyposReservationIds as DotyposReservationId[]
        )
      )
  );
  return rows.flatMap((row) =>
    row.dotyposReservationId ? [row.dotyposReservationId as string] : []
  );
});

const readProviderReservation = Effect.fn("readProviderReservation")(
  function* (_datasourceConfig: DatasourceConfig, reservationId: string) {
    const dotypos = yield* DotyposService;
    const { reservation } = yield* dotypos.getReservation(
      reservationId as DotyposReservationId
    );
    return Option.some(reservation);
  },
  (effect, datasourceConfig) =>
    effect.pipe(
      Effect.catchIf(
        (cause) =>
          cause instanceof ExternalAPIError && cause.statusCode === 404,
        () => Effect.succeedNone
      ),
      Effect.provide(getDotyposLayer(datasourceConfig)),
      Effect.mapError((cause) =>
        toWorkspaceE2EError("read agent eval Dotypos reservation", cause)
      )
    )
);

/**
 * Reads every reservation the run's synthetic account authored: product
 * intent and payment state from the preview database, dates and seats from
 * Dotypos, which owns them.
 */
export const readAgentEvalReservations = Effect.fn("readAgentEvalReservations")(
  function* (datasourceConfig: DatasourceConfig, accountId: string) {
    const { db } = yield* E2EDatabase;
    const reservations = yield* runDatabaseOperation(
      "read agent eval reservations",
      db
        .select({
          createdAt: workspaceReservations.createdAt,
          details: workspaceReservations.reservationDetails,
          dotyposReservationId: workspaceReservations.dotyposReservationId,
          id: workspaceReservations.id,
          paymentState: workspaceReservations.paymentState,
        })
        .from(workspaceReservations)
        .where(
          eq(
            workspaceReservations.authorAccountId,
            sensitiveDatabaseParameter(accountId)
          )
        )
    );
    if (reservations.length === 0) return [];
    const attempts = yield* runDatabaseOperation(
      "read agent eval payment attempts",
      db
        .select({
          state: paymentAttempts.state,
          workspaceReservationId: paymentAttempts.workspaceReservationId,
        })
        .from(paymentAttempts)
        .where(
          inArray(
            paymentAttempts.workspaceReservationId,
            reservations.map((reservation) => reservation.id)
          )
        )
    );

    return yield* Effect.forEach(
      reservations,
      Effect.fnUntraced(function* (reservation) {
        const details = decodeStoredDetails(reservation.details);
        if (Option.isNone(details)) return [];
        const ownAttempts = attempts.filter(
          (attempt) => attempt.workspaceReservationId === reservation.id
        );
        const provider = reservation.dotyposReservationId
          ? yield* readProviderReservation(
              datasourceConfig,
              reservation.dotyposReservationId
            )
          : Option.none();
        const record: AgentEvalReservationRecord = {
          createdAt: reservation.createdAt.toString(),
          paid:
            reservation.paymentState === "paid" ||
            ownAttempts.some((attempt) => attempt.state === "paid"),
          product: toProduct(details.value),
          ...Option.match(provider, {
            onNone: () => ({}),
            onSome: (providerReservation) => ({
              endsAt: parseDotyposInstant(
                providerReservation.endDate
              ).toString(),
              providerStatus: providerReservation.status,
              seats: Number(providerReservation.seats),
              startsAt: parseDotyposInstant(
                providerReservation.startDate
              ).toString(),
            }),
          }),
        };
        return [record];
      })
    ).pipe(Effect.map((records) => records.flat()));
  }
);
