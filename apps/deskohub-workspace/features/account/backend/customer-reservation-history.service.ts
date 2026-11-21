import {
  type DotyposCustomerId,
  type DotyposReservationId,
  DotyposService,
  getCustomerDisplayName,
} from "@deskohub/dotypos";
import {
  and,
  arrayOverlaps,
  desc,
  eq,
  exists,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Option } from "effect";
import type { SqlError } from "effect/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  passEntryClaims,
  unlimitedPassDayMoves,
  workspaceReservations,
} from "@/db/schema";
import { defaultLocale, type Locale } from "@/features/i18n";
import { isEndedUnpaidPaymentState } from "@/features/order";
import {
  type BookedInterval,
  type BookedReservation,
  decodeBookedReservation,
} from "@/features/reservation/backend/booked-reservation";
import { getStoredRebookingSelection } from "@/features/reservation/backend/booking-selection";
import {
  type OnSiteReservation,
  ReservationOnSite,
  type ReservationOnSiteDetails,
} from "@/features/reservation/backend/reservation-on-site-details";
import type { ReservationRecord } from "@/features/reservation/backend/reservation-record";
import {
  ReservationRecords,
  type ReservationRecordsError,
} from "@/features/reservation/backend/reservation-records";
import {
  type ListedReservation,
  ReservationWithdrawalAvailability,
} from "@/features/reservation/backend/reservation-withdrawals";
import { StoredReservationDetails } from "@/features/reservation/backend/stored-reservation-details.server";
import type {
  StoredWorkspaceReservationDetails,
  WorkspaceReservationId,
} from "@/features/reservation/persistence-contracts";
import { ReviewAccounts, ReviewSandbox } from "@/features/review-accounts";
import type { WithdrawalAvailability } from "@/features/withdrawal/withdrawal-read-model";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { temporalInstantToIsoString } from "@/shared/utils/temporal";
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
import { getReservationProductName } from "../reservation-product-name";
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
  /** Undefined when the stored document is malformed. */
  readonly reservationDetails: StoredWorkspaceReservationDetails | undefined;
  readonly reservationState: (typeof workspaceReservations.$inferSelect)["reservationState"];
  /** The payment state its order mirrors. */
  readonly paymentState: (typeof workspaceReservations.$inferSelect)["paymentState"];
  readonly fulfillmentState: (typeof workspaceReservations.$inferSelect)["fulfillmentState"];
  readonly reservationPurpose: (typeof workspaceReservations.$inferSelect)["reservationPurpose"];
  readonly paidAt: (typeof workspaceReservations.$inferSelect)["paidAt"];
  readonly paidWithEntryPack: boolean;
  readonly unlimitedPassDay: boolean;
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

/**
 * The reservation states that settle the status Workspace shows, whatever
 * the shared Dotypos snapshot says. Workspace records a paid hold's
 * confirmation itself, so a snapshot taken before it can't show a paid
 * booking as pending.
 */
const statusByReservationState: Partial<
  Record<ReservationRow["reservationState"], CustomerReservationStatus>
> = {
  cancelled: "cancelled",
  hold_expired: "cancelled",
  cancellation_failed: "requires-attention",
  confirmed: "confirmed",
};

type LocalReservationStatusFacts = Pick<
  ReservationRow,
  "reservationState" | "fulfillmentState" | "paymentState"
>;

/** The status Workspace's own row settles; a cancellation always wins. */
export const getLocalReservationStatus = (
  row: LocalReservationStatusFacts | undefined
): CustomerReservationStatus | undefined => {
  if (row === undefined) return undefined;
  const stateStatus = statusByReservationState[row.reservationState];
  if (stateStatus === "cancelled") return stateStatus;
  if (row.fulfillmentState === "failed") return "requires-attention";
  return stateStatus;
};

/**
 * A hold whose payment ended unpaid isn't booked, even while Dotypos still
 * holds it for a retry; Dotypos's own confirmation keeps it booked.
 */
export const getReservationStatus = (
  reservation: ReservationRecord,
  row: LocalReservationStatusFacts | undefined
): CustomerReservationStatus => {
  if (reservation.status === "CANCELLED") return "cancelled";
  const localStatus = getLocalReservationStatus(row);
  if (localStatus !== undefined) return localStatus;
  if (reservation.status === "CONFIRMED") return "confirmed";
  return row && isEndedUnpaidPaymentState(row.paymentState)
    ? "cancelled"
    : "pending";
};

/**
 * The account's own customer's reservations and the ones the account booked
 * for other customers, each once.
 */
const mergeReservations = (
  own: readonly ReservationRecord[],
  bookedForOthers: readonly ReservationRecord[]
) => {
  const ownIds = new Set(own.map((reservation) => reservation.id));
  return [
    ...own,
    ...bookedForOthers.filter((reservation) => !ownIds.has(reservation.id)),
  ];
};

/** Newest booked start first; an unparseable start sorts last. */
const startOrder = ({ booked }: HistoryEntry) =>
  Option.match(booked.start, {
    onNone: () => Number.NEGATIVE_INFINITY,
    onSome: (start) => start.epochMilliseconds,
  });

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

/**
 * The booked start, and the setup start of an early-setup meeting room, whose
 * Dotypos start is the setup start. Other reservations keep Dotypos's start;
 * derived instants use its millisecond ISO format, so every start reads alike.
 */
const getBookedStartFields = (
  reservation: ReservationRecord,
  booked: BookedReservation
): Pick<CustomerReservationSummary, "startsAt" | "setupStartsAt"> =>
  Option.match(
    Option.all({ setupStart: booked.setupStart, start: booked.start }),
    {
      onNone: () => ({ startsAt: reservation.startDate }),
      onSome: ({ setupStart, start }) => ({
        startsAt: temporalInstantToIsoString(start),
        setupStartsAt: temporalInstantToIsoString(setupStart),
      }),
    }
  );

const toReservationSummary = (
  { reservation, row, booked }: HistoryEntry,
  party: CustomerReservationParty | undefined,
  todayAccess: CustomerReservationSummary["todayAccess"],
  withdrawal: CustomerReservationSummary["withdrawal"],
  onSite: CustomerReservationSummary["onSite"]
): CustomerReservationSummary => {
  const bookedSelection = row && getRebookingSelectionOf(row, booked);
  return {
    id: row?.id ?? reservation.id,
    ...(row?.id && { workspaceReservationId: row.id }),
    ...(row?.paidWithEntryPack && { paidWithEntryPack: true }),
    ...(party && { party }),
    product: getReservationProduct(row),
    ...getBookedStartFields(reservation, booked),
    endsAt: reservation.endDate,
    // History shows no seat count when Dotypos's is unreadable.
    seats: Option.getOrNull(booked.seats),
    status: getReservationStatus(reservation, row),
    ...(row && getAccessWindowFields(booked)),
    ...(bookedSelection && { bookedSelection }),
    ...(todayAccess && { todayAccess }),
    ...(withdrawal && { withdrawal }),
    ...(onSite && { onSite }),
  };
};

/** The span a website order's door code covers, as its issuance derives it. */
const getAccessWindowFields = (
  booked: BookedReservation
): Pick<CustomerReservationSummary, "accessStartsAt" | "accessEndsAt"> =>
  Option.match(booked.occupiedInterval, {
    onNone: () => ({}),
    onSome: ({ startsAt, endsAt }) => ({
      accessStartsAt: temporalInstantToIsoString(startsAt),
      accessEndsAt: temporalInstantToIsoString(endsAt),
    }),
  });

/** What booking the row's stored product again sends, over its booked time. */
const getRebookingSelectionOf = (
  row: ReservationRow,
  booked: BookedReservation
) => {
  const details = row.reservationDetails;
  if (!details) return undefined;
  return Option.match(booked.interval, {
    onNone: () => undefined,
    onSome: ({ startsAt, endsAt }) =>
      getStoredRebookingSelection({
        details,
        booked,
        timing: { reservedFrom: startsAt, reservedUntil: endsAt },
      }),
  });
};

/** The provider reservations and authors the account history describes. */
type ReservationSources = {
  readonly own: readonly ReservationRecord[];
  readonly bookedForOthers: readonly ReservationRecord[];
  readonly authors: ReadonlyMap<CustomerAccountId, ReservationAuthor>;
};

type HistoryEntry = {
  readonly reservation: ReservationRecord;
  readonly row: ReservationRow | undefined;
  /** Decoded with the row's stored details, so it holds the booked time. */
  readonly booked: BookedReservation;
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
  movedPassDayIds,
}: {
  readonly account: ReservationHistoryAccount;
  readonly rows: readonly ReservationRow[];
  readonly sources: ReservationSources;
  readonly movedPassDayIds: ReadonlySet<DotyposReservationId>;
}): readonly HistoryEntry[] => {
  const rowsByReservationId = new Map(
    rows.flatMap((row) =>
      row.dotyposReservationId ? [[row.dotyposReservationId, row] as const] : []
    )
  );
  return mergeReservations(sources.own, sources.bookedForOthers)
    .flatMap((reservation): HistoryEntry[] => {
      const row = rowsByReservationId.get(reservation.id);
      // A provider hold can exist before its ID is attached locally, or
      // outlive attachment when it is replaced or cancelled.
      if (
        row?.unlimitedPassDay ||
        reservation.unlimitedPassDay ||
        movedPassDayIds.has(reservation.id)
      )
        return [];
      return [
        {
          reservation,
          row,
          booked: decodeBookedReservation(reservation, row?.reservationDetails),
          relation: row && getPartyRelation(account, row, sources.authors),
        },
      ];
    })
    .toSorted((a, b) => startOrder(b) - startOrder(a));
};

const toReservationHistory = ({
  entries,
  names,
  access,
  withdrawals,
  onSite,
}: {
  readonly entries: readonly HistoryEntry[];
  readonly names: ReadonlyMap<DotyposCustomerId, string>;
  readonly access: ReservationHistoryAccess;
  readonly withdrawals: ReadonlyMap<
    WorkspaceReservationId,
    WithdrawalAvailability
  >;
  readonly onSite: ReadonlyMap<
    WorkspaceReservationId,
    ReservationOnSiteDetails
  >;
}): CustomerReservationHistory => ({
  kind: "available",
  groups: groupCustomerReservations(
    entries.map((entry) =>
      toReservationSummary(
        entry,
        entry.relation && toReservationParty(entry.relation, names),
        entry.row && access.get(entry.row.id),
        entry.row && withdrawals.get(entry.row.id),
        entry.row && onSite.get(entry.row.id)
      )
    )
  ),
});

/**
 * A history entry whose table and Wi-Fi its customer was emailed: a
 * confirmed website order.
 */
const toOnSiteReservation = ({
  reservation,
  row,
}: HistoryEntry): readonly OnSiteReservation[] =>
  row?.reservationDetails &&
  getReservationStatus(reservation, row) === "confirmed"
    ? [
        {
          id: row.id,
          reservationDetails: row.reservationDetails,
          dotyposReservation: reservation,
        },
      ]
    : [];

/** A history entry the withdrawal entry point can assess: a booked website order. */
const toListedReservation = ({
  row,
  booked,
}: HistoryEntry): readonly ListedReservation[] => {
  const reservationDetails = row?.reservationDetails;
  if (!(row && reservationDetails)) return [];
  return Option.match(Option.all([booked.start, booked.end]), {
    onNone: () => [],
    onSome: ([reservedFrom, reservedUntil]) => [
      {
        id: row.id,
        authorAccountId: row.authorAccountId,
        reservationState: row.reservationState,
        paymentState: row.paymentState,
        reservationPurpose: row.reservationPurpose,
        paidAt: row.paidAt,
        reservationDetails,
        reservedFrom,
        reservedUntil,
      },
    ],
  });
};

/** Names every reservation of a history in `locale`. */
const withProductNames = (
  history: CustomerReservationHistory,
  locale: Locale
): CustomerReservationHistory => {
  if (history.kind !== "available") return history;
  const name = (reservation: CustomerReservationSummary) => ({
    ...reservation,
    productName: getReservationProductName(reservation.product, locale),
  });
  return {
    kind: "available",
    groups: {
      current: history.groups.current.map(name),
      past: history.groups.past.map(name),
      unavailable: history.groups.unavailable.map(name),
    },
  };
};

/** What a history load includes beyond the reservations themselves. */
export type ReservationHistoryOptions = {
  /**
   * Whether to read the other party's name from Dotypos for reservations
   * booked for or by someone else. Defaults to true; a caller that never shows
   * names passes false to skip the read.
   */
  readonly includePartyNames?: boolean;
  readonly includeEntryPackPayment?: boolean;
  /** The language of the reservations' product names; the default locale when absent. */
  readonly locale?: Locale;
};

/**
 * A website order in a history read live from Dotypos, with the provider
 * record the history just read for it.
 */
export type LiveReservationHistoryOrder = {
  readonly orderId: WorkspaceReservationId;
  readonly record: ReservationRecord;
  readonly status: CustomerReservationStatus;
  /** The span its door code covers, when it can be read. */
  readonly accessInterval: Option.Option<BookedInterval>;
};

/** Door codes of a history's orders, by order. */
type ReservationHistoryAccess = ReadonlyMap<
  WorkspaceReservationId,
  NonNullable<CustomerReservationSummary["todayAccess"]>
>;

/**
 * Resolves the door codes a history shows from the provider records it read.
 * Only a history whose records come straight from Dotypos takes one.
 */
export type LiveReservationHistoryAccessLookup = (
  orders: readonly LiveReservationHistoryOrder[],
  locale: Locale
) => Effect.Effect<ReservationHistoryAccess>;

interface ICustomerReservationHistoryService {
  readonly load: (
    account: ReservationHistoryAccount,
    options?: ReservationHistoryOptions
  ) => Effect.Effect<
    CustomerReservationHistory,
    CustomerAccountAccessError | CustomerReservationHistoryError
  >;
}

/**
 * The history's implementation. `lookupAccess` resolves the door codes it
 * shows; without it the history shows none. Only a history built over
 * `ReservationRecords.Provider` passes one
 * (`CustomerReservationHistoryWithAccessService`).
 */
export const makeCustomerReservationHistory = Effect.fn(function* (
  lookupAccess?: LiveReservationHistoryAccessLookup
) {
  const { db } = yield* WorkspaceDatabase;
  const dotypos = yield* DotyposService;
  const records = yield* ReservationRecords;
  const links = yield* CustomerAccountLinkRepository;
  const authorDirectory = yield* ReservationAuthorDirectory;
  const reviewAccounts = yield* ReviewAccounts;
  const sandbox = yield* ReviewSandbox;
  // Only a history whose caller provides it shows withdrawal entry points.
  const withdrawalAvailability = yield* Effect.serviceOption(
    ReservationWithdrawalAvailability
  );
  // Likewise the table and Wi-Fi of confirmed bookings.
  const reservationOnSite = yield* Effect.serviceOption(ReservationOnSite);

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
    includeEntryPackPayment,
  }: {
    readonly account: ReservationHistoryAccount;
    readonly includeEntryPackPayment: boolean;
  }) =>
    db
      .select({
        id: workspaceReservations.id,
        dotyposCustomerId: workspaceReservations.dotyposCustomerId,
        authorAccountId: workspaceReservations.authorAccountId,
        dotyposReservationId: workspaceReservations.dotyposReservationId,
        reservationDetails: workspaceReservations.reservationDetails,
        reservationState: workspaceReservations.reservationState,
        paymentState: workspaceReservations.paymentState,
        fulfillmentState: workspaceReservations.fulfillmentState,
        reservationPurpose: workspaceReservations.reservationPurpose,
        paidAt: workspaceReservations.paidAt,
        unlimitedPassDay: sql<boolean>`${workspaceReservations.passId} is not null`,
        paidWithEntryPack: includeEntryPackPayment
          ? sql<boolean>`${exists(
              db
                .select({ reservationId: passEntryClaims.reservationId })
                .from(passEntryClaims)
                .where(
                  and(
                    eq(passEntryClaims.reservationId, workspaceReservations.id),
                    eq(passEntryClaims.status, "consumed")
                  )
                )
            )}`
          : sql<boolean>`false`,
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
      .orderBy(desc(workspaceReservations.createdAt))
      .pipe(
        Effect.map((rows) =>
          rows.map(
            (row): ReservationRow => ({
              ...row,
              reservationDetails: Option.getOrUndefined(
                StoredReservationDetails.project(row.reservationDetails)
              ),
            })
          )
        )
      );

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
        !row.unlimitedPassDay &&
        row.dotyposCustomerId === customerId &&
        row.dotyposReservationId
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
        own: Option.match(Option.fromUndefinedOr(account.dotyposCustomerId), {
          onNone: () => Effect.succeed([]),
          onSome: (customerId) => listOwn({ customerId, rows }),
        }),
        bookedForOthers: listRecorded(
          rows.filter(
            (row) =>
              !row.unlimitedPassDay && isBookedForOtherCustomer(account, row)
          )
        ),
        authors: describeAuthors(
          rows.filter(
            (row) =>
              !row.unlimitedPassDay &&
              !isBookedForOtherCustomer(account, row) &&
              row.authorAccountId !== account.accountId
          )
        ),
      },
      { concurrency: "unbounded" }
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

  const readMovedPassDayIds = Effect.fnUntraced(function* ({
    sources,
  }: {
    readonly sources: ReservationSources;
  }) {
    // A provider edit may remove a marker from a replaced or staged hold.
    // Read the audit after the provider list so a concurrent move is visible.
    const ids = mergeReservations(sources.own, sources.bookedForOthers).flatMap(
      (record) => (record.unlimitedPassDay ? [] : [record.id])
    );
    if (ids.length === 0) return new Set<DotyposReservationId>();
    const rows = yield* db
      .select({
        source: unlimitedPassDayMoves.sourceReservationId,
        target: unlimitedPassDayMoves.targetReservationId,
        ambiguous: unlimitedPassDayMoves.ambiguousReservationIds,
      })
      .from(unlimitedPassDayMoves)
      .where(
        or(
          inArray(unlimitedPassDayMoves.sourceReservationId, ids),
          inArray(unlimitedPassDayMoves.targetReservationId, ids),
          arrayOverlaps(unlimitedPassDayMoves.ambiguousReservationIds, ids)
        )
      );
    return new Set(
      rows.flatMap(({ source, target, ambiguous }) => [
        source,
        ...(target ? [target] : []),
        ...(ambiguous ?? []),
      ])
    );
  });

  const readPartyNamesOf = (entries: readonly HistoryEntry[]) =>
    dotypos
      .getCustomersByIds(
        entries.flatMap(({ relation }) => getNamedCustomerId(relation) ?? [])
      )
      .pipe(
        Effect.map(
          (customers) =>
            new Map<DotyposCustomerId, string>(
              [...customers].flatMap(([id, customer]) => {
                const name = getCustomerDisplayName(customer);
                return name ? [[id, name] as const] : [];
              })
            )
        ),
        Effect.tapError(() =>
          logUnavailableParty("account.reservation-history.names")
        ),
        Effect.orElseSucceed(() => new Map<DotyposCustomerId, string>())
      );

  const readAccess = ({
    entries,
    locale,
  }: {
    readonly entries: readonly HistoryEntry[];
    readonly locale: Locale;
  }): Effect.Effect<ReservationHistoryAccess> =>
    lookupAccess
      ? lookupAccess(entries.flatMap(toLiveOrder), locale)
      : Effect.succeed(new Map());

  const readWithdrawals = ({
    account,
    entries,
  }: {
    readonly account: ReservationHistoryAccount;
    readonly entries: readonly HistoryEntry[];
  }) =>
    Option.match(withdrawalAvailability, {
      onNone: () =>
        Effect.succeed(
          new Map<WorkspaceReservationId, WithdrawalAvailability>()
        ),
      onSome: (availability) =>
        availability.forReservations({
          accountId: account.accountId,
          reservations: entries.flatMap(toListedReservation),
        }),
    });

  const readOnSite = ({
    entries,
  }: {
    readonly entries: readonly HistoryEntry[];
  }) =>
    Option.match(reservationOnSite, {
      onNone: () =>
        Effect.succeed(
          new Map<WorkspaceReservationId, ReservationOnSiteDetails>()
        ),
      onSome: (onSite) =>
        onSite.forReservations(entries.flatMap(toOnSiteReservation)),
    });

  const loadRecorded = (
    account: ReservationHistoryAccount,
    options: ReservationHistoryOptions & { readonly locale: Locale }
  ) =>
    Effect.succeed({
      account,
      includePartyNames: options.includePartyNames ?? true,
      includeEntryPackPayment: options.includeEntryPackPayment ?? false,
      locale: options.locale,
    }).pipe(
      Effect.bind("rows", selectReservationRows),
      Effect.bind("sources", readReservationSources),
      Effect.bind("movedPassDayIds", readMovedPassDayIds),
      Effect.let("entries", relateReservations),
      Effect.bind("lookups", (input) =>
        Effect.all(
          {
            names: readPartyNames(input),
            access: readAccess(input),
            withdrawals: readWithdrawals(input),
            onSite: readOnSite(input),
          },
          { concurrency: "unbounded" }
        )
      ),
      Effect.map(({ entries, lookups }) =>
        toReservationHistory({ entries, ...lookups })
      )
    );

  // A review account's reservations all live in its sandbox.
  const load = (
    account: ReservationHistoryAccount,
    { locale = defaultLocale, ...options }: ReservationHistoryOptions = {}
  ) =>
    requireAccountActivity(links, account.accountId).pipe(
      Effect.andThen(reviewAccounts.isReviewAccount(account.accountId)),
      Effect.flatMap((review) =>
        review
          ? sandbox.history(account.accountId)
          : loadRecorded(account, { ...options, locale })
      ),
      Effect.map((history) => withProductNames(history, locale)),
      Effect.withSpan("CustomerReservationHistoryService.load")
    );

  return { load } satisfies ICustomerReservationHistoryService;
});

export class CustomerReservationHistoryService extends Context.Service<
  CustomerReservationHistoryService,
  ICustomerReservationHistoryService
>()("@deskohub-workspace/account/CustomerReservationHistoryService") {
  static Default = Layer.effect(this, makeCustomerReservationHistory());

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

/** An entry's website order, when it is one. */
const toLiveOrder = ({
  reservation,
  row,
  booked,
}: HistoryEntry): readonly LiveReservationHistoryOrder[] =>
  row
    ? [
        {
          orderId: row.id,
          record: reservation,
          status: getReservationStatus(reservation, row),
          accessInterval: booked.occupiedInterval,
        },
      ]
    : [];
