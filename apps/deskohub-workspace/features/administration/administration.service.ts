import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposReservationId,
  DotyposReservationIdSchema,
  DotyposService,
  type DotyposTableId,
  DotyposTableIdSchema,
} from "@deskohub/dotypos";
import type {
  Customer as DotyposCustomer,
  Reservation as DotyposReservation,
  Table as DotyposTable,
} from "@deskohub/dotypos/generated";
import {
  NexiCorrelationIdSchema,
  NexiOperationIdSchema,
  type NexiOrderId,
  NexiOrderIdSchema,
  NexiWebhookEventIdSchema,
} from "@deskohub/nexi";
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  inArray,
  isNotNull,
  max,
  notInArray,
  or,
  type SQL,
  sql,
  sum,
} from "drizzle-orm";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  customerMarketingConsents,
  discountApplications,
  legalEvidenceEvents,
  type PaymentAttemptState,
  paymentAttempts,
  type WorkspaceReservation,
  webhookEvents,
  workspaceReservations,
} from "@/db/schema";
import {
  checkoutAttemptKeySchema,
  checkoutSessionKeySchema,
  type PaymentAttemptId,
  paymentAttemptIdSchema,
  storedWebhookEventIdSchema,
} from "@/features/checkout/checkout-identifiers";
import { legalEvidenceEventIdSchema } from "@/features/checkout/legal-evidence";
import {
  type DiscountApplicationId,
  discountApplicationIdSchema,
} from "@/features/discounts/persistence-contracts";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { workspaceSiteConstants } from "@/shared/utils";
import {
  getAdministrationExternalOrderPageIds,
  getAdministrationPagination,
} from "./listing";
import {
  type AdministrationOrder,
  type IPaymentAdministrationService,
  PaymentAdministrationService,
} from "./payment-administration.service";
import {
  getProviderOperationTimelineTone,
  getProviderValueLabel,
} from "./payment-presentation";
import {
  mergeReservationHistory,
  PostHogReservationHistory,
} from "./posthog-reservation-history";
import {
  type AdministrationReservationDateRange,
  getAdministrationOverviewDateRanges,
  getAdministrationReservationDateRange,
} from "./reservation-date-range";
import { getUniqueReservationId } from "./reservation-lookup.server";
import type { AdministrationStatusGroup } from "./reservation-status";
import {
  getAdministrationReservationLifecycle,
  getAdministrationReservationStatus,
} from "./reservation-status";

const reservationPageSize = 24;
const bookingPageSize = 24;
const customerPageSize = 24;
const customerReservationPageSize = 10;
const customerActivityReservationLimit = 24;
const customerActivityTransactionLimit = 50;

const paymentAttemptStateLabels = {
  created: "Started",
  pending: "Pending",
  paid: "Paid",
  failed: "Unsuccessful",
  cancelled: "Unsuccessful",
  expired: "Unsuccessful",
} as const;

export type AdministrationReservationListInput = {
  readonly customerId?: DotyposCustomerId;
  readonly date?: string;
  readonly direction?: AdministrationReservationSortDirection;
  readonly from?: string;
  readonly page?: number;
  readonly sort?: AdministrationReservationSort;
  readonly status?: Exclude<AdministrationStatusGroup, "attention">;
  readonly to?: string;
  readonly type?: "cowork" | "meeting-room" | "office";
};

export type AdministrationReservationSort =
  | "created"
  | "date"
  | "reservation"
  | "status";

export type AdministrationReservationSortDirection = "asc" | "desc";

type ReservationListInput = AdministrationReservationListInput & {
  readonly pageSize?: number;
};

export type AdministrationCustomerListInput = {
  readonly page?: number;
};

export type AdministrationCustomer = {
  readonly id: DotyposCustomerId;
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
};

export type AdministrationReservationSummary = {
  readonly id: WorkspaceReservationId;
  readonly customerId: DotyposCustomerId;
  readonly customer: AdministrationCustomer | null;
  readonly liveDetailsAvailable: boolean;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly date: string | null;
  readonly type: "cowork" | "meeting-room" | "office";
  readonly typeLabel: string;
  readonly status: ReturnType<typeof getAdministrationReservationStatus>;
  readonly statusNote: string | null;
  readonly createdAt: string;
  readonly latestPayment: AdministrationPaymentAttempt | null;
  readonly updatedAt: string;
};

export type AdministrationReservationPage = {
  readonly items: readonly AdministrationReservationSummary[];
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
};

export type AdministrationBookingSummary = {
  readonly id: DotyposReservationId;
  readonly customerId: DotyposCustomerId | null;
  readonly customer: AdministrationCustomer | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly seats: string;
  readonly status: "NEW" | "CONFIRMED" | "CANCELLED";
  readonly statusLabel: string;
  readonly tableId: DotyposTableId | null;
  readonly tableName: string | null;
  readonly tableLocation: string | null;
  readonly linkedReservation: {
    readonly id: WorkspaceReservationId;
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
    readonly bookingId: DotyposReservationId;
    readonly customerId: DotyposCustomerId | null;
    readonly workspaceReservationId: WorkspaceReservationId | null;
  };
};

export type AdministrationPaymentAttempt = {
  readonly id: PaymentAttemptId;
  readonly state: PaymentAttemptState;
  readonly providerOrderId: NexiOrderId | null;
  readonly providerLabel: string;
  readonly stateLabel: string;
  readonly amount: {
    readonly value: number;
    readonly exponent: number;
    readonly currency: string;
  };
  readonly createdAt: string;
  readonly providerOrderCreatedAt: string | null;
  readonly updatedAt: string;
};

export type AdministrationMoney = {
  readonly value: number;
  readonly exponent: number;
  readonly currency: string;
};

export type AdministrationCustomerTransaction = {
  readonly attempt: AdministrationPaymentAttempt;
  readonly reservation: Pick<
    AdministrationReservationSummary,
    "id" | "typeLabel"
  >;
};

export type AdministrationCustomerMarketingConsent = {
  readonly documentHash: string;
  readonly locale: string;
  readonly grantedAt: string;
  readonly withdrawnAt: string | null;
};

export type AdministrationCustomerActivity = {
  readonly reservations: readonly AdministrationReservationSummary[];
  readonly reservationHistoryTruncated: boolean;
  readonly transactions: readonly AdministrationCustomerTransaction[];
  readonly transactionHistoryTruncated: boolean;
  readonly stats: {
    readonly reservationCount: number;
    readonly favoriteProduct: string | null;
    readonly revenue: readonly AdministrationMoney[];
    readonly discountSavings: readonly AdministrationMoney[];
  };
  readonly marketingConsent: AdministrationCustomerMarketingConsent | null;
};

export type AdministrationDiscountApplication = {
  readonly id: DiscountApplicationId;
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
  readonly href?: string;
};

export type AdministrationReservationDetail = {
  readonly reservation: AdministrationReservationSummary;
  readonly booking: AdministrationBookingSummary | null;
  readonly lifecycle: ReturnType<typeof getAdministrationReservationLifecycle>;
  readonly timeline: readonly AdministrationTimelineItem[];
  readonly paymentAttempts: readonly AdministrationPaymentAttempt[];
  readonly orders: readonly AdministrationOrder[];
  readonly discounts: readonly AdministrationDiscountApplication[];
  readonly otherCustomerReservations: readonly AdministrationReservationSummary[];
  readonly sameDateReservations: readonly AdministrationReservationSummary[];
  readonly references: {
    readonly workspaceReservationId: WorkspaceReservationId;
    readonly dotyposReservationId: DotyposReservationId | null;
    readonly customerId: DotyposCustomerId;
  };
};

export type AdministrationCustomerSummary = {
  readonly customer: AdministrationCustomer | null;
  readonly customerId: DotyposCustomerId;
  readonly reservationCount: number;
  readonly lastActivityAt: string;
};

export type AdministrationOverviewMetric = {
  readonly unavailable: boolean;
  readonly value: number;
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
  | "reservationHoldExpiredAt"
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
  reservationHoldExpiredAt: workspaceReservations.reservationHoldExpiredAt,
  paidAt: workspaceReservations.paidAt,
  fulfilledAt: workspaceReservations.fulfilledAt,
  fulfillmentFailedAt: workspaceReservations.fulfillmentFailedAt,
  createdAt: workspaceReservations.createdAt,
  updatedAt: workspaceReservations.updatedAt,
} as const;

const toIsoString = (instant: Temporal.Instant) => instant.toString();

const decodeDotyposCustomerId = Schema.decodeUnknownOption(
  DotyposCustomerIdSchema
);
const decodeDotyposReservationId = Schema.decodeUnknownOption(
  DotyposReservationIdSchema
);
const decodeDotyposTableId = Schema.decodeUnknownOption(DotyposTableIdSchema);
const decodeCheckoutAttemptKey = Schema.decodeUnknownOption(
  checkoutAttemptKeySchema
);
const decodeCheckoutSessionKey = Schema.decodeUnknownOption(
  checkoutSessionKeySchema
);
const decodeNexiCorrelationId = Schema.decodeUnknownOption(
  NexiCorrelationIdSchema
);
const decodeDiscountApplicationId = Schema.decodeUnknownOption(
  discountApplicationIdSchema
);
const decodeLegalEvidenceEventId = Schema.decodeUnknownOption(
  legalEvidenceEventIdSchema
);
const decodeNexiOperationId = Schema.decodeUnknownOption(NexiOperationIdSchema);
const decodeNexiOrderId = Schema.decodeUnknownOption(NexiOrderIdSchema);
const decodeNexiWebhookEventId = Schema.decodeUnknownOption(
  NexiWebhookEventIdSchema
);
const decodePaymentAttemptId = Schema.decodeUnknownOption(
  paymentAttemptIdSchema
);
const decodeStoredWebhookEventId = Schema.decodeUnknownOption(
  storedWebhookEventIdSchema
);
const decodeWorkspaceReservationId = Schema.decodeUnknownOption(
  workspaceReservationIdSchema
);

const toCustomer = (
  customer: DotyposCustomer,
  fallbackId: DotyposCustomerId
): AdministrationCustomer => {
  const personalName = [customer.firstName, customer.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    id:
      Option.getOrUndefined(decodeDotyposCustomerId(customer.id)) ?? fallbackId,
    displayName:
      personalName || customer.companyName?.trim() || "Unnamed customer",
    email: customer.email?.trim() || null,
    phone: customer.phone?.trim() || null,
  };
};

type SafePaymentAttemptRow = {
  readonly id: PaymentAttemptId;
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly providerOrderId: NexiOrderId | null;
  readonly provider: "internal" | "nexi";
  readonly state: PaymentAttemptState;
  readonly amountValue: number;
  readonly amountExponent: number;
  readonly currency: string;
  readonly createdAt: Temporal.Instant;
  readonly providerOrderCreatedAt: Temporal.Instant | null;
  readonly updatedAt: Temporal.Instant;
};

const safePaymentAttemptSelection = {
  id: paymentAttempts.id,
  workspaceReservationId: paymentAttempts.workspaceReservationId,
  providerOrderId: paymentAttempts.providerOrderId,
  provider: paymentAttempts.provider,
  state: paymentAttempts.state,
  amountValue: paymentAttempts.amountValue,
  amountExponent: paymentAttempts.amountExponent,
  currency: paymentAttempts.currency,
  createdAt: paymentAttempts.createdAt,
  providerOrderCreatedAt: paymentAttempts.providerOrderCreatedAt,
  updatedAt: paymentAttempts.updatedAt,
} as const;

const toAdministrationPaymentAttempt = (
  attempt: SafePaymentAttemptRow
): AdministrationPaymentAttempt => ({
  id: attempt.id,
  state: attempt.state,
  providerOrderId: attempt.providerOrderId,
  providerLabel:
    attempt.provider === "internal" ? "Included" : "Online payment",
  stateLabel: paymentAttemptStateLabels[attempt.state],
  amount: {
    value: attempt.amountValue,
    exponent: attempt.amountExponent,
    currency: attempt.currency,
  },
  createdAt: toIsoString(attempt.createdAt),
  providerOrderCreatedAt: attempt.providerOrderCreatedAt?.toString() ?? null,
  updatedAt: toIsoString(attempt.updatedAt),
});

const toMoneyTotals = (
  rows: readonly {
    readonly value: string | null;
    readonly exponent: number;
    readonly currency: string;
  }[]
): readonly AdministrationMoney[] =>
  rows
    .map((row) => ({ ...row, value: Number(row.value ?? 0) }))
    .toSorted((left, right) => left.currency.localeCompare(right.currency));

const getReservationTypeLabel = (
  row: Pick<SafeReservationRow, "reservationDetails">
) => {
  if (row.reservationDetails.kind === "meeting-room") return "Meeting Room";
  if (row.reservationDetails.kind === "office") return "Private Office";
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
  latestPayment = null,
  live,
  row,
}: {
  readonly latestPayment?: AdministrationPaymentAttempt | null;
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
      dotyposStatus: live.reservation?.status,
      fulfillmentState: row.fulfillmentState,
      paymentState: row.paymentState,
      reservationState: row.reservationState,
    }),
    statusNote:
      live.reservation?.status === "CANCELLED" &&
      row.reservationState !== "cancelled"
        ? "Cancelled in Dotypos"
        : null,
    createdAt: toIsoString(row.createdAt),
    latestPayment,
    updatedAt: toIsoString(row.updatedAt),
  };
};

const bookingStatusLabels = {
  NEW: "New",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
} as const;

type IdentifiedDotyposReservation = DotyposReservation & {
  readonly id: DotyposReservationId;
};

const toBookingSummary = ({
  booking,
  customer,
  row,
  table,
}: {
  readonly booking: IdentifiedDotyposReservation;
  readonly customer: DotyposCustomer | null;
  readonly row: SafeReservationRow | null;
  readonly table: DotyposTable | null;
}): AdministrationBookingSummary => {
  const customerId = Option.getOrUndefined(
    decodeDotyposCustomerId(booking._customerId)
  );
  const tableId = Option.getOrUndefined(decodeDotyposTableId(booking._tableId));

  return {
    id: booking.id,
    customerId: customerId ?? null,
    customer: customerId && customer ? toCustomer(customer, customerId) : null,
    startsAt: booking.startDate,
    endsAt: booking.endDate,
    seats: booking.seats,
    status: booking.status,
    statusLabel: bookingStatusLabels[booking.status],
    tableId: tableId ?? null,
    tableName: table?.name ?? null,
    tableLocation: table?.locationName ?? null,
    linkedReservation: row
      ? { id: row.id, label: getReservationTypeLabel(row) }
      : null,
    createdAt: booking.created ?? null,
    updatedAt: booking.versionDate ?? null,
  };
};

const getDateRangeBounds = (startDate: string, endDate: string) => {
  const start = Temporal.PlainDate.from(startDate).toZonedDateTime({
    plainTime: Temporal.PlainTime.from("00:00"),
    timeZone: workspaceSiteConstants.location.timeZone,
  });
  const end = Temporal.PlainDate.from(endDate).toZonedDateTime({
    plainTime: Temporal.PlainTime.from("00:00"),
    timeZone: workspaceSiteConstants.location.timeZone,
  });
  return {
    startsAtOrAfter: start.toInstant().toString(),
    startsBefore: end.toInstant().toString(),
  };
};

const getInclusiveDateRangeBounds = (
  range: AdministrationReservationDateRange
) => ({
  ...(range.from && {
    startsAtOrAfter: Temporal.PlainDate.from(range.from)
      .toZonedDateTime({
        plainTime: Temporal.PlainTime.from("00:00"),
        timeZone: workspaceSiteConstants.location.timeZone,
      })
      .toInstant()
      .toString(),
  }),
  ...(range.to && {
    startsBefore: Temporal.PlainDate.from(range.to)
      .add({ days: 1 })
      .toZonedDateTime({
        plainTime: Temporal.PlainTime.from("00:00"),
        timeZone: workspaceSiteConstants.location.timeZone,
      })
      .toInstant()
      .toString(),
  }),
});

const getDateBounds = (date: string) => {
  const plainDate = Temporal.PlainDate.from(date);
  return getDateRangeBounds(date, plainDate.add({ days: 1 }).toString());
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
        eq(workspaceReservations.reservationState, "hold_expired")
      )
    )!;
  }
  return and(
    sql`${workspaceReservations.fulfillmentState} <> 'failed'`,
    sql`${workspaceReservations.fulfillmentState} <> 'fulfilled'`,
    sql`${workspaceReservations.reservationState} not in ('cancelled', 'hold_expired', 'cancellation_failed')`
  )!;
};

const reservationStatusSort = sql<string>`case
  when ${workspaceReservations.fulfillmentState} = 'failed' then 'Confirmation issue'
  when ${workspaceReservations.reservationState} = 'cancellation_failed' then 'Cancellation issue'
  when ${workspaceReservations.reservationState} = 'cancelled' then 'Cancelled'
  when ${workspaceReservations.fulfillmentState} = 'fulfilled' then 'Complete'
  when ${workspaceReservations.reservationState} = 'cancelling' then 'Cancelling'
  when ${workspaceReservations.reservationState} = 'hold_expired' then 'Expired'
  when ${workspaceReservations.paymentState} = 'paid'
    or ${workspaceReservations.fulfillmentState} = 'processing'
    or ${workspaceReservations.reservationState} in ('confirming', 'confirmed')
    then 'Confirming'
  when ${workspaceReservations.paymentState} = 'pending' then 'Payment pending'
  when ${workspaceReservations.paymentState} = 'failed'
    and ${workspaceReservations.reservationState} = 'held' then 'Payment failed'
  when ${workspaceReservations.paymentState} = 'expired'
    and ${workspaceReservations.reservationState} = 'held' then 'Payment expired'
  when ${workspaceReservations.reservationState} = 'held'
    and ${workspaceReservations.paymentState} in ('not_started', 'cancelled')
    then 'Awaiting payment'
  when ${workspaceReservations.reservationState} in ('draft', 'creating_hold')
    then 'Starting'
  else 'In progress'
end`;

const reservationTypeSort = sql<string>`case
  when ${workspaceReservations.reservationDetails}->>'kind' = 'meeting-room'
    then 'Meeting Room'
  else 'Cowork ' || initcap(${workspaceReservations.reservationDetails}->>'entryTier')
end`;

const getReservationOrderBy = (input: {
  readonly direction?: AdministrationReservationSortDirection;
  readonly sort?: Exclude<AdministrationReservationSort, "date">;
}) => {
  const order = input.direction === "asc" ? asc : desc;
  const fields = {
    created: workspaceReservations.createdAt,
    reservation: reservationTypeSort,
    status: reservationStatusSort,
  } as const;
  const field = fields[input.sort ?? "created"];
  return [order(field), order(workspaceReservations.id)] as const;
};

const buildTimeline = (row: SafeReservationRow) => {
  const items: AdministrationTimelineItem[] = [
    {
      id: "workflow-created",
      title: "Checkout workflow created",
      description: "Deskohub created the local reservation workflow.",
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
    "Payment recorded by Deskohub",
    "Deskohub verified the provider payment and marked the reservation paid.",
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
    "hold-expired",
    "Reservation hold expired",
    "The held reservation reached its expiry time.",
    row.reservationHoldExpiredAt,
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

const buildPaymentAttemptTimeline = (
  attempts: readonly AdministrationPaymentAttempt[]
): readonly AdministrationTimelineItem[] =>
  attempts.flatMap((attempt) => {
    const started: AdministrationTimelineItem = {
      id: `payment-attempt-${attempt.id}-started`,
      title: "Payment started",
      description: `${attempt.providerLabel} attempt ${attempt.id}.`,
      occurredAt: attempt.createdAt,
      tone: "neutral",
    };
    if (
      attempt.state === "created" ||
      attempt.state === "pending" ||
      attempt.state === "paid"
    ) {
      return [started];
    }
    return [
      started,
      {
        id: `payment-attempt-${attempt.id}-${attempt.state}`,
        title: {
          cancelled: "Payment unsuccessful",
          expired: "Payment unsuccessful",
          failed: "Payment failed",
        }[attempt.state],
        description: "The attempt ended without a recorded payment.",
        occurredAt: attempt.updatedAt,
        tone: "warning" as const,
      },
    ];
  });

const getOperationTimelineTitle = (
  operationType: string | undefined,
  operationResult: string | undefined
) => {
  if (operationType === "AUTHORIZATION" && operationResult === "AUTHORIZED") {
    return "Payment authorized by Nexi";
  }
  if (
    (operationType === "AUTHORIZATION" || operationType === "CAPTURE") &&
    operationResult === "EXECUTED"
  ) {
    return "Payment executed by Nexi";
  }
  if (operationType === "REFUND") return "Refund reported by Nexi";
  if (operationType === "CANCEL" || operationType === "VOID") {
    return "Payment reversal reported by Nexi";
  }
  const typeLabel = operationType
    ? getProviderValueLabel(operationType)
    : "Payment operation";
  return operationResult
    ? `${typeLabel}: ${getProviderValueLabel(operationResult)}`
    : typeLabel;
};

const getOrderTimeline = (
  orders: readonly AdministrationOrder[]
): readonly AdministrationTimelineItem[] => {
  const items: AdministrationTimelineItem[] = [];
  for (const order of orders) {
    if (order.link?.providerOrderCreatedAt) {
      items.push({
        id: `order-${order.orderId}-created`,
        title: order.link.providerOrderCreatedAtEstimated
          ? "Nexi order created (estimated)"
          : "Nexi order created",
        description: order.link.providerOrderCreatedAtEstimated
          ? "This attached Nexi session predates exact order-creation tracking; the local payment-attempt time is shown."
          : "Nexi accepted the hosted-payment request.",
        occurredAt: order.link.providerOrderCreatedAt,
        tone: "neutral",
        href: `#order-${order.orderId}`,
      });
    }
    for (const [index, operation] of (
      order.provider?.operations ?? []
    ).entries()) {
      if (!operation.operationTime) continue;
      let occurredAt: string;
      try {
        occurredAt = Temporal.Instant.from(operation.operationTime).toString();
      } catch {
        continue;
      }
      const result = operation.operationResult?.toUpperCase();
      const operationId = operation.operationId;
      items.push({
        id: operationId
          ? `nexi-operation-${operationId}`
          : `nexi-operation-${order.orderId}-${index}`,
        title: getOperationTimelineTitle(
          operation.operationType?.toUpperCase(),
          result
        ),
        description: operation.channel
          ? `Nexi reported this ${getProviderValueLabel(operation.channel)} operation.`
          : "Nexi reported this payment operation.",
        occurredAt,
        tone: getProviderOperationTimelineTone(
          operation.operationType,
          operation.operationResult
        ),
        ...(operationId && {
          href: `#operation-${operationId}`,
        }),
      });
    }
  }
  return items;
};

export class AdministrationService extends Context.Service<
  AdministrationService,
  {
    readonly loadOverview: () => Effect.Effect<
      {
        readonly ranges: ReturnType<typeof getAdministrationOverviewDateRanges>;
        readonly today: AdministrationOverviewMetric;
        readonly upcoming: AdministrationOverviewMetric;
        readonly lastSevenDays: AdministrationOverviewMetric;
      },
      unknown
    >;
    readonly listReservations: (
      input: AdministrationReservationListInput
    ) => Effect.Effect<
      AdministrationReservationPage & {
        readonly dateFilterUnavailable: boolean;
        readonly dateSortUnavailable: boolean;
      },
      unknown
    >;
    readonly loadReservation: (
      id: WorkspaceReservationId
    ) => Effect.Effect<AdministrationReservationDetail | null, unknown>;
    readonly findReservationId: (
      identifier: string
    ) => Effect.Effect<WorkspaceReservationId | null, unknown>;
    readonly listBookings: (input: {
      readonly date: string;
      readonly page?: number;
    }) => Effect.Effect<AdministrationBookingPage, unknown>;
    readonly loadBooking: (
      id: DotyposReservationId
    ) => Effect.Effect<AdministrationBookingDetail | null, unknown>;
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
      readonly customerId: DotyposCustomerId;
      readonly page?: number;
    }) => Effect.Effect<AdministrationReservationPage, unknown>;
    readonly loadCustomerActivity: (
      customerId: DotyposCustomerId
    ) => Effect.Effect<AdministrationCustomerActivity, unknown>;
    readonly listOrders: IPaymentAdministrationService["listOrders"];
    readonly loadOrder: IPaymentAdministrationService["loadOrder"];
    readonly listOperations: IPaymentAdministrationService["listOperations"];
    readonly loadOperation: IPaymentAdministrationService["loadOperation"];
  }
>()("@deskohub-workspace/administration/AdministrationService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const dotypos = yield* DotyposService;
      const reservationHistory = yield* PostHogReservationHistory;
      const paymentAdministration = yield* PaymentAdministrationService;

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

      const enrichRows = Effect.fn("AdministrationService.enrichRows")(
        function* (rows: readonly SafeReservationRow[]) {
          if (rows.length === 0) return [];
          const attemptRows = yield* db
            .select(safePaymentAttemptSelection)
            .from(paymentAttempts)
            .where(
              inArray(
                paymentAttempts.workspaceReservationId,
                rows.map(({ id }) => id)
              )
            )
            .orderBy(desc(paymentAttempts.createdAt));
          const latestPaymentByReservation = new Map<
            string,
            AdministrationPaymentAttempt
          >();
          for (const attempt of attemptRows) {
            if (
              !latestPaymentByReservation.has(attempt.workspaceReservationId)
            ) {
              latestPaymentByReservation.set(
                attempt.workspaceReservationId,
                toAdministrationPaymentAttempt(attempt)
              );
            }
          }
          return yield* Effect.all(
            rows.map((row) =>
              loadLiveReservation(row).pipe(
                Effect.map((live) =>
                  toReservationSummary({
                    latestPayment:
                      latestPaymentByReservation.get(row.id) ?? null,
                    live,
                    row,
                  })
                )
              )
            ),
            { concurrency: 5 }
          );
        }
      );

      const loadBookingTables = () =>
        dotypos.getTables().pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Booking table details unavailable", {
              cause,
            }).pipe(Effect.as([] as const))
          )
        );

      const loadReservationRangeMap = (
        range: AdministrationReservationDateRange | undefined
      ) => {
        if (!range) return Effect.succeed(undefined);
        return dotypos
          .listReservations({
            ...getInclusiveDateRangeBounds(range),
            order: "startDateAscending",
          })
          .pipe(
            Effect.map(
              (reservations) =>
                new Map(
                  reservations.flatMap((reservation) => {
                    const reservationId = Option.getOrUndefined(
                      decodeDotyposReservationId(reservation.id)
                    );
                    return reservationId
                      ? [[reservationId, reservation] as const]
                      : [];
                  })
                )
            ),
            Effect.catch((cause) =>
              Effect.logWarning("Reservation date filter unavailable", {
                cause,
                ...range,
              }).pipe(Effect.as(null))
            )
          );
      };

      const loadReservationDateOrder = Effect.fn(
        "AdministrationService.loadReservationDateOrder"
      )(function* (
        input: AdministrationReservationListInput,
        hasDateRange: boolean,
        dateReservations:
          | ReadonlyMap<DotyposReservationId, DotyposReservation>
          | null
          | undefined
      ) {
        if (hasDateRange) {
          if (!dateReservations) return null;
          const providerIds = [...dateReservations.keys()];
          return input.direction === "asc"
            ? providerIds
            : providerIds.toReversed();
        }
        return yield* dotypos
          .listReservations({
            ...(input.customerId && { customerId: input.customerId }),
            order:
              input.direction === "asc"
                ? "startDateAscending"
                : "startDateDescending",
          })
          .pipe(
            Effect.map((reservations) =>
              reservations.flatMap(({ id }) => {
                const reservationId = Option.getOrUndefined(
                  decodeDotyposReservationId(id)
                );
                return reservationId ? [reservationId] : [];
              })
            ),
            Effect.catch((cause) =>
              Effect.logWarning("Reservation date sorting unavailable", {
                cause,
              }).pipe(Effect.as(null))
            )
          );
      });

      const loadReservationPeriodCount = Effect.fn(
        "AdministrationService.loadReservationPeriodCount"
      )(function* (input: {
        readonly range: ReturnType<
          typeof getAdministrationOverviewDateRanges
        >["today"];
        readonly linkedReservationIds: ReadonlySet<DotyposReservationId>;
      }) {
        const reservations = yield* dotypos
          .listReservations({
            ...getInclusiveDateRangeBounds(input.range),
            order: "startDateAscending",
          })
          .pipe(
            Effect.map((items) => ({ kind: "available" as const, items })),
            Effect.catch((cause) =>
              Effect.logWarning("Reservation overview period unavailable", {
                cause,
                ...input.range,
              }).pipe(Effect.as({ kind: "unavailable" as const }))
            )
          );
        if (reservations.kind === "unavailable") {
          return { unavailable: true, value: 0 };
        }
        return {
          unavailable: false,
          value: new Set(
            reservations.items.flatMap(({ id }) => {
              const reservationId = Option.getOrUndefined(
                decodeDotyposReservationId(id)
              );
              return reservationId &&
                input.linkedReservationIds.has(reservationId)
                ? [reservationId]
                : [];
            })
          ).size,
        };
      });

      const listReservations = Effect.fn(
        "AdministrationService.listReservations"
      )(function* (input: ReservationListInput) {
        const pageSize = input.pageSize ?? reservationPageSize;
        const dateRange = getAdministrationReservationDateRange(input);
        const dateReservations = yield* loadReservationRangeMap(dateRange);
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
        if (dateRange) {
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
        const orderedProviderIds =
          input.sort === "date"
            ? yield* loadReservationDateOrder(
                input,
                Boolean(dateRange),
                dateReservations
              )
            : undefined;
        let rows: readonly SafeReservationRow[];
        if (orderedProviderIds) {
          const references = yield* db
            .select({
              id: workspaceReservations.id,
              externalId: workspaceReservations.dotyposReservationId,
            })
            .from(workspaceReservations)
            .where(where);
          const pageIds = getAdministrationExternalOrderPageIds({
            offset: pagination.offset,
            orderedExternalIds: orderedProviderIds,
            pageSize,
            references,
          });
          const pageRows =
            pageIds.length === 0
              ? []
              : yield* db
                  .select(safeReservationSelection)
                  .from(workspaceReservations)
                  .where(inArray(workspaceReservations.id, pageIds));
          const rowById = new Map(pageRows.map((row) => [row.id, row]));
          rows = pageIds.flatMap((id) => {
            const row = rowById.get(id);
            return row ? [row] : [];
          });
        } else {
          rows = yield* db
            .select(safeReservationSelection)
            .from(workspaceReservations)
            .where(where)
            .orderBy(
              ...getReservationOrderBy({
                direction: input.direction,
                sort: input.sort === "date" ? "created" : input.sort,
              })
            )
            .limit(pageSize)
            .offset(pagination.offset);
        }
        return {
          items: yield* enrichRows(rows),
          page: pagination.page,
          pageCount: pagination.pageCount,
          total,
          dateFilterUnavailable: Boolean(
            dateRange && dateReservations === null
          ),
          dateSortUnavailable:
            input.sort === "date" && orderedProviderIds === null,
        };
      });

      const loadReservation = Effect.fn(
        "AdministrationService.loadReservation"
      )(function* (id: WorkspaceReservationId) {
        const [row] = yield* db
          .select(safeReservationSelection)
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, id))
          .limit(1);
        if (!row) return null;

        const {
          applicationRows,
          attemptRows,
          history,
          live,
          orders,
          otherRows,
          tables,
        } = yield* Effect.all(
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
              .select(safePaymentAttemptSelection)
              .from(paymentAttempts)
              .where(eq(paymentAttempts.workspaceReservationId, row.id))
              .orderBy(paymentAttempts.createdAt),
            history: reservationHistory.load(row.id),
            live: loadLiveReservation(row),
            orders: paymentAdministration.loadReservationOrders(row.id),
            tables: loadBookingTables(),
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
          { concurrency: 7 }
        );

        let sameDateRows: readonly SafeReservationRow[] = [];
        if (live.reservation) {
          const date = getReservationDate(live.reservation.startDate);
          const dateReservations = yield* loadReservationRangeMap({
            from: date,
            to: date,
          });
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

        const attempts = attemptRows.map(toAdministrationPaymentAttempt);
        const liveTableId = Option.getOrUndefined(
          decodeDotyposTableId(live.reservation?._tableId)
        );
        const table = liveTableId
          ? (tables.find(
              ({ id }) =>
                Option.getOrUndefined(decodeDotyposTableId(id)) === liveTableId
            ) ?? null)
          : null;

        return {
          reservation: toReservationSummary({
            latestPayment: attempts.at(-1) ?? null,
            live,
            row,
          }),
          booking:
            live.reservation && row.dotyposReservationId
              ? toBookingSummary({
                  booking: {
                    ...live.reservation,
                    id: row.dotyposReservationId,
                  },
                  customer: live.customer,
                  row,
                  table,
                })
              : null,
          lifecycle: getAdministrationReservationLifecycle({
            dotyposStatus: live.reservation?.status,
            fulfillmentState: row.fulfillmentState,
            paymentState: row.paymentState,
            reservationState: row.reservationState,
          }),
          timeline: mergeReservationHistory({
            durable: [
              ...buildTimeline(row),
              ...buildPaymentAttemptTimeline(attempts),
              ...getOrderTimeline(orders),
            ],
            history,
          }),
          paymentAttempts: attempts,
          orders,
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
        const lookupIds = {
          checkoutAttemptKey: Option.getOrUndefined(
            decodeCheckoutAttemptKey(identifier)
          ),
          checkoutSessionKey: Option.getOrUndefined(
            decodeCheckoutSessionKey(identifier)
          ),
          correlationId: Option.getOrUndefined(
            decodeNexiCorrelationId(identifier)
          ),
          discountApplicationId: Option.getOrUndefined(
            decodeDiscountApplicationId(identifier)
          ),
          dotyposReservationId: Option.getOrUndefined(
            decodeDotyposReservationId(identifier)
          ),
          legalEvidenceEventId: Option.getOrUndefined(
            decodeLegalEvidenceEventId(identifier)
          ),
          nexiOperationId: Option.getOrUndefined(
            decodeNexiOperationId(identifier)
          ),
          nexiOrderId: Option.getOrUndefined(decodeNexiOrderId(identifier)),
          nexiWebhookEventId: Option.getOrUndefined(
            decodeNexiWebhookEventId(identifier)
          ),
          paymentAttemptId: Option.getOrUndefined(
            decodePaymentAttemptId(identifier)
          ),
          storedWebhookEventId: Option.getOrUndefined(
            decodeStoredWebhookEventId(identifier)
          ),
          workspaceReservationId: Option.getOrUndefined(
            decodeWorkspaceReservationId(identifier)
          ),
        };
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
                  lookupIds.workspaceReservationId
                    ? eq(
                        workspaceReservations.id,
                        lookupIds.workspaceReservationId
                      )
                    : undefined,
                  lookupIds.checkoutSessionKey
                    ? eq(
                        workspaceReservations.checkoutSessionKey,
                        lookupIds.checkoutSessionKey
                      )
                    : undefined,
                  lookupIds.checkoutAttemptKey
                    ? eq(
                        workspaceReservations.checkoutAttemptKey,
                        lookupIds.checkoutAttemptKey
                      )
                    : undefined,
                  lookupIds.correlationId
                    ? eq(
                        workspaceReservations.correlationId,
                        lookupIds.correlationId
                      )
                    : undefined,
                  lookupIds.dotyposReservationId
                    ? eq(
                        workspaceReservations.dotyposReservationId,
                        lookupIds.dotyposReservationId
                      )
                    : undefined,
                  lookupIds.paymentAttemptId
                    ? eq(
                        workspaceReservations.activePaymentAttemptId,
                        lookupIds.paymentAttemptId
                      )
                    : undefined
                ) ?? sql`false`
              )
              .limit(2),
            paymentRows: db
              .selectDistinct({
                reservationId: paymentAttempts.workspaceReservationId,
              })
              .from(paymentAttempts)
              .where(
                or(
                  lookupIds.paymentAttemptId
                    ? eq(paymentAttempts.id, lookupIds.paymentAttemptId)
                    : undefined,
                  lookupIds.nexiOrderId
                    ? eq(paymentAttempts.providerOrderId, lookupIds.nexiOrderId)
                    : undefined,
                  lookupIds.nexiWebhookEventId
                    ? eq(
                        paymentAttempts.lastWebhookEventId,
                        lookupIds.nexiWebhookEventId
                      )
                    : undefined,
                  lookupIds.nexiOperationId
                    ? eq(
                        paymentAttempts.lastProviderOperationId,
                        lookupIds.nexiOperationId
                      )
                    : undefined
                ) ?? sql`false`
              )
              .limit(2),
            applicationRows: db
              .selectDistinct({
                reservationId: discountApplications.workspaceReservationId,
              })
              .from(discountApplications)
              .where(
                lookupIds.discountApplicationId
                  ? eq(discountApplications.id, lookupIds.discountApplicationId)
                  : sql`false`
              )
              .limit(2),
            evidenceRows: db
              .selectDistinct({
                reservationId: legalEvidenceEvents.workspaceReservationId,
              })
              .from(legalEvidenceEvents)
              .where(
                lookupIds.legalEvidenceEventId
                  ? eq(legalEvidenceEvents.id, lookupIds.legalEvidenceEventId)
                  : sql`false`
              )
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
                  lookupIds.storedWebhookEventId
                    ? eq(webhookEvents.id, lookupIds.storedWebhookEventId)
                    : undefined,
                  lookupIds.nexiWebhookEventId
                    ? eq(webhookEvents.eventId, lookupIds.nexiWebhookEventId)
                    : undefined,
                  lookupIds.nexiOrderId
                    ? eq(webhookEvents.providerOrderId, lookupIds.nexiOrderId)
                    : undefined
                ) ?? sql`false`
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

      const listBookings = Effect.fn("AdministrationService.listBookings")(
        function* (input: { readonly date: string; readonly page?: number }) {
          const bookings = (yield* dotypos.listReservations({
            ...getDateBounds(input.date),
            order: "startDateAscending",
          })).flatMap((booking) => {
            const id = Option.getOrUndefined(
              decodeDotyposReservationId(booking.id)
            );
            return id ? [{ ...booking, id }] : [];
          });
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
                pageBookings.map((booking) => {
                  const customerId = Option.getOrUndefined(
                    decodeDotyposCustomerId(booking._customerId)
                  );
                  return customerId
                    ? dotypos.getCustomer(customerId).pipe(
                        Effect.map(
                          (customer) => [booking.id, customer] as const
                        ),
                        Effect.catch(() =>
                          Effect.succeed([booking.id, null] as const)
                        )
                      )
                    : Effect.succeed([booking.id, null] as const);
                }),
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
            tables.flatMap((table) => {
              const tableId = Option.getOrUndefined(
                decodeDotyposTableId(table.id)
              );
              return tableId ? [[tableId, table] as const] : [];
            })
          );

          return {
            items: pageBookings.map((booking) =>
              toBookingSummary({
                booking,
                customer: customersByBookingId.get(booking.id) ?? null,
                row: rowsByBookingId.get(booking.id) ?? null,
                table: Option.match(decodeDotyposTableId(booking._tableId), {
                  onNone: () => null,
                  onSome: (tableId) => tablesById.get(tableId) ?? null,
                }),
              })
            ),
            page: pagination.page,
            pageCount: pagination.pageCount,
            total: bookings.length,
          } satisfies AdministrationBookingPage;
        }
      );

      const loadBooking = Effect.fn("AdministrationService.loadBooking")(
        function* (id: DotyposReservationId) {
          const [details, tables] = yield* Effect.all(
            [
              dotypos
                .getReservation(id)
                .pipe(
                  Effect.catchTag("ExternalAPIError", (error) =>
                    error.statusCode === 404
                      ? Effect.succeed(null)
                      : Effect.fail(error)
                  )
                ),
              loadBookingTables(),
            ],
            { concurrency: 2 }
          );
          if (!details) return null;
          const { customer, reservation } = details;
          const [row] = yield* db
            .select(safeReservationSelection)
            .from(workspaceReservations)
            .where(eq(workspaceReservations.dotyposReservationId, id))
            .limit(1);
          const reservationTableId = Option.getOrUndefined(
            decodeDotyposTableId(reservation._tableId)
          );
          const table = reservationTableId
            ? (tables.find(
                ({ id: tableId }) =>
                  Option.getOrUndefined(decodeDotyposTableId(tableId)) ===
                  reservationTableId
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
        readonly customerId: DotyposCustomerId;
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

      const loadCustomerActivity = Effect.fn(
        "AdministrationService.loadCustomerActivity"
      )(function* (customerId: DotyposCustomerId) {
        const { attemptRowsWithSentinel, marketingConsentRows, recentRows } =
          yield* Effect.all(
            {
              recentRows: db
                .select(safeReservationSelection)
                .from(workspaceReservations)
                .where(eq(workspaceReservations.dotyposCustomerId, customerId))
                .orderBy(desc(workspaceReservations.updatedAt))
                .limit(customerActivityReservationLimit + 1),
              attemptRowsWithSentinel: db
                .select({
                  attempt: safePaymentAttemptSelection,
                  reservation: {
                    id: workspaceReservations.id,
                    reservationDetails:
                      workspaceReservations.reservationDetails,
                  },
                })
                .from(paymentAttempts)
                .innerJoin(
                  workspaceReservations,
                  eq(
                    paymentAttempts.workspaceReservationId,
                    workspaceReservations.id
                  )
                )
                .where(eq(workspaceReservations.dotyposCustomerId, customerId))
                .orderBy(desc(paymentAttempts.createdAt))
                .limit(customerActivityTransactionLimit + 1),
              marketingConsentRows: db
                .select({
                  documentHash: customerMarketingConsents.documentHash,
                  grantedAt: customerMarketingConsents.grantedAt,
                  locale: customerMarketingConsents.locale,
                  withdrawnAt: customerMarketingConsents.withdrawnAt,
                })
                .from(customerMarketingConsents)
                .where(
                  eq(customerMarketingConsents.dotyposCustomerId, customerId)
                )
                .limit(1),
            },
            { concurrency: 3 }
          );
        const marketingConsentRow = marketingConsentRows[0];
        const marketingConsent = marketingConsentRow
          ? {
              ...marketingConsentRow,
              grantedAt: toIsoString(marketingConsentRow.grantedAt),
              withdrawnAt: marketingConsentRow.withdrawnAt
                ? toIsoString(marketingConsentRow.withdrawnAt)
                : null,
            }
          : null;

        if (recentRows.length === 0) {
          return {
            reservations: [],
            reservationHistoryTruncated: false,
            transactions: [],
            transactionHistoryTruncated: false,
            stats: {
              reservationCount: 0,
              favoriteProduct: null,
              revenue: [],
              discountSavings: [],
            },
            marketingConsent,
          } satisfies AdministrationCustomerActivity;
        }

        const rows = recentRows.slice(0, customerActivityReservationLimit);
        const productKind = sql<string>`
          ${workspaceReservations.reservationDetails}->>'kind'
        `;
        const productTier = sql<string | null>`
          ${workspaceReservations.reservationDetails}->>'entryTier'
        `;
        const productCount = count();
        const {
          applicationRows,
          productRows,
          reservationCountRows,
          reservations,
          revenueRows,
        } = yield* Effect.all(
          {
            reservations: enrichRows(rows),
            reservationCountRows: db
              .select({ value: count() })
              .from(workspaceReservations)
              .where(eq(workspaceReservations.dotyposCustomerId, customerId)),
            revenueRows: db
              .select({
                value: sum(paymentAttempts.amountValue),
                exponent: paymentAttempts.amountExponent,
                currency: paymentAttempts.currency,
              })
              .from(paymentAttempts)
              .innerJoin(
                workspaceReservations,
                eq(
                  paymentAttempts.workspaceReservationId,
                  workspaceReservations.id
                )
              )
              .where(
                and(
                  eq(workspaceReservations.dotyposCustomerId, customerId),
                  eq(paymentAttempts.state, "paid")
                )
              )
              .groupBy(
                paymentAttempts.amountExponent,
                paymentAttempts.currency
              ),
            applicationRows: db
              .select({
                value: sum(discountApplications.appliedAmountValue),
                exponent: discountApplications.appliedAmountExponent,
                currency: discountApplications.appliedAmountCurrency,
              })
              .from(discountApplications)
              .innerJoin(
                paymentAttempts,
                eq(discountApplications.paymentAttemptId, paymentAttempts.id)
              )
              .innerJoin(
                workspaceReservations,
                eq(
                  discountApplications.workspaceReservationId,
                  workspaceReservations.id
                )
              )
              .where(
                and(
                  eq(workspaceReservations.dotyposCustomerId, customerId),
                  eq(paymentAttempts.state, "paid")
                )
              )
              .groupBy(
                discountApplications.appliedAmountExponent,
                discountApplications.appliedAmountCurrency
              ),
            productRows: db
              .select({
                count: productCount,
                kind: productKind,
                tier: productTier,
              })
              .from(workspaceReservations)
              .where(
                and(
                  eq(workspaceReservations.dotyposCustomerId, customerId),
                  notInArray(workspaceReservations.reservationState, [
                    "cancelled",
                    "hold_expired",
                  ])
                )
              )
              .groupBy(productKind, productTier)
              .orderBy(desc(productCount), productKind, productTier)
              .limit(1),
          },
          { concurrency: 7 }
        );
        const attemptRows = attemptRowsWithSentinel.slice(
          0,
          customerActivityTransactionLimit
        );
        const favoriteProduct = productRows[0];
        let favoriteProductLabel: string | null = null;
        if (favoriteProduct?.kind === "meeting-room") {
          favoriteProductLabel = "Meeting Room";
        } else if (favoriteProduct?.tier) {
          favoriteProductLabel = `Cowork ${favoriteProduct.tier[0]?.toUpperCase()}${favoriteProduct.tier.slice(1)}`;
        }

        return {
          reservations,
          reservationHistoryTruncated:
            recentRows.length > customerActivityReservationLimit,
          transactions: attemptRows.map(({ attempt, reservation }) => ({
            attempt: toAdministrationPaymentAttempt(attempt),
            reservation: {
              id: reservation.id,
              typeLabel: getReservationTypeLabel(reservation),
            },
          })),
          transactionHistoryTruncated:
            attemptRowsWithSentinel.length > customerActivityTransactionLimit,
          stats: {
            reservationCount: Number(reservationCountRows[0]?.value ?? 0),
            favoriteProduct: favoriteProductLabel,
            revenue: toMoneyTotals(revenueRows),
            discountSavings: toMoneyTotals(applicationRows),
          },
          marketingConsent,
        } satisfies AdministrationCustomerActivity;
      });

      const loadOverview = Effect.fn("AdministrationService.loadOverview")(
        function* () {
          const currentDate = getCurrentWorkspaceDate();
          const ranges = getAdministrationOverviewDateRanges(currentDate);
          const linkedRows = yield* db
            .select({ id: workspaceReservations.dotyposReservationId })
            .from(workspaceReservations)
            .where(isNotNull(workspaceReservations.dotyposReservationId));
          const linkedReservationIds = new Set(
            linkedRows.flatMap(({ id }) => (id ? [id] : []))
          );
          const { lastSevenDays, today, upcoming } = yield* Effect.all(
            {
              today: loadReservationPeriodCount({
                range: ranges.today,
                linkedReservationIds,
              }),
              upcoming: loadReservationPeriodCount({
                range: ranges.upcoming,
                linkedReservationIds,
              }),
              lastSevenDays: loadReservationPeriodCount({
                range: ranges.lastSevenDays,
                linkedReservationIds,
              }),
            },
            { concurrency: 3 }
          );
          return { ranges, today, upcoming, lastSevenDays };
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
        loadCustomerActivity,
        listOrders: paymentAdministration.listOrders,
        loadOrder: paymentAdministration.loadOrder,
        listOperations: paymentAdministration.listOperations,
        loadOperation: paymentAdministration.loadOperation,
      };
    })
  );
}
