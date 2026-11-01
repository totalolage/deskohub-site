import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposReservation,
  DotyposService,
  toCustomerEmailIdentity,
} from "@deskohub/dotypos";
import { or, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { workspaceReservations } from "@/db/schema/workspace-reservations";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { sensitiveDatabaseParameter } from "@/shared/backend/logging/database-query-parameter-classifier";
import { tryWorkspaceE2ESync, workspaceE2EError } from "../errors";
import { evidenceDigest } from "../soak-native";
import type { RunOwnership } from "../soak-ownership";
import { E2EDatabase } from "./database.service";
import { runRetrySafeDatabaseOperation } from "./database-operation";

export type OwnedReservationRow = Pick<
  typeof workspaceReservations.$inferSelect,
  "dotyposCustomerId" | "dotyposReservationId"
>;

/** Ownership inputs include paid, unlinked and retained rows, without joins. */
export const readRunOwnedReservationRows = Effect.fn(
  "E2E.readRunOwnedReservationRows"
)(function* (ownership: RunOwnership) {
  const { db } = yield* E2EDatabase;
  const customerIds = yield* tryWorkspaceE2ESync(
    "decode owned customer IDs",
    () =>
      ownership.customerIds.map((id) =>
        Schema.decodeUnknownSync(DotyposCustomerIdSchema)(id)
      )
  );
  const accountIds = yield* tryWorkspaceE2ESync(
    "decode owned account IDs",
    () =>
      ownership.accountIds.map((id) =>
        Schema.decodeUnknownSync(customerAccountIdSchema)(id)
      )
  );
  if (customerIds.length === 0 && accountIds.length === 0) {
    return [] as readonly OwnedReservationRow[];
  }
  return yield* runRetrySafeDatabaseOperation(
    "read all run-owned reservation rows",
    db
      .select({
        dotyposCustomerId: workspaceReservations.dotyposCustomerId,
        dotyposReservationId: workspaceReservations.dotyposReservationId,
      })
      .from(workspaceReservations)
      .where(
        or(
          sql`${workspaceReservations.dotyposCustomerId} = any(${sensitiveDatabaseParameter(sql.param(customerIds))}::text[])`,
          sql`${workspaceReservations.authorAccountId} = any(${sensitiveDatabaseParameter(sql.param(accountIds))}::text[])`
        )
      )
  );
});

/**
 * Scan the complete active inventory first, then resolve every returned owner
 * including deleted profiles. A duplicate email's unjournaled customer and
 * reservations cannot disappear behind findCustomer's active-only result.
 */
export const enumerateRunOwnedReservations = Effect.fn(
  "E2E.enumerateRunOwnedReservations"
)(function* (
  ownership: RunOwnership,
  databaseRows: readonly OwnedReservationRow[]
) {
  const dotypos = yield* DotyposService;
  if (ownership.intents.length === 0)
    return yield* workspaceE2EError("Unknown interval coverage");
  const intervals = [
    ...new Map(
      ownership.intents.map(({ startDate, endDate }) => [
        `${startDate}/${endDate}`,
        { startDate, endDate },
      ])
    ).values(),
  ];
  const reservations = new Map<string, DotyposReservation>();
  let pageCount = 0;
  for (const interval of intervals) {
    let page = 1;
    const intervalIds = new Set<string>();
    while (true) {
      const result = yield* dotypos.listActiveReservationsPage(
        {
          startDate: new Date(interval.startDate),
          endDate: new Date(interval.endDate),
        },
        page
      );
      pageCount++;
      for (const reservation of result.reservations) {
        if (
          !reservation.id ||
          !reservation._customerId ||
          !reservation.status ||
          intervalIds.has(reservation.id)
        ) {
          return yield* workspaceE2EError("Unknown active inventory coverage");
        }
        intervalIds.add(reservation.id);
        const previous = reservations.get(reservation.id);
        if (
          previous &&
          JSON.stringify(previous) !== JSON.stringify(reservation)
        ) {
          return yield* workspaceE2EError(
            "Active inventory changed during enumeration"
          );
        }
        reservations.set(reservation.id, reservation);
      }
      if (Option.isNone(result.nextPage)) break;
      if (result.nextPage.value !== page + 1)
        return yield* workspaceE2EError("Unknown inventory page coverage");
      page = result.nextPage.value;
    }
  }
  const candidates = [...reservations.values()];
  const customerIds = yield* tryWorkspaceE2ESync(
    "decode reservation owner IDs",
    () =>
      [
        ...new Set([
          ...ownership.customerIds,
          ...databaseRows.map((row) => row.dotyposCustomerId),
          ...candidates.map((reservation) => reservation._customerId),
        ]),
      ].map((id) => Schema.decodeUnknownSync(DotyposCustomerIdSchema)(id))
  );
  const customers = [
    ...(yield* dotypos.getCustomersByIds(customerIds, {
      concurrency: 1,
    })).values(),
  ];
  const returned = new Set(customers.map(({ id }) => id));
  if (
    returned.size !== customers.length ||
    customerIds.some((id) => !returned.has(id))
  ) {
    return yield* workspaceE2EError("Unknown reservation customer coverage");
  }
  const emails = new Set(ownership.emails.map(toCustomerEmailIdentity));
  const ownedIds = new Set<DotyposCustomerId>(
    databaseRows.map((row) => row.dotyposCustomerId)
  );
  for (const id of ownership.customerIds)
    ownedIds.add(Schema.decodeUnknownSync(DotyposCustomerIdSchema)(id));
  for (const customer of customers) {
    if (
      customer.id &&
      customer.email &&
      emails.has(toCustomerEmailIdentity(customer.email))
    ) {
      ownedIds.add(customer.id);
    }
  }
  const active = candidates.filter(
    (reservation) =>
      reservation._customerId &&
      ownedIds.has(reservation._customerId) &&
      reservation.status !== "CANCELLED"
  );
  return {
    ownedActiveCount: active.length,
    intervalCount: intervals.length,
    pageCount,
    customerCount: customers.length,
    parametersSha256: evidenceDigest(
      JSON.stringify({ ownership, databaseRows, intervals })
    ),
    responseSha256: evidenceDigest(
      JSON.stringify({ reservations: candidates, customers })
    ),
  };
});
