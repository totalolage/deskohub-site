import { DotyposService } from "@deskohub/dotypos";
import type {
  Customer as DotyposCustomer,
  Reservation as DotyposReservation,
  Table as DotyposTable,
} from "@deskohub/dotypos/generated";
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  inArray,
  max,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  discountApplications,
  legalEvidenceEvents,
  paymentAttempts,
  type WorkspaceReservation,
  webhookEvents,
  workspaceReservations,
} from "@/db/schema";
import { getCurrentPragueDate } from "@/features/reservation/reservation-date";
import { workspaceSiteConstants } from "@/shared/utils";
import { getAdministrationPagination } from "./listing";
import {
  mergeReservationHistory,
  PostHogReservationHistory,
} from "./posthog-reservation-history";
import { getUniqueReservationId } from "./reservation-lookup.server";
import type { AdministrationStatusGroup } from "./reservation-status";
import { getAdministrationReservationStatus } from "./reservation-status";

const reservationPageSize = 24;
const bookingPageSize = 24;
const customerPageSize = 24;
const customerReservationPageSize = 10;

const paymentAttemptStateLabels = {
  created: "Started",
  pending: "Pending",
  paid: "Paid",
  failed: "Unsuccessful",
  cancelled: "Unsuccessful",
  expired: "Unsuccessful",
} as const;

export type AdministrationReservationListInput = {
  readonly customerId?: string;
  readonly date?: string;
  readonly page?: number;
  readonly status?: Exclude<AdministrationStatusGroup, "attention">;
  readonly type?: "cowork" | "meeting-room";
};

type ReservationListInput = AdministrationReservationListInput & {
  readonly pageSize?: number;
};

export type AdministrationCustomerListInput = {
  readonly page?: number;
};

export type AdministrationCustomer = {
  readonly id: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
};

export type AdministrationReservationSummary = {
  readonly id: string;
  readonly customerId: string;
  readonly customer: AdministrationCustomer | null;
  readonly liveDetailsAvailable: boolean;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly date: string | null;
  readonly type: "cowork" | "meeting-room";
  readonly typeLabel: string;
  readonly status: ReturnType<typeof getAdministrationReservationStatus>;
  readonly updatedAt: string;
};

export type AdministrationReservationPage = {
  readonly items: readonly AdministrationReservationSummary[];
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
};

export type AdministrationBookingSummary = {
  readonly id: string;
  readonly customerId: string | null;
  readonly customer: AdministrationCustomer | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly seats: string;
  readonly status: "NEW" | "CONFIRMED" | "CANCELLED";
  readonly statusLabel: string;
  readonly tableId: string | null;
  readonly tableName: string | null;
  readonly tableLocation: string | null;
  readonly linkedReservation: {
    readonly id: string;
    readonly label: string;
  } | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
};

export type AdministrationBookingPage = {
  readonly items: readonly AdministrationBookingSummary[];
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
};

export type AdministrationBookingDetail = {
  readonly booking: AdministrationBookingSummary;
  readonly references: {
    readonly bookingId: string;
    readonly customerId: string | null;
    readonly workspaceReservationId: string | null;
  };
};

export type AdministrationPaymentAttempt = {
  readonly id: string;
  readonly providerLabel: string;
  readonly stateLabel: string;
  readonly amount: {
    readonly value: number;
    readonly exponent: number;
    readonly currency: string;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type AdministrationDiscountApplication = {
  readonly id: string;
  readonly label: string;
  readonly amount: {
    readonly value: number;
    readonly exponent: number;
    readonly currency: string;
  };
};

export type AdministrationTimelineItem = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly occurredAt: string;
  readonly tone: "neutral" | "positive" | "warning";
};

export type AdministrationReservationDetail = {
  readonly reservation: AdministrationReservationSummary;
  readonly timeline: readonly AdministrationTimelineItem[];
  readonly paymentAttempts: readonly AdministrationPaymentAttempt[];
  readonly discounts: readonly AdministrationDiscountApplication[];
  readonly otherCustomerReservations: readonly AdministrationReservationSummary[];
  readonly sameDateReservations: readonly AdministrationReservationSummary[];
  readonly references: {
    readonly workspaceReservationId: string;
    readonly dotyposReservationId: string | null;
    readonly customerId: string;
  };
};

export type AdministrationCustomerSummary = {
  readonly customer: AdministrationCustomer | null;
  readonly customerId: string;
  readonly reservationCount: number;
  readonly lastActivityAt: string;
};

type SafeReservationRow = Pick<
  WorkspaceReservation,
  | "id"
  | "dotyposCustomerId"
  | "dotyposReservationId"
  | "reservationState"
  | "paymentState"
  | "fulfillmentState"
  | "reservationDetails"
  | "reservationCreatedAt"
  | "reservationConfirmedAt"
  | "reservationCancelledAt"
  | "paidAt"
  | "fulfilledAt"
  | "fulfillmentFailedAt"
  | "createdAt"
  | "updatedAt"
>;

const safeReservationSelection = {
  id: workspaceReservations.id,
  dotyposCustomerId: workspaceReservations.dotyposCustomerId,
  dotyposReservationId: workspaceReservations.dotyposReservationId,
  reservationState: workspaceReservations.reservationState,
  paymentState: workspaceReservations.paymentState,
  fulfillmentState: workspaceReservations.fulfillmentState,
  reservationDetails: workspaceReservations.reservationDetails,
  reservationCreatedAt: workspaceReservations.reservationCreatedAt,
  reservationConfirmedAt: workspaceReservations.reservationConfirmedAt,
  reservationCancelledAt: workspaceReservations.reservationCancelledAt,
  paidAt: workspaceReservations.paidAt,
  fulfilledAt: workspaceReservations.fulfilledAt,
  fulfillmentFailedAt: workspaceReservations.fulfillmentFailedAt,
  createdAt: workspaceReservations.createdAt,
  updatedAt: workspaceReservations.updatedAt,
} as const;

const toIsoString = (instant: Temporal.Instant) => instant.toString();

const toCustomer = (
  customer: DotyposCustomer,
  fallbackId: string
): AdministrationCustomer => {
  const personalName = [customer.firstName, customer.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    id: customer.id ?? fallbackId,
    displayName:
      personalName || customer.companyName?.trim() || "Unnamed customer",
    email: customer.email?.trim() || null,
    phone: customer.phone?.trim() || null,
  };
};

const getReservationTypeLabel = (row: SafeReservationRow) => {
  if (row.reservationDetails.kind === "meeting-room") return "Meeting Room";
  const tier = row.reservationDetails.entryTier;
  return `Cowork ${tier[0]?.toUpperCase()}${tier.slice(1)}`;
};

const getReservationDate = (startsAt: string) =>
  Temporal.Instant.from(startsAt)
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDate()
    .toString();

type LiveReservationDetails = {
  readonly reservation: DotyposReservation | null;
  readonly customer: DotyposCustomer | null;
};

const toReservationSummary = ({
  live,
  row,
}: {
  readonly live: LiveReservationDetails;
  readonly row: SafeReservationRow;
}): AdministrationReservationSummary => {
  return {
    id: row.id,
    customerId: row.dotyposCustomerId,
    customer: live.customer
      ? toCustomer(live.customer, row.dotyposCustomerId)
      : null,
    liveDetailsAvailable: Boolean(live.reservation),
    startsAt: live.reservation?.startDate ?? null,
    endsAt: live.reservation?.endDate ?? null,
    date: live.reservation
      ? getReservationDate(live.reservation.startDate)
      : null,
    type: row.reservationDetails.kind,
    typeLabel: getReservationTypeLabel(row),
    status: getAdministrationReservationStatus({
      fulfillmentState: row.fulfillmentState,
      paymentState: row.paymentState,
      reservationState: row.reservationState,
    }),
    updatedAt: toIsoString(row.updatedAt),
  };
};

const bookingStatusLabels = {
  NEW: "New",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
} as const;

const toBookingSummary = ({
  booking,
  customer,
  row,
  table,
}: {
  readonly booking: DotyposReservation & { readonly id: string };
  readonly customer: DotyposCustomer | null;
  readonly row: SafeReservationRow | null;
  readonly table: DotyposTable | null;
}): AdministrationBookingSummary => ({
  id: booking.id,
  customerId: booking._customerId ?? null,
  customer:
    booking._customerId && customer
      ? toCustomer(customer, booking._customerId)
      : null,
  startsAt: booking.startDate,
  endsAt: booking.endDate,
  seats: booking.seats,
  status: booking.status,
  statusLabel: bookingStatusLabels[booking.status],
  tableId: booking._tableId ?? null,
  tableName: table?.name ?? null,
  tableLocation: table?.locationName ?? null,
  linkedReservation: row
    ? { id: row.id, label: getReservationTypeLabel(row) }
    : null,
  createdAt: booking.created ?? null,
  updatedAt: booking.versionDate ?? null,
});

const getDateBounds = (date: string) => {
  const plainDate = Temporal.PlainDate.from(date);
  const start = plainDate.toZonedDateTime({
    plainTime: Temporal.PlainTime.from("00:00"),
    timeZone: workspaceSiteConstants.location.timeZone,
  });
  return {
    startsAtOrAfter: start.toInstant().toString(),
    startsBefore: start.add({ days: 1 }).toInstant().toString(),
  };
};

const statusCondition = (
  status: Exclude<AdministrationStatusGroup, "attention">
): SQL => {
  if (status === "complete") {
    return and(
      sql`${workspaceReservations.fulfillmentState} <> 'failed'`,
      sql`${workspaceReservations.reservationState} <> 'cancellation_failed'`,
      eq(workspaceReservations.fulfillmentState, "fulfilled")
    )!;
  }
  if (status === "cancelled") {
    return and(
      sql`${workspaceReservations.fulfillmentState} <> 'failed'`,
      sql`${workspaceReservations.fulfillmentState} <> 'fulfilled'`,
      sql`${workspaceReservations.reservationState} <> 'cancellation_failed'`,
      or(
        eq(workspaceReservations.reservationState, "cancelled"),
        eq(workspaceReservations.reservationState, "hold_expired"),
        eq(workspaceReservations.paymentState, "expired")
      )
    )!;
  }
  return and(
    sql`${workspaceReservations.fulfillmentState} <> 'failed'`,
    sql`${workspaceReservations.fulfillmentState} <> 'fulfilled'`,
    sql`${workspaceReservations.reservationState} not in ('cancelled', 'hold_expired', 'cancellation_failed')`,
    sql`${workspaceReservations.paymentState} <> 'expired'`
  )!;
};

const buildTimeline = (row: SafeReservationRow) => {
  const items: AdministrationTimelineItem[] = [
    {
      id: "workflow-created",
      title: "Checkout started",
      description: "The customer began checkout.",
      occurredAt: toIsoString(row.createdAt),
      tone: "neutral",
    },
  ];
  const add = (
    id: string,
    title: string,
    description: string,
    occurredAt: Temporal.Instant | null,
    tone: AdministrationTimelineItem["tone"]
  ) => {
    if (occurredAt) {
      items.push({
        id,
        title,
        description,
        occurredAt: toIsoString(occurredAt),
        tone,
      });
    }
  };
  add(
    "reservation-created",
    "Reservation held",
    "The booking was held for the customer.",
    row.reservationCreatedAt,
    "neutral"
  );
  add(
    "payment-paid",
    "Payment received",
    "The reservation payment completed.",
    row.paidAt,
    "positive"
  );
  add(
    "reservation-confirmed",
    "Reservation confirmed",
    "The reservation was confirmed.",
    row.reservationConfirmedAt,
    "positive"
  );
  add(
    "fulfilled",
    "Customer access sent",
    "The customer confirmation was delivered.",
    row.fulfilledAt,
    "positive"
  );
  add(
    "fulfillment-failed",
    "Customer confirmation failed",
    "The confirmation could not be completed.",
    row.fulfillmentFailedAt,
    "warning"
  );
  add(
    "cancelled",
    "Reservation cancelled",
    "The held reservation was cancelled.",
    row.reservationCancelledAt,
    "warning"
  );
  return items.toSorted((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt)
  );
};

export class AdministrationService extends Context.Service<
  AdministrationService,
  {
    readonly loadOverview: () => Effect.Effect<
      {
        readonly counts: {
          readonly reservations: number;
          readonly customers: number;
        };
        readonly recent: readonly AdministrationReservationSummary[];
        readonly today: readonly AdministrationReservationSummary[];
        readonly todayUnavailable: boolean;
      },
      unknown
    >;
    readonly listReservations: (
      input: AdministrationReservationListInput
    ) => Effect.Effect<
      AdministrationReservationPage & {
        readonly dateFilterUnavailable: boolean;
      },
      unknown
    >;
    readonly loadReservation: (
      id: string
    ) => Effect.Effect<AdministrationReservationDetail | null, unknown>;
    readonly findReservationId: (
      identifier: string
    ) => Effect.Effect<string | null, unknown>;
    readonly listBookings: (input: {
      readonly date: string;
      readonly page?: number;
    }) => Effect.Effect<AdministrationBookingPage, unknown>;
    readonly loadBooking: (
      id: string
    ) => Effect.Effect<AdministrationBookingDetail, unknown>;
    readonly listCustomers: (
      input: AdministrationCustomerListInput
    ) => Effect.Effect<
      {
        readonly items: readonly AdministrationCustomerSummary[];
        readonly page: number;
        readonly pageCount: number;
        readonly total: number;
      },
      unknown
    >;
    readonly loadCustomerReservations: (input: {
      readonly customerId: string;
      readonly page?: number;
    }) => Effect.Effect<AdministrationReservationPage, unknown>;
  }
>()("@deskohub-workspace/administration/AdministrationService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const dotypos = yield* DotyposService;
      const reservationHistory = yield* PostHogReservationHistory;

      const loadLiveReservation = Effect.fn(
        "AdministrationService.loadLiveReservation"
      )((row: SafeReservationRow): Effect.Effect<LiveReservationDetails> => {
        const loadCustomer = dotypos.getCustomer(row.dotyposCustomerId).pipe(
          Effect.map(
            (customer): LiveReservationDetails => ({
              reservation: null,
              customer,
            })
          ),
          Effect.catch((cause) =>
            Effect.logWarning("Live customer details unavailable", {
              cause,
              workspaceReservationId: row.id,
            }).pipe(Effect.as({ reservation: null, customer: null } as const))
          )
        );

        if (!row.dotyposReservationId) return loadCustomer;

        return dotypos.getReservation(row.dotyposReservationId).pipe(
          Effect.map(
            ({ customer, reservation }): LiveReservationDetails => ({
              customer,
              reservation,
            })
          ),
          Effect.catch((cause) =>
            Effect.logWarning("Live booking details unavailable", {
              cause,
              workspaceReservationId: row.id,
            }).pipe(Effect.andThen(loadCustomer))
          )
        );
      });

      const enrichRows = (rows: readonly SafeReservationRow[]) =>
        Effect.all(
          rows.map((row) =>
            loadLiveReservation(row).pipe(
              Effect.map((live) => toReservationSummary({ live, row }))
            )
          ),
          { concurrency: 5 }
        );

      const loadDateReservationMap = (date?: string) => {
        if (!date) return Effect.succeed(undefined);
        return Effect.try({
          try: () => getDateBounds(date),
          catch: () => undefined,
        }).pipe(
          Effect.flatMap((bounds) =>
            bounds
              ? dotypos
                  .listReservations({
                    ...bounds,
                    order: "startDateAscending",
                  })
                  .pipe(
                    Effect.map(
                      (reservations) =>
                        new Map(
                          reservations.flatMap((reservation) =>
                            reservation.id
                              ? [[reservation.id, reservation] as const]
                              : []
                          )
                        )
                    ),
                    Effect.catch((cause) =>
                      Effect.logWarning("Reservation date filter unavailable", {
                        cause,
                        date,
                      }).pipe(Effect.as(null))
                    )
                  )
              : Effect.succeed(null)
          )
        );
      };

      const listReservations = Effect.fn(
        "AdministrationService.listReservations"
      )(function* (input: ReservationListInput) {
        const pageSize = input.pageSize ?? reservationPageSize;
        const dateReservations = yield* loadDateReservationMap(input.date);
        const conditions: SQL[] = [];
        if (input.customerId) {
          conditions.push(
            eq(workspaceReservations.dotyposCustomerId, input.customerId)
          );
        }
        if (input.status) conditions.push(statusCondition(input.status));
        if (input.type) {
          conditions.push(
            sql`${workspaceReservations.reservationDetails}->>'kind' = ${input.type}`
          );
        }
        if (input.date) {
          const ids = dateReservations ? [...dateReservations.keys()] : [];
          conditions.push(
            ids.length > 0
              ? inArray(workspaceReservations.dotyposReservationId, ids)
              : sql`false`
          );
        }
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const countRows = yield* db
          .select({ value: count() })
          .from(workspaceReservations)
          .where(where);
        const total = Number(countRows[0]?.value ?? 0);
        const pagination = getAdministrationPagination({
          pageSize,
          requestedPage: input.page,
          total,
        });
        const rows = yield* db
          .select(safeReservationSelection)
          .from(workspaceReservations)
          .where(where)
          .orderBy(desc(workspaceReservations.updatedAt))
          .limit(pageSize)
          .offset(pagination.offset);
        return {
          items: yield* enrichRows(rows),
          page: pagination.page,
          pageCount: pagination.pageCount,
          total,
          dateFilterUnavailable: Boolean(
            input.date && dateReservations === null
          ),
        };
      });

      const loadReservation = Effect.fn(
        "AdministrationService.loadReservation"
      )(function* (id: string) {
        const [row] = yield* db
          .select(safeReservationSelection)
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, id))
          .limit(1);
        if (!row) return null;

        const { applicationRows, attemptRows, history, live, otherRows } =
          yield* Effect.all(
            {
              applicationRows: db
                .select({
                  id: discountApplications.id,
                  label: discountApplications.label,
                  appliedAmountValue: discountApplications.appliedAmountValue,
                  appliedAmountExponent:
                    discountApplications.appliedAmountExponent,
                  appliedAmountCurrency:
                    discountApplications.appliedAmountCurrency,
                })
                .from(discountApplications)
                .where(eq(discountApplications.workspaceReservationId, row.id))
                .orderBy(discountApplications.sequence),
              attemptRows: db
                .select({
                  id: paymentAttempts.id,
                  provider: paymentAttempts.provider,
                  state: paymentAttempts.state,
                  amountValue: paymentAttempts.amountValue,
                  amountExponent: paymentAttempts.amountExponent,
                  currency: paymentAttempts.currency,
                  createdAt: paymentAttempts.createdAt,
                  updatedAt: paymentAttempts.updatedAt,
                })
                .from(paymentAttempts)
                .where(eq(paymentAttempts.workspaceReservationId, row.id))
                .orderBy(paymentAttempts.createdAt),
              history: reservationHistory.load(row.id),
              live: loadLiveReservation(row),
              otherRows: db
                .select(safeReservationSelection)
                .from(workspaceReservations)
                .where(
                  and(
                    eq(
                      workspaceReservations.dotyposCustomerId,
                      row.dotyposCustomerId
                    ),
                    sql`${workspaceReservations.id} <> ${row.id}`
                  )
                )
                .orderBy(desc(workspaceReservations.updatedAt))
                .limit(4),
            },
            { concurrency: 5 }
          );

        let sameDateRows: readonly SafeReservationRow[] = [];
        if (live.reservation) {
          const date = getReservationDate(live.reservation.startDate);
          const dateReservations = yield* loadDateReservationMap(date);
          const reservationIds = dateReservations
            ? [...dateReservations.keys()].filter(
                (reservationId) => reservationId !== row.dotyposReservationId
              )
            : [];
          if (reservationIds.length > 0) {
            sameDateRows = yield* db
              .select(safeReservationSelection)
              .from(workspaceReservations)
              .where(
                inArray(
                  workspaceReservations.dotyposReservationId,
                  reservationIds
                )
              )
              .orderBy(desc(workspaceReservations.updatedAt))
              .limit(4);
          }
        }

        const { otherCustomerReservations, sameDateReservations } =
          yield* Effect.all(
            {
              otherCustomerReservations: enrichRows(otherRows),
              sameDateReservations: enrichRows(sameDateRows),
            },
            { concurrency: 2 }
          );

        return {
          reservation: toReservationSummary({ live, row }),
          timeline: mergeReservationHistory({
            durable: buildTimeline(row),
            history,
          }),
          paymentAttempts: attemptRows.map((attempt) => ({
            id: attempt.id,
            providerLabel:
              attempt.provider === "internal" ? "Included" : "Online payment",
            stateLabel: paymentAttemptStateLabels[attempt.state],
            amount: {
              value: attempt.amountValue,
              exponent: attempt.amountExponent,
              currency: attempt.currency,
            },
            createdAt: toIsoString(attempt.createdAt),
            updatedAt: toIsoString(attempt.updatedAt),
          })),
          discounts: applicationRows.map((application) => ({
            id: application.id,
            label: application.label,
            amount: {
              value: application.appliedAmountValue,
              exponent: application.appliedAmountExponent,
              currency: application.appliedAmountCurrency,
            },
          })),
          otherCustomerReservations,
          sameDateReservations,
          references: {
            workspaceReservationId: row.id,
            dotyposReservationId: row.dotyposReservationId,
            customerId: row.dotyposCustomerId,
          },
        } satisfies AdministrationReservationDetail;
      });

      const findReservationId = Effect.fn(
        "AdministrationService.findReservationId"
      )(function* (identifier: string) {
        const {
          applicationRows,
          evidenceRows,
          paymentRows,
          reservationRows,
          webhookRows,
        } = yield* Effect.all(
          {
            reservationRows: db
              .selectDistinct({ reservationId: workspaceReservations.id })
              .from(workspaceReservations)
              .where(
                or(
                  eq(workspaceReservations.id, identifier),
                  eq(workspaceReservations.checkoutSessionKey, identifier),
                  eq(workspaceReservations.checkoutAttemptKey, identifier),
                  eq(workspaceReservations.correlationId, identifier),
                  eq(workspaceReservations.dotyposReservationId, identifier),
                  eq(workspaceReservations.activePaymentAttemptId, identifier)
                )
              )
              .limit(2),
            paymentRows: db
              .selectDistinct({
                reservationId: paymentAttempts.workspaceReservationId,
              })
              .from(paymentAttempts)
              .where(
                or(
                  eq(paymentAttempts.id, identifier),
                  eq(paymentAttempts.providerOrderId, identifier),
                  eq(paymentAttempts.lastWebhookEventId, identifier),
                  eq(paymentAttempts.lastProviderOperationId, identifier)
                )
              )
              .limit(2),
            applicationRows: db
              .selectDistinct({
                reservationId: discountApplications.workspaceReservationId,
              })
              .from(discountApplications)
              .where(sql`${discountApplications.id} = ${identifier}`)
              .limit(2),
            evidenceRows: db
              .selectDistinct({
                reservationId: legalEvidenceEvents.workspaceReservationId,
              })
              .from(legalEvidenceEvents)
              .where(eq(legalEvidenceEvents.id, identifier))
              .limit(2),
            webhookRows: db
              .selectDistinct({
                reservationId: paymentAttempts.workspaceReservationId,
              })
              .from(webhookEvents)
              .innerJoin(
                paymentAttempts,
                or(
                  eq(webhookEvents.paymentAttemptId, paymentAttempts.id),
                  eq(
                    webhookEvents.providerOrderId,
                    paymentAttempts.providerOrderId
                  )
                )
              )
              .where(
                or(
                  eq(webhookEvents.id, identifier),
                  eq(webhookEvents.eventId, identifier),
                  eq(webhookEvents.providerOrderId, identifier)
                )
              )
              .limit(2),
          },
          { concurrency: 5 }
        );

        return getUniqueReservationId([
          ...reservationRows.map(({ reservationId }) => reservationId),
          ...paymentRows.map(({ reservationId }) => reservationId),
          ...applicationRows.map(({ reservationId }) => reservationId),
          ...evidenceRows.map(({ reservationId }) => reservationId),
          ...webhookRows.map(({ reservationId }) => reservationId),
        ]);
      });

      const loadBookingTables = () =>
        dotypos.getTables().pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Booking table details unavailable", {
              cause,
            }).pipe(Effect.as([] as const))
          )
        );

      const listBookings = Effect.fn("AdministrationService.listBookings")(
        function* (input: { readonly date: string; readonly page?: number }) {
          const bookings = (yield* dotypos.listReservations({
            ...getDateBounds(input.date),
            order: "startDateAscending",
          })).flatMap((booking) =>
            booking.id ? [{ ...booking, id: booking.id }] : []
          );
          const pagination = getAdministrationPagination({
            pageSize: bookingPageSize,
            requestedPage: input.page,
            total: bookings.length,
          });
          const pageBookings = bookings.slice(
            pagination.offset,
            pagination.offset + bookingPageSize
          );
          const bookingIds = pageBookings.map(({ id }) => id);
          const { customers, rows, tables } = yield* Effect.all(
            {
              customers: Effect.all(
                pageBookings.map((booking) =>
                  booking._customerId
                    ? dotypos.getCustomer(booking._customerId).pipe(
                        Effect.map(
                          (customer) => [booking.id, customer] as const
                        ),
                        Effect.catch(() =>
                          Effect.succeed([booking.id, null] as const)
                        )
                      )
                    : Effect.succeed([booking.id, null] as const)
                ),
                { concurrency: 5 }
              ),
              rows:
                bookingIds.length > 0
                  ? db
                      .select(safeReservationSelection)
                      .from(workspaceReservations)
                      .where(
                        inArray(
                          workspaceReservations.dotyposReservationId,
                          bookingIds
                        )
                      )
                  : Effect.succeed([] as readonly SafeReservationRow[]),
              tables: loadBookingTables(),
            },
            { concurrency: 3 }
          );
          const customersByBookingId = new Map(customers);
          const rowsByBookingId = new Map(
            rows.flatMap((row) =>
              row.dotyposReservationId
                ? [[row.dotyposReservationId, row] as const]
                : []
            )
          );
          const tablesById = new Map(
            tables.flatMap((table) =>
              table.id ? [[table.id, table] as const] : []
            )
          );

          return {
            items: pageBookings.map((booking) =>
              toBookingSummary({
                booking,
                customer: customersByBookingId.get(booking.id) ?? null,
                row: rowsByBookingId.get(booking.id) ?? null,
                table: booking._tableId
                  ? (tablesById.get(booking._tableId) ?? null)
                  : null,
              })
            ),
            page: pagination.page,
            pageCount: pagination.pageCount,
            total: bookings.length,
          } satisfies AdministrationBookingPage;
        }
      );

      const loadBooking = Effect.fn("AdministrationService.loadBooking")(
        function* (id: string) {
          const [{ customer, reservation }, tables] = yield* Effect.all(
            [dotypos.getReservation(id), loadBookingTables()],
            { concurrency: 2 }
          );
          const [row] = yield* db
            .select(safeReservationSelection)
            .from(workspaceReservations)
            .where(eq(workspaceReservations.dotyposReservationId, id))
            .limit(1);
          const table = reservation._tableId
            ? (tables.find(
                ({ id: tableId }) => tableId === reservation._tableId
              ) ?? null)
            : null;
          const booking = toBookingSummary({
            booking: { ...reservation, id },
            customer,
            row: row ?? null,
            table,
          });

          return {
            booking,
            references: {
              bookingId: id,
              customerId: booking.customerId,
              workspaceReservationId: booking.linkedReservation?.id ?? null,
            },
          } satisfies AdministrationBookingDetail;
        }
      );

      const listCustomers = Effect.fn("AdministrationService.listCustomers")(
        function* (input: AdministrationCustomerListInput) {
          const countRows = yield* db
            .select({
              value: countDistinct(workspaceReservations.dotyposCustomerId),
            })
            .from(workspaceReservations);
          const total = Number(countRows[0]?.value ?? 0);
          const pagination = getAdministrationPagination({
            pageSize: customerPageSize,
            requestedPage: input.page,
            total,
          });
          const rows = yield* db
            .select({
              customerId: workspaceReservations.dotyposCustomerId,
              reservationCount: count(),
              lastActivityAt: max(workspaceReservations.updatedAt),
            })
            .from(workspaceReservations)
            .groupBy(workspaceReservations.dotyposCustomerId)
            .orderBy(desc(max(workspaceReservations.updatedAt)))
            .limit(customerPageSize)
            .offset(pagination.offset);
          const items = yield* Effect.all(
            rows.map((row) =>
              dotypos.getCustomer(row.customerId).pipe(
                Effect.map((customer) => toCustomer(customer, row.customerId)),
                Effect.catch(() => Effect.succeed(null)),
                Effect.map((customer) => ({
                  customer,
                  customerId: row.customerId,
                  reservationCount: Number(row.reservationCount),
                  lastActivityAt: row.lastActivityAt
                    ? toIsoString(row.lastActivityAt)
                    : Temporal.Instant.fromEpochMilliseconds(0).toString(),
                }))
              )
            ),
            { concurrency: 5 }
          );
          return {
            items,
            page: pagination.page,
            pageCount: pagination.pageCount,
            total,
          };
        }
      );

      const loadCustomerReservations = Effect.fn(
        "AdministrationService.loadCustomerReservations"
      )(function* (input: {
        readonly customerId: string;
        readonly page?: number;
      }) {
        const where = eq(
          workspaceReservations.dotyposCustomerId,
          input.customerId
        );
        const countRows = yield* db
          .select({ value: count() })
          .from(workspaceReservations)
          .where(where);
        const total = Number(countRows[0]?.value ?? 0);
        const pagination = getAdministrationPagination({
          pageSize: customerReservationPageSize,
          requestedPage: input.page,
          total,
        });
        const rows = yield* db
          .select(safeReservationSelection)
          .from(workspaceReservations)
          .where(where)
          .orderBy(desc(workspaceReservations.updatedAt))
          .limit(customerReservationPageSize)
          .offset(pagination.offset);
        return {
          items: yield* enrichRows(rows),
          page: pagination.page,
          pageCount: pagination.pageCount,
          total,
        };
      });

      const loadOverview = Effect.fn("AdministrationService.loadOverview")(
        function* () {
          const { customerCountRows, recent, today } = yield* Effect.all(
            {
              customerCountRows: db
                .select({
                  value: countDistinct(workspaceReservations.dotyposCustomerId),
                })
                .from(workspaceReservations),
              recent: listReservations({ page: 1, pageSize: 6 }),
              today: listReservations({
                date: getCurrentPragueDate(),
                page: 1,
                pageSize: 6,
              }),
            },
            { concurrency: 3 }
          );
          return {
            counts: {
              reservations: recent.total,
              customers: Number(customerCountRows[0]?.value ?? 0),
            },
            recent: recent.items.slice(0, 6),
            today: today.items.slice(0, 6),
            todayUnavailable: today.dateFilterUnavailable,
          };
        }
      );

      return {
        loadOverview,
        listReservations,
        loadReservation,
        findReservationId,
        listBookings,
        loadBooking,
        listCustomers,
        loadCustomerReservations,
      };
    })
  );
}
