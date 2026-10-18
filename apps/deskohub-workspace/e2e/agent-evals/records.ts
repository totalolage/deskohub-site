import {
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
 * Lists the Dotypos reservations the account authored for its seeded
 * customer, so the run's journal can cancel them even when judging never
 * happened. A booking made for another contact belongs to a customer the run
 * didn't create, so cleanup leaves it alone.
 */
export const readAgentEvalReservationIds = Effect.fn(
  "readAgentEvalReservationIds"
)(function* (accountId: string, dotyposCustomerId: string) {
  const { db } = yield* E2EDatabase;
  const rows = yield* runDatabaseOperation(
    "read agent eval reservation ids",
    db
      .select({
        dotyposCustomerId: workspaceReservations.dotyposCustomerId,
        dotyposReservationId: workspaceReservations.dotyposReservationId,
      })
      .from(workspaceReservations)
      .where(
        eq(
          workspaceReservations.authorAccountId,
          sensitiveDatabaseParameter(accountId)
        )
      )
  );
  return [
    ...new Set(
      rows.flatMap((row) =>
        row.dotyposReservationId && row.dotyposCustomerId === dotyposCustomerId
          ? [row.dotyposReservationId]
          : []
      )
    ),
  ];
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
          providerOrderId: paymentAttempts.providerOrderId,
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
          orderIds: ownAttempts.flatMap((attempt) =>
            attempt.providerOrderId ? [attempt.providerOrderId] : []
          ),
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
