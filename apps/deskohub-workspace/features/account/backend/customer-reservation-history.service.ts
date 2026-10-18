import {
  type DotyposCustomerId,
  type DotyposReservation,
  type DotyposReservationId,
  DotyposService,
  type ExternalAPIError,
  getCustomerDisplayName,
  type NetworkError,
  type ValidationError,
} from "@deskohub/dotypos";
import { desc, eq, or } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Array as EffectArray, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import { workspaceReservations } from "@/db/schema";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import type {
  CustomerReservationHistory,
  CustomerReservationParty,
  CustomerReservationProduct,
  CustomerReservationStatus,
  CustomerReservationSummary,
} from "../contracts";
import { groupCustomerReservations } from "../contracts";
import type {
  CustomerAccountAccessError,
  CustomerAccountId,
  LinkedCustomerAccount,
} from "../customer-account";
import { requireAccountActivity } from "./customer-account-activity";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import {
  isCustomerOwnAuthor,
  type ReservationAuthor,
  ReservationAuthorDirectory,
} from "./reservation-author-directory.service";

/** How many ids one Dotypos `id|in|` filter carries, keeping its URL short. */
const providerIdBatchSize = 50;

type CustomerReservationHistoryError =
  | EffectDrizzleQueryError
  | SqlError.SqlError
  | ExternalAPIError
  | NetworkError
  | ValidationError;

type ReservationRow = {
  readonly id: (typeof workspaceReservations.$inferSelect)["id"];
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly authorAccountId: CustomerAccountId | null;
  readonly dotyposReservationId: DotyposReservationId | null;
  readonly reservationDetails: (typeof workspaceReservations.$inferSelect)["reservationDetails"];
  readonly reservationState: (typeof workspaceReservations.$inferSelect)["reservationState"];
  readonly fulfillmentState: (typeof workspaceReservations.$inferSelect)["fulfillmentState"];
};

const getReservationProduct = (
  row: ReservationRow | undefined
): CustomerReservationProduct => {
  const details = row?.reservationDetails;
  if (!details) return { kind: "other" };
  switch (details.kind) {
    case "cowork":
      return { kind: "cowork", tier: details.entryTier };
    case "meeting-room":
      return { kind: "meeting-room" };
    case "office":
      return { kind: "office" };
  }
};

const getReservationStatus = (
  reservation: DotyposReservation,
  row: ReservationRow | undefined
): CustomerReservationStatus => {
  if (
    reservation.status === "CANCELLED" ||
    row?.reservationState === "cancelled" ||
    row?.reservationState === "hold_expired"
  ) {
    return "cancelled";
  }
  if (
    row?.reservationState === "cancellation_failed" ||
    row?.fulfillmentState === "failed"
  ) {
    return "requires-attention";
  }
  return reservation.status === "CONFIRMED" ? "confirmed" : "pending";
};

const startInstantOrder = (reservation: DotyposReservation) => {
  const time = Date.parse(reservation.startDate ?? "");
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
};

/**
 * The account's own customer's reservations and the ones the account booked
 * for other customers, newest start first. An unparseable start sorts last.
 */
const mergeByStartDescending = (
  own: readonly DotyposReservation[],
  bookedForOthers: readonly DotyposReservation[]
) => {
  const ownIds = new Set(own.flatMap((reservation) => reservation.id ?? []));
  return [
    ...own,
    ...bookedForOthers.filter(
      (reservation) => !reservation.id || !ownIds.has(reservation.id)
    ),
  ].toSorted((a, b) => startInstantOrder(b) - startInstantOrder(a));
};

/**
 * What the account history knows about a row's other party. A row for another
 * customer was booked by this account (only those rows are selected), and a
 * row for the account's own customer with a different author was booked by
 * that author. A missing author description means the directory read failed.
 */
type PartyRelation =
  | { readonly kind: "booked-for"; readonly customerId: DotyposCustomerId }
  | { readonly kind: "booked-by"; readonly author: ReservationAuthor | null };

const getPartyRelation = (
  account: LinkedCustomerAccount,
  row: ReservationRow,
  authors: ReadonlyMap<CustomerAccountId, ReservationAuthor>
): PartyRelation | undefined => {
  if (row.dotyposCustomerId !== account.dotyposCustomerId) {
    return { kind: "booked-for", customerId: row.dotyposCustomerId };
  }
  if (!row.authorAccountId || row.authorAccountId === account.accountId) {
    return undefined;
  }
  const author = authors.get(row.authorAccountId) ?? null;
  return author && isCustomerOwnAuthor(author, row.dotyposCustomerId)
    ? undefined
    : { kind: "booked-by", author };
};

const getNamedCustomerId = (relation: PartyRelation | undefined) => {
  if (relation?.kind === "booked-for") return relation.customerId;
  return relation?.author?.kind === "active"
    ? (relation.author.dotyposCustomerId ?? undefined)
    : undefined;
};

const toReservationParty = (
  relation: PartyRelation,
  names: ReadonlyMap<DotyposCustomerId, string>
): CustomerReservationParty => {
  const customerId = getNamedCustomerId(relation);
  const name = (customerId && names.get(customerId)) ?? null;
  if (relation.kind === "booked-for") {
    return { kind: "booked-for", customerName: name };
  }
  return relation.author?.kind === "deleted"
    ? { kind: "booked-by-deleted-account" }
    : { kind: "booked-by", authorName: name };
};

const toReservationSummary = (
  reservation: DotyposReservation,
  row: ReservationRow | undefined,
  party: CustomerReservationParty | undefined,
  index: number
): CustomerReservationSummary => ({
  id: row?.id ?? reservation.id ?? `${reservation.startDate}:${index}`,
  ...(row?.id && { workspaceReservationId: row.id }),
  ...(party && { party }),
  product: getReservationProduct(row),
  startsAt: reservation.startDate,
  endsAt: reservation.endDate,
  seats: /^\d+$/.test(reservation.seats) ? Number(reservation.seats) : null,
  status: getReservationStatus(reservation, row),
});

interface ICustomerReservationHistoryService {
  readonly load: (
    account: LinkedCustomerAccount
  ) => Effect.Effect<
    CustomerReservationHistory,
    CustomerAccountAccessError | CustomerReservationHistoryError
  >;
}

export class CustomerReservationHistoryService extends Context.Service<
  CustomerReservationHistoryService,
  ICustomerReservationHistoryService
>()("@deskohub-workspace/account/CustomerReservationHistoryService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const dotypos = yield* DotyposService;
      const links = yield* CustomerAccountLinkRepository;
      const authorDirectory = yield* ReservationAuthorDirectory;

      const logUnavailableParty = (code: string) =>
        Effect.logWarning("Reservation history party unavailable").pipe(
          Effect.annotateLogs({ code })
        );

      // Names only label a reservation, so a failed read leaves the party
      // unnamed instead of failing the history.
      const describeAuthors = (rows: readonly ReservationRow[]) =>
        authorDirectory
          .describe(
            rows.flatMap((row) =>
              row.authorAccountId ? [row.authorAccountId] : []
            )
          )
          .pipe(
            Effect.tapError(() =>
              logUnavailableParty("account.reservation-history.authors")
            ),
            Effect.orElseSucceed(
              () => new Map<CustomerAccountId, ReservationAuthor>()
            )
          );

      const readCustomerNames = (ids: readonly DotyposCustomerId[]) =>
        Effect.all(
          EffectArray.chunksOf([...new Set(ids)], providerIdBatchSize).map(
            (batchIds) => dotypos.getCustomers({ ids: batchIds })
          ),
          { concurrency: "inherit" }
        ).pipe(
          Effect.map(
            (batches) =>
              new Map<DotyposCustomerId, string>(
                batches.flat().flatMap((customer) => {
                  const name = getCustomerDisplayName(customer);
                  return customer.id && name
                    ? [[customer.id, name] as const]
                    : [];
                })
              )
          ),
          Effect.tapError(() =>
            logUnavailableParty("account.reservation-history.names")
          ),
          Effect.orElseSucceed(() => new Map<DotyposCustomerId, string>())
        );

      const listBookedForOthers = (rows: readonly ReservationRow[]) =>
        Effect.all(
          EffectArray.chunksOf(
            rows.flatMap((row) =>
              row.dotyposReservationId ? [row.dotyposReservationId] : []
            ),
            providerIdBatchSize
          ).map((ids) =>
            dotypos.listReservations({ ids, order: "startDateDescending" })
          ),
          { concurrency: "inherit" }
        ).pipe(Effect.map((batches) => batches.flat()));

      const load = Effect.fn("CustomerReservationHistoryService.load")(
        function* (account: LinkedCustomerAccount) {
          yield* requireAccountActivity(links, account.accountId);

          // The account's own customer's reservations, and the ones the
          // account booked for other customers.
          const rows = yield* db
            .select({
              id: workspaceReservations.id,
              dotyposCustomerId: workspaceReservations.dotyposCustomerId,
              authorAccountId: workspaceReservations.authorAccountId,
              dotyposReservationId: workspaceReservations.dotyposReservationId,
              reservationDetails: workspaceReservations.reservationDetails,
              reservationState: workspaceReservations.reservationState,
              fulfillmentState: workspaceReservations.fulfillmentState,
            })
            .from(workspaceReservations)
            .where(
              or(
                eq(
                  workspaceReservations.dotyposCustomerId,
                  account.dotyposCustomerId
                ),
                eq(workspaceReservations.authorAccountId, account.accountId)
              )
            )
            .orderBy(desc(workspaceReservations.createdAt));
          const [ownReservations, bookedForOthers, authors] = yield* Effect.all(
            [
              dotypos.listReservations({
                customerId: account.dotyposCustomerId,
                order: "startDateDescending",
              }),
              listBookedForOthers(
                rows.filter(
                  (row) => row.dotyposCustomerId !== account.dotyposCustomerId
                )
              ),
              describeAuthors(
                rows.filter(
                  (row) =>
                    row.dotyposCustomerId === account.dotyposCustomerId &&
                    row.authorAccountId !== account.accountId
                )
              ),
            ],
            { concurrency: "inherit" }
          );
          const rowsByReservationId = new Map(
            rows.flatMap((row) =>
              row.dotyposReservationId
                ? [[row.dotyposReservationId, row] as const]
                : []
            )
          );
          const entries = mergeByStartDescending(
            ownReservations,
            bookedForOthers
          ).map((reservation) => {
            const row = reservation.id
              ? rowsByReservationId.get(reservation.id)
              : undefined;
            return {
              reservation,
              row,
              relation: row && getPartyRelation(account, row, authors),
            };
          });
          const names = yield* readCustomerNames(
            entries.flatMap(
              ({ relation }) => getNamedCustomerId(relation) ?? []
            )
          );
          const summaries = entries.map(
            ({ reservation, row, relation }, index) =>
              toReservationSummary(
                reservation,
                row,
                relation && toReservationParty(relation, names),
                index
              )
          );
          return {
            kind: "available",
            groups: groupCustomerReservations(summaries),
          } as const;
        }
      );

      return { load } satisfies ICustomerReservationHistoryService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        WorkspaceDotyposLayer,
        CustomerAccountLinkRepository.Live,
        ReservationAuthorDirectory.Live
      )
    )
  );
}
