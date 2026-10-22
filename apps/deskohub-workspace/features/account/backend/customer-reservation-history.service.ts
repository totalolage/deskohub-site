import {
  type DotyposCustomerId,
  type DotyposReservationId,
  DotyposService,
  getCustomerDisplayName,
  readInIdFilterBatches,
} from "@deskohub/dotypos";
import { desc, eq, or } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Option } from "effect";
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import { workspaceReservations } from "@/db/schema";
import type { ReservationRecord } from "@/features/reservation/backend/reservation-record";
import {
  ReservationRecords,
  type ReservationRecordsError,
} from "@/features/reservation/backend/reservation-records";
import { ReviewAccounts, ReviewSandbox } from "@/features/review-accounts";
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
} from "../customer-account";
import { requireAccountActivity } from "./customer-account-activity";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import {
  isCustomerOwnAuthor,
  type ReservationAuthor,
  ReservationAuthorDirectory,
} from "./reservation-author-directory.service";

type CustomerReservationHistoryError =
  | EffectDrizzleQueryError
  | SqlError.SqlError
  | ReservationRecordsError;

/**
 * The account whose history loads. The history always holds the reservations
 * the account authored, and the ones of its linked customer once it has one,
 * so an account that booked before completing its profile still sees them.
 */
export type ReservationHistoryAccount = {
  readonly accountId: CustomerAccountId;
  readonly dotyposCustomerId?: DotyposCustomerId;
};

type ReservationRow = {
  readonly id: (typeof workspaceReservations.$inferSelect)["id"];
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly authorAccountId: CustomerAccountId;
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
  reservation: ReservationRecord,
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
  // Workspace records a paid hold's confirmation itself, so a shared
  // snapshot taken before it can't show a paid booking as pending.
  return reservation.status === "CONFIRMED" ||
    row?.reservationState === "confirmed"
    ? "confirmed"
    : "pending";
};

const startInstantOrder = (reservation: ReservationRecord) => {
  const time = Date.parse(reservation.startDate ?? "");
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
};

/**
 * The account's own customer's reservations and the ones the account booked
 * for other customers, newest start first. An unparseable start sorts last.
 */
const mergeByStartDescending = (
  own: readonly ReservationRecord[],
  bookedForOthers: readonly ReservationRecord[]
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
 * customer, as is every row of an account without a linked customer, was
 * booked by this account (only those rows are selected), and a
 * row for the account's own customer with a different author was booked by
 * that author. A missing author description means the directory read failed.
 */
type PartyRelation =
  | { readonly kind: "booked-for"; readonly customerId: DotyposCustomerId }
  | { readonly kind: "booked-by"; readonly author: ReservationAuthor | null };

const getPartyRelation = (
  account: ReservationHistoryAccount,
  row: ReservationRow,
  authors: ReadonlyMap<CustomerAccountId, ReservationAuthor>
): PartyRelation | undefined => {
  if (row.dotyposCustomerId !== account.dotyposCustomerId) {
    return { kind: "booked-for", customerId: row.dotyposCustomerId };
  }
  if (row.authorAccountId === account.accountId) {
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
  reservation: ReservationRecord,
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

/** The provider reservations and authors the account history describes. */
type ReservationSources = {
  readonly own: readonly ReservationRecord[];
  readonly bookedForOthers: readonly ReservationRecord[];
  readonly authors: ReadonlyMap<CustomerAccountId, ReservationAuthor>;
};

type HistoryEntry = {
  readonly reservation: ReservationRecord;
  readonly row: ReservationRow | undefined;
  readonly relation: PartyRelation | undefined;
};

const isBookedForOtherCustomer = (
  account: ReservationHistoryAccount,
  row: ReservationRow
) => row.dotyposCustomerId !== account.dotyposCustomerId;

/**
 * Pairs every provider reservation, newest start first, with its local row
 * and the row's other party.
 */
const relateReservations = ({
  account,
  rows,
  sources,
}: {
  readonly account: ReservationHistoryAccount;
  readonly rows: readonly ReservationRow[];
  readonly sources: ReservationSources;
}): readonly HistoryEntry[] => {
  const rowsByReservationId = new Map(
    rows.flatMap((row) =>
      row.dotyposReservationId ? [[row.dotyposReservationId, row] as const] : []
    )
  );
  return mergeByStartDescending(sources.own, sources.bookedForOthers).map(
    (reservation) => {
      const row = reservation.id
        ? rowsByReservationId.get(reservation.id)
        : undefined;
      return {
        reservation,
        row,
        relation: row && getPartyRelation(account, row, sources.authors),
      };
    }
  );
};

const toReservationHistory = ({
  entries,
  names,
}: {
  readonly entries: readonly HistoryEntry[];
  readonly names: ReadonlyMap<DotyposCustomerId, string>;
}): CustomerReservationHistory => ({
  kind: "available",
  groups: groupCustomerReservations(
    entries.map(({ reservation, row, relation }, index) =>
      toReservationSummary(
        reservation,
        row,
        relation && toReservationParty(relation, names),
        index
      )
    )
  ),
});

/** What a history load includes beyond the reservations themselves. */
export type ReservationHistoryOptions = {
  /**
   * Whether to read the other party's name from Dotypos for reservations
   * booked for or by someone else. Defaults to true; a caller that never shows
   * names passes false to skip the read.
   */
  readonly includePartyNames?: boolean;
};

interface ICustomerReservationHistoryService {
  readonly load: (
    account: ReservationHistoryAccount,
    options?: ReservationHistoryOptions
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
      const records = yield* ReservationRecords;
      const links = yield* CustomerAccountLinkRepository;
      const authorDirectory = yield* ReservationAuthorDirectory;
      const reviewAccounts = yield* ReviewAccounts;
      const sandbox = yield* ReviewSandbox;

      const logUnavailableParty = (code: string) =>
        Effect.logWarning("Reservation history party unavailable").pipe(
          Effect.annotateLogs({ code })
        );

      /**
       * The account's own customer's reservations, when it has one, and the
       * ones the account booked for other customers.
       */
      const selectReservationRows = ({
        account,
      }: {
        readonly account: ReservationHistoryAccount;
      }) =>
        db
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
              account.dotyposCustomerId === undefined
                ? undefined
                : eq(
                    workspaceReservations.dotyposCustomerId,
                    account.dotyposCustomerId
                  ),
              eq(workspaceReservations.authorAccountId, account.accountId)
            )
          )
          .orderBy(desc(workspaceReservations.createdAt));

      const listRecorded = (rows: readonly ReservationRow[]) =>
        records.listByIds(
          rows.flatMap((row) =>
            row.dotyposReservationId ? [row.dotyposReservationId] : []
          )
        );

      const listOwn = ({
        customerId,
        rows,
      }: {
        readonly customerId: DotyposCustomerId;
        readonly rows: readonly ReservationRow[];
      }) =>
        records.listForCustomer({
          customerId,
          recordedIds: rows.flatMap((row) =>
            row.dotyposCustomerId === customerId && row.dotyposReservationId
              ? [row.dotyposReservationId]
              : []
          ),
        });

      // Names only label a reservation, so a failed read leaves the party
      // unnamed instead of failing the history.
      const describeAuthors = (rows: readonly ReservationRow[]) =>
        authorDirectory.describe(rows.map((row) => row.authorAccountId)).pipe(
          Effect.tapError(() =>
            logUnavailableParty("account.reservation-history.authors")
          ),
          Effect.orElseSucceed(
            () => new Map<CustomerAccountId, ReservationAuthor>()
          )
        );

      const readReservationSources = ({
        account,
        rows,
      }: {
        readonly account: ReservationHistoryAccount;
        readonly rows: readonly ReservationRow[];
      }): Effect.Effect<ReservationSources, CustomerReservationHistoryError> =>
        Effect.all(
          {
            own: Option.match(
              Option.fromUndefinedOr(account.dotyposCustomerId),
              {
                onNone: () => Effect.succeed([]),
                onSome: (customerId) => listOwn({ customerId, rows }),
              }
            ),
            bookedForOthers: listRecorded(
              rows.filter((row) => isBookedForOtherCustomer(account, row))
            ),
            authors: describeAuthors(
              rows.filter(
                (row) =>
                  !isBookedForOtherCustomer(account, row) &&
                  row.authorAccountId !== account.accountId
              )
            ),
          },
          { concurrency: "inherit" }
        );

      const readPartyNames = ({
        entries,
        includePartyNames,
      }: {
        readonly entries: readonly HistoryEntry[];
        readonly includePartyNames: boolean;
      }) =>
        includePartyNames
          ? readPartyNamesOf(entries)
          : Effect.succeed(new Map<DotyposCustomerId, string>());

      const readPartyNamesOf = (entries: readonly HistoryEntry[]) =>
        readInIdFilterBatches(
          entries.flatMap(({ relation }) => getNamedCustomerId(relation) ?? []),
          (ids) => dotypos.getCustomers({ ids })
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

      const loadRecorded = (
        account: ReservationHistoryAccount,
        options: ReservationHistoryOptions
      ) =>
        Effect.succeed({
          account,
          includePartyNames: options.includePartyNames ?? true,
        }).pipe(
          Effect.bind("rows", selectReservationRows),
          Effect.bind("sources", readReservationSources),
          Effect.let("entries", relateReservations),
          Effect.bind("names", readPartyNames),
          Effect.map(toReservationHistory)
        );

      // A review account's reservations all live in its sandbox.
      const load = (
        account: ReservationHistoryAccount,
        options: ReservationHistoryOptions = {}
      ) =>
        requireAccountActivity(links, account.accountId).pipe(
          Effect.andThen(reviewAccounts.isReviewAccount(account.accountId)),
          Effect.flatMap((review) =>
            review
              ? sandbox.history(account.accountId)
              : loadRecorded(account, options)
          ),
          Effect.withSpan("CustomerReservationHistoryService.load")
        );

      return { load } satisfies ICustomerReservationHistoryService;
    })
  );

  /**
   * The history wired to read reservation details from `records`: live for
   * the account page, shared snapshots for customers' AI agents.
   */
  static withRecords = <E>(records: Layer.Layer<ReservationRecords, E>) =>
    this.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          WorkspaceDatabase.Default,
          WorkspaceDotyposLayer,
          records,
          CustomerAccountLinkRepository.Live,
          ReservationAuthorDirectory.Live,
          ReviewAccounts.Live,
          ReviewSandbox.Live
        )
      )
    );

  static Live = this.withRecords(ReservationRecords.Live);
}
