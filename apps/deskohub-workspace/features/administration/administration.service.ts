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
  max,
  notInArray,
  or,
  type SQL,
  sql,
  sum,
} from "drizzle-orm";
import {
  Context,
  Effect,
  Array as EffectArray,
  Layer,
  Option,
  Schema,
} from "effect";
import { unstable_rethrow } from "next/navigation";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  customerMarketingConsents,
  discountApplications,
  type LatePaymentRecoveryState,
  latePaymentRecoveries,
  legalEvidenceEvents,
  type PaymentAttemptState,
  type PaymentRefundState,
  paymentAttempts,
  reservationAccessGrants,
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
import type { WorkspaceCoworkProductTier } from "@/features/checkout/product-catalog";
import {
  type DiscountApplicationId,
  discountApplicationIdSchema,
} from "@/features/discounts/persistence-contracts";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import type { WorkspaceReservationKind } from "@/features/reservation/reservation-kind";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { workspaceSiteConstants } from "@/shared/utils";
import { instantStringSchema } from "@/shared/utils/temporal";
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
import {
  type AdministrationStatusGroup,
  canCancelReservation,
  getAdministrationReservationLifecycle,
  getAdministrationReservationStatus,
} from "./reservation-status";

const reservationPageSize = 24;
const bookingPageSize = 24;
const customerPageSize = 24;
const providerIdBatchSize = 50;
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

export type AdministrationSortDirection = "asc" | "desc";

export type AdministrationReservationSortDirection =
  AdministrationSortDirection;

type ReservationListInput = AdministrationReservationListInput & {
  readonly pageSize?: number;
};

export type AdministrationCustomerListInput = {
  readonly direction?: AdministrationSortDirection;
  readonly page?: number;
  readonly sort?: AdministrationCustomerSort;
};

export type AdministrationCustomerSort = "reservations" | "activity";

export type AdministrationBookingListInput = {
  readonly date: string;
  readonly direction?: AdministrationSortDirection;
  readonly page?: number;
  readonly sort?: AdministrationBookingSort;
};

export type AdministrationBookingSort = "booking" | "status";

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
  readonly purpose: WorkspaceReservation["reservationPurpose"];
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
  readonly refundState: PaymentRefundState;
  readonly providerOrderId: NexiOrderId | null;
  readonly providerLabel: string;
  readonly stateLabel: string;
  readonly failureCode: string | null;
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

export type AdministrationCustomerReservationActivity = {
  readonly from: string;
  readonly to: string;
  readonly dates:
    | readonly {
        readonly category: AdministrationCustomerReservationActivityCategory;
        readonly date: string;
        readonly count: number;
      }[]
    | null;
};

export type AdministrationCustomerReservationActivityCategory =
  | `cowork-${WorkspaceCoworkProductTier}`
  | Exclude<WorkspaceReservationKind, "cowork">;

const customerReservationActivityCategoryPriority = {
  "cowork-basic": 0,
  "cowork-plus": 1,
  "cowork-profi": 2,
  "meeting-room": 3,
  office: 4,
} satisfies Record<AdministrationCustomerReservationActivityCategory, number>;

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
  readonly canCancel: boolean;
  readonly requiresProviderCredentialRemoval: boolean;
  readonly reservation: AdministrationReservationSummary;
  readonly booking: AdministrationBookingSummary | null;
  readonly lifecycle: ReturnType<typeof getAdministrationReservationLifecycle>;
  readonly operatorNotice: {
    readonly message: string;
    readonly status: "error" | "success" | "warning";
    readonly title: string;
  } | null;
  readonly timeline: readonly AdministrationTimelineItem[];
  readonly paymentAttempts: readonly AdministrationPaymentAttempt[];
  readonly orders: readonly AdministrationOrder[];
  readonly discounts: readonly AdministrationDiscountApplication[];
  readonly accessGrant: AdministrationReservationAccessGrant | null;
  readonly otherCustomerReservations: readonly AdministrationReservationSummary[];
  readonly sameDateReservations: readonly AdministrationReservationSummary[];
  readonly references: {
    readonly workspaceReservationId: WorkspaceReservationId;
    readonly dotyposReservationId: DotyposReservationId | null;
    readonly customerId: DotyposCustomerId;
  };
};

export type AdministrationReservationAccessGrant = {
  readonly id: string;
  readonly state:
    | "pending"
    | "provisioning"
    | "issued"
    | "expired"
    | "uncertain"
    | "failed";
  readonly provider: string;
  readonly credentialType: string;
  readonly deviceId: string;
  readonly providerCredentialId: string | null;
  readonly accessName: string;
  readonly scheduledStartsAt: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly provisioningStartedAt: string | null;
  readonly issuedAt: string | null;
  readonly failedAt: string | null;
  readonly failureCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type AdministrationCustomerSummary = {
  readonly customer: AdministrationCustomer | null;
  readonly customerId: DotyposCustomerId;
  readonly reservationCount: number;
  readonly lastActivityAt: string;
};

export type AdministrationOverviewMetric = {
  readonly completed: number;
  readonly unavailable: boolean;
  readonly value: number;
};

export type AdministrationCustomerOverviewMetric = {
  readonly customers: readonly Pick<
    AdministrationCustomerSummary,
    "customer" | "customerId"
  >[];
  readonly unavailable: boolean;
  readonly value: number;
};

export type AdministrationReservationOverview = {
  readonly ranges: ReturnType<typeof getAdministrationOverviewDateRanges>;
  readonly today: AdministrationOverviewMetric;
  readonly upcoming: AdministrationOverviewMetric;
  readonly lastSevenDays: AdministrationOverviewMetric;
};

export type AdministrationOverview = AdministrationReservationOverview & {
  readonly uniqueCustomers: AdministrationCustomerOverviewMetric;
  readonly newCustomers: AdministrationCustomerOverviewMetric;
};

type AdministrationOverviewRow = Pick<
  WorkspaceReservation,
  "failureCode" | "fulfillmentState" | "paymentState" | "reservationState"
> & {
  readonly id: DotyposReservationId | null;
  readonly customerId: DotyposCustomerId;
};

type AdministrationOverviewSource = {
  readonly currentDate: Temporal.PlainDate;
  readonly ranges: ReturnType<typeof getAdministrationOverviewDateRanges>;
  readonly reservations:
    | {
        readonly kind: "available";
        readonly items: readonly DotyposReservation[];
      }
    | { readonly kind: "unavailable" };
  readonly rows: readonly AdministrationOverviewRow[];
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
  | "reservationPurpose"
  | "reservationCreatedAt"
  | "reservationConfirmedAt"
  | "reservationCancelledAt"
  | "reservationHoldExpiredAt"
  | "paidAt"
  | "fulfilledAt"
  | "fulfillmentFailedAt"
  | "failureCode"
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
  reservationPurpose: workspaceReservations.reservationPurpose,
  reservationCreatedAt: workspaceReservations.reservationCreatedAt,
  reservationConfirmedAt: workspaceReservations.reservationConfirmedAt,
  reservationCancelledAt: workspaceReservations.reservationCancelledAt,
  reservationHoldExpiredAt: workspaceReservations.reservationHoldExpiredAt,
  paidAt: workspaceReservations.paidAt,
  fulfilledAt: workspaceReservations.fulfilledAt,
  fulfillmentFailedAt: workspaceReservations.fulfillmentFailedAt,
  failureCode: workspaceReservations.failureCode,
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
const decodeInstantString = Schema.decodeUnknownOption(instantStringSchema);
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

const indexCustomersById = (customers: readonly DotyposCustomer[]) =>
  new Map(
    customers.flatMap((customer) => {
      const id = Option.getOrUndefined(decodeDotyposCustomerId(customer.id));
      return id ? [[id, customer] as const] : [];
    })
  );

type SafePaymentAttemptRow = {
  readonly id: PaymentAttemptId;
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly providerOrderId: NexiOrderId | null;
  readonly provider: "internal" | "nexi";
  readonly state: PaymentAttemptState;
  readonly failureCode: string | null;
  readonly refundState: PaymentRefundState;
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
  failureCode: paymentAttempts.failureCode,
  refundState: paymentAttempts.refundState,
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
  refundState: attempt.refundState,
  providerOrderId: attempt.providerOrderId,
  providerLabel:
    attempt.provider === "internal" ? "Included" : "Online payment",
  stateLabel:
    attempt.failureCode === "payment_abandoned_after_provider_cutoff"
      ? "Abandoned"
      : paymentAttemptStateLabels[attempt.state],
  failureCode: attempt.failureCode,
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

const isReservationInRange = (
  reservation: DotyposReservation,
  range: AdministrationReservationDateRange
) => {
  const date = getReservationDate(reservation.startDate);
  return (!range.from || date >= range.from) && (!range.to || date <= range.to);
};

const countLinkedReservations = (input: {
  readonly linkedReservationIds: ReadonlySet<DotyposReservationId>;
  readonly range: AdministrationReservationDateRange;
  readonly reservations: readonly DotyposReservation[];
  readonly status?: DotyposReservation["status"];
}) =>
  new Set(
    input.reservations.flatMap((reservation) => {
      const id = Option.getOrUndefined(
        decodeDotyposReservationId(reservation.id)
      );
      return id &&
        input.linkedReservationIds.has(id) &&
        isReservationInRange(reservation, input.range) &&
        (!input.status || reservation.status === input.status)
        ? [id]
        : [];
    })
  ).size;

type LiveReservationDetails = {
  readonly reservation: DotyposReservation | null;
  readonly customer: DotyposCustomer | null;
};

const getReservationStatusNote = (
  row: SafeReservationRow,
  live: LiveReservationDetails,
  latePayment: boolean,
  recoveryState?: LatePaymentRecoveryState
) => {
  if (recoveryState === "pending" || recoveryState === "processing") {
    return "Recovery in progress";
  }
  if (recoveryState === "review_required") return "Recovery needs review";
  if (latePayment) return "Refund required";
  if (row.failureCode === "payment_outcome_unconfirmed_before_cleanup") {
    return "Payment needs review";
  }
  return live.reservation?.status === "CANCELLED" &&
    row.reservationState !== "cancelled"
    ? "Cancelled in Dotypos"
    : null;
};

const toReservationSummary = ({
  latePayment = false,
  recoveryState,
  latestPayment = null,
  live,
  row,
}: {
  readonly latePayment?: boolean;
  readonly recoveryState?: LatePaymentRecoveryState;
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
    purpose: row.reservationPurpose,
    status: getAdministrationReservationStatus({
      dotyposStatus: live.reservation?.status,
      failureCode: row.failureCode,
      fulfillmentState: row.fulfillmentState,
      latePayment,
      latePaymentRecovery: recoveryState,
      paymentState: row.paymentState,
      reservationState: row.reservationState,
    }),
    statusNote:
      latestPayment?.refundState === "required"
        ? "Needs refund"
        : getReservationStatusNote(row, live, latePayment, recoveryState),
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
  when ${workspaceReservations.reservationState} = 'cancelled'
    and ${workspaceReservations.failureCode} = 'payment_abandoned_after_provider_cutoff'
    then 'Abandoned'
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
    const abandoned =
      attempt.failureCode === "payment_abandoned_after_provider_cutoff";
    return [
      started,
      {
        id: `payment-attempt-${attempt.id}-${attempt.state}`,
        title: abandoned
          ? "Payment abandoned"
          : {
              cancelled: "Payment unsuccessful",
              expired: "Payment unsuccessful",
              failed: "Payment failed",
            }[attempt.state],
        description: abandoned
          ? "Workspace released the reservation after the local payment window elapsed and Nexi still reported no payment activity."
          : "The attempt ended without a recorded payment.",
        occurredAt: attempt.updatedAt,
        tone: "warning" as const,
      },
    ];
  });

type LatePaymentEventRow = {
  readonly eventId: string;
  readonly receivedAt: Temporal.Instant;
  readonly reservationId: WorkspaceReservationId;
};

type LatePaymentRecoveryRow = {
  readonly paymentAttemptId: PaymentAttemptId;
  readonly reservationId: WorkspaceReservationId;
  readonly state: LatePaymentRecoveryState;
  readonly failureCode: string | null;
  readonly verifiedPaidAt: Temporal.Instant;
  readonly completedAt: Temporal.Instant | null;
};

const latePaymentRecoverySelection = {
  paymentAttemptId: latePaymentRecoveries.paymentAttemptId,
  reservationId: latePaymentRecoveries.workspaceReservationId,
  state: latePaymentRecoveries.state,
  failureCode: latePaymentRecoveries.failureCode,
  verifiedPaidAt: latePaymentRecoveries.verifiedPaidAt,
  completedAt: latePaymentRecoveries.completedAt,
} as const;

const latePaymentSelection = {
  eventId: webhookEvents.eventId,
  receivedAt: webhookEvents.receivedAt,
  reservationId: paymentAttempts.workspaceReservationId,
} as const;

const latePaymentCondition = (
  reservationIds: readonly WorkspaceReservationId[]
) =>
  and(
    inArray(paymentAttempts.workspaceReservationId, [...reservationIds]),
    eq(webhookEvents.errorCode, "nexi_webhook_late_payment")
  );

const buildLatePaymentTimeline = (
  events: readonly LatePaymentEventRow[]
): readonly AdministrationTimelineItem[] =>
  events.map((event) => ({
    id: `late-payment-${event.eventId}`,
    title: "Late payment — refund required",
    description:
      "Nexi reported payment after Workspace released the reservation. The reservation was not fulfilled and the payment requires an operator refund.",
    occurredAt: toIsoString(event.receivedAt),
    tone: "warning",
  }));

const buildLatePaymentRecoveryTimeline = (
  recoveries: readonly LatePaymentRecoveryRow[]
): readonly AdministrationTimelineItem[] =>
  recoveries.flatMap((recovery) => {
    const detected: AdministrationTimelineItem = {
      id: `late-payment-recovery-${recovery.paymentAttemptId}-detected`,
      title: "Late payment recovery started",
      description:
        "Nexi reported payment after local expiration. Workspace is checking whether the reservation can still be fulfilled.",
      occurredAt: toIsoString(recovery.verifiedPaidAt),
      tone: "warning",
    };
    if (!recovery.completedAt) return [detected];
    return [
      detected,
      {
        id: `late-payment-recovery-${recovery.paymentAttemptId}-${recovery.state}`,
        title: {
          recovered: "Late payment recovered",
          refund_required: "Late payment — refund required",
          review_required: "Late payment recovery needs review",
        }[
          recovery.state as Exclude<
            LatePaymentRecoveryState,
            "pending" | "processing"
          >
        ],
        description: {
          recovered:
            "Workspace secured a valid booking and continued normal paid fulfillment.",
          refund_required:
            "The reservation could not be safely recovered. Refund the payment in Nexi.",
          review_required:
            "Workspace could not safely determine or complete recovery. Operator review is required.",
        }[
          recovery.state as Exclude<
            LatePaymentRecoveryState,
            "pending" | "processing"
          >
        ],
        occurredAt: toIsoString(recovery.completedAt),
        tone: recovery.state === "recovered" ? "positive" : "warning",
      },
    ];
  });

const getReservationOperatorNotice = (
  row: SafeReservationRow,
  latePayment: boolean,
  recovery?: LatePaymentRecoveryRow
): AdministrationReservationDetail["operatorNotice"] => {
  if (recovery?.state === "pending" || recovery?.state === "processing") {
    return {
      status: "warning",
      title: "Late payment recovery in progress",
      message:
        "Workspace is checking the original booking and current availability. Do not fulfil or refund manually while recovery is running.",
    };
  }
  if (recovery?.state === "recovered") {
    return {
      status: "success",
      title: "Late payment recovered",
      message:
        "Workspace secured a valid booking and continued normal paid fulfillment.",
    };
  }
  if (recovery?.state === "review_required") {
    return {
      status: "error",
      title: "Late payment recovery needs review",
      message:
        "Workspace could not safely complete recovery. Check the original and replacement Dotypos bookings before fulfilling or refunding.",
    };
  }
  if (latePayment) {
    return {
      status: "error",
      title: "Late payment — refund required",
      message:
        "Nexi reported payment after Workspace released this reservation. Do not fulfil it; refund the payment in Nexi.",
    };
  }
  if (row.failureCode === "payment_outcome_unconfirmed_before_cleanup") {
    return {
      status: "warning",
      title: "Payment needs review",
      message:
        "Automatic cleanup kept this reservation held because Nexi reported payment activity or its outcome could not be verified.",
    };
  }
  return null;
};

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
    readonly loadOverview: () => Effect.Effect<AdministrationOverview, unknown>;
    readonly loadReservationOverview: () => Effect.Effect<
      AdministrationReservationOverview,
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
    readonly loadReservationBreadcrumbLabel: (
      id: WorkspaceReservationId
    ) => Effect.Effect<string | null, unknown>;
    readonly findReservationId: (
      identifier: string
    ) => Effect.Effect<WorkspaceReservationId | null, unknown>;
    readonly listBookings: (
      input: AdministrationBookingListInput
    ) => Effect.Effect<AdministrationBookingPage, unknown>;
    readonly loadBooking: (
      id: DotyposReservationId
    ) => Effect.Effect<AdministrationBookingDetail | null, unknown>;
    readonly loadBookingBreadcrumb: (
      id: DotyposReservationId
    ) => Effect.Effect<
      { readonly startsAt: string; readonly tableName: string | null } | null,
      unknown
    >;
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
    readonly loadCustomerReservationActivity: (
      customerId: DotyposCustomerId
    ) => Effect.Effect<AdministrationCustomerReservationActivity, unknown>;
    readonly listOrders: IPaymentAdministrationService["listOrders"];
    readonly loadOrder: IPaymentAdministrationService["loadOrder"];
    readonly listOperations: IPaymentAdministrationService["listOperations"];
    readonly loadOperation: IPaymentAdministrationService["loadOperation"];
  }
>()("@deskohub-workspace/administration/AdministrationService") {
  static Default = Layer.effect(
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
          Effect.catch((cause) => {
            unstable_rethrow(cause);
            return Effect.logWarning("Live customer details unavailable", {
              cause,
              workspaceReservationId: row.id,
            }).pipe(Effect.as({ reservation: null, customer: null } as const));
          })
        );

        if (!row.dotyposReservationId) return loadCustomer;

        return dotypos.getReservation(row.dotyposReservationId).pipe(
          Effect.map(
            ({ customer, reservation }): LiveReservationDetails => ({
              customer,
              reservation,
            })
          ),
          Effect.catch((cause) => {
            unstable_rethrow(cause);
            return Effect.logWarning("Live booking details unavailable", {
              cause,
              workspaceReservationId: row.id,
            }).pipe(Effect.andThen(loadCustomer));
          })
        );
      });

      const loadCustomers = Effect.fn("AdministrationService.loadCustomers")(
        function* (ids: readonly DotyposCustomerId[]) {
          const uniqueIds = [...new Set(ids)];
          const batches = yield* Effect.all(
            EffectArray.chunksOf(uniqueIds, providerIdBatchSize).map(
              (batchIds) =>
                dotypos.getCustomers({ ids: batchIds }).pipe(
                  Effect.map((customers) => ({
                    customers,
                    ids: batchIds,
                  })),
                  Effect.catch((cause) => {
                    unstable_rethrow(cause);
                    return Effect.logWarning(
                      "Batch customer details unavailable",
                      { cause }
                    ).pipe(
                      Effect.as({
                        customers: [] as const,
                        ids: batchIds,
                      })
                    );
                  })
                )
            ),
            { concurrency: 3 }
          );
          const customersById = indexCustomersById(
            batches.flatMap(({ customers }) => customers)
          );
          const missingCustomers = yield* Effect.all(
            batches
              .flatMap(({ ids: batchIds }) => batchIds)
              .filter((id) => !customersById.has(id))
              .map((id) =>
                dotypos.getCustomer(id).pipe(
                  Effect.map((customer) => [id, customer] as const),
                  Effect.catch((cause) => {
                    unstable_rethrow(cause);
                    return Effect.succeed(null);
                  })
                )
              ),
            { concurrency: 5 }
          );
          for (const customer of missingCustomers) {
            if (customer) customersById.set(...customer);
          }
          return customersById;
        }
      );

      const loadLiveReservations = Effect.fn(
        "AdministrationService.loadLiveReservations"
      )(function* (
        rows: readonly SafeReservationRow[],
        knownReservations?: ReadonlyMap<
          DotyposReservationId,
          DotyposReservation
        >
      ) {
        const missingReservationIds = rows.flatMap((row) =>
          row.dotyposReservationId &&
          !knownReservations?.has(row.dotyposReservationId)
            ? [row.dotyposReservationId]
            : []
        );
        const reservations = yield* dotypos
          .listReservations({ ids: missingReservationIds })
          .pipe(
            Effect.catch((cause) => {
              unstable_rethrow(cause);
              return Effect.logWarning("Live booking details unavailable", {
                cause,
              }).pipe(Effect.as([] as const));
            })
          );
        const reservationsById = new Map(knownReservations);
        for (const reservation of reservations) {
          const id = Option.getOrUndefined(
            decodeDotyposReservationId(reservation.id)
          );
          if (id) reservationsById.set(id, reservation);
        }
        const customerIds = [
          ...new Set(
            rows.map((row) => {
              const reservation = row.dotyposReservationId
                ? reservationsById.get(row.dotyposReservationId)
                : undefined;
              return (
                Option.getOrUndefined(
                  decodeDotyposCustomerId(reservation?._customerId)
                ) ?? row.dotyposCustomerId
              );
            })
          ),
        ];
        const customersById = yield* loadCustomers(customerIds);

        return rows.map((row) => {
          const reservation = row.dotyposReservationId
            ? (reservationsById.get(row.dotyposReservationId) ?? null)
            : null;
          const customerId =
            Option.getOrUndefined(
              decodeDotyposCustomerId(reservation?._customerId)
            ) ?? row.dotyposCustomerId;
          return {
            live: {
              reservation,
              customer: customersById.get(customerId) ?? null,
            },
            row,
          };
        });
      });

      const enrichRows = Effect.fn("AdministrationService.enrichRows")(
        function* (
          rows: readonly SafeReservationRow[],
          knownReservations?: ReadonlyMap<
            DotyposReservationId,
            DotyposReservation
          >
        ) {
          if (rows.length === 0) return [];
          const { attemptRows, latePaymentRows, liveRows, recoveryRows } =
            yield* Effect.all(
              {
                attemptRows: db
                  .select(safePaymentAttemptSelection)
                  .from(paymentAttempts)
                  .where(
                    inArray(
                      paymentAttempts.workspaceReservationId,
                      rows.map(({ id }) => id)
                    )
                  )
                  .orderBy(desc(paymentAttempts.createdAt)),
                latePaymentRows: db
                  .select(latePaymentSelection)
                  .from(webhookEvents)
                  .innerJoin(
                    paymentAttempts,
                    eq(webhookEvents.paymentAttemptId, paymentAttempts.id)
                  )
                  .where(latePaymentCondition(rows.map(({ id }) => id))),
                recoveryRows: db
                  .select(latePaymentRecoverySelection)
                  .from(latePaymentRecoveries)
                  .where(
                    inArray(
                      latePaymentRecoveries.workspaceReservationId,
                      rows.map(({ id }) => id)
                    )
                  )
                  .orderBy(asc(latePaymentRecoveries.createdAt)),
                liveRows: loadLiveReservations(rows, knownReservations),
              },
              { concurrency: 3 }
            );
          const latePaymentReservationIds = new Set(
            latePaymentRows.map(({ reservationId }) => reservationId)
          );
          const recoveryByReservation = new Map(
            recoveryRows.map((recovery) => [recovery.reservationId, recovery])
          );
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

          return liveRows.map(({ live, row }) =>
            toReservationSummary({
              latestPayment: latestPaymentByReservation.get(row.id) ?? null,
              latePayment: recoveryByReservation.has(row.id)
                ? recoveryByReservation.get(row.id)?.state === "refund_required"
                : latePaymentReservationIds.has(row.id),
              recoveryState: recoveryByReservation.get(row.id)?.state,
              live,
              row,
            })
          );
        }
      );

      const loadBookingTables = () =>
        dotypos.getTables().pipe(
          Effect.catch((cause) => {
            unstable_rethrow(cause);
            return Effect.logWarning("Booking table details unavailable", {
              cause,
            }).pipe(Effect.as([] as const));
          })
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
            Effect.catch((cause) => {
              unstable_rethrow(cause);
              return Effect.logWarning("Reservation date filter unavailable", {
                cause,
                ...range,
              }).pipe(Effect.as(null));
            })
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
            Effect.catch((cause) => {
              unstable_rethrow(cause);
              return Effect.logWarning("Reservation date sorting unavailable", {
                cause,
              }).pipe(Effect.as(null));
            })
          );
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
          items: yield* enrichRows(rows, dateReservations ?? undefined),
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
          accessRows,
          applicationRows,
          attemptRows,
          history,
          latePaymentRows,
          recoveryRows,
          live,
          orders,
          otherRows,
          tables,
        } = yield* Effect.all(
          {
            accessRows: db
              .select({
                id: reservationAccessGrants.id,
                state: reservationAccessGrants.state,
                provider: reservationAccessGrants.provider,
                credentialType: reservationAccessGrants.credentialType,
                deviceId: reservationAccessGrants.deviceId,
                providerCredentialId:
                  reservationAccessGrants.providerCredentialId,
                scheduledStartsAt:
                  reservationAccessGrants.scheduledAccessStartsAt,
                startsAt: reservationAccessGrants.accessStartsAt,
                endsAt: reservationAccessGrants.accessEndsAt,
                provisioningStartedAt:
                  reservationAccessGrants.provisioningStartedAt,
                issuedAt: reservationAccessGrants.issuedAt,
                failedAt: reservationAccessGrants.failedAt,
                failureCode: reservationAccessGrants.failureCode,
                createdAt: reservationAccessGrants.createdAt,
                updatedAt: reservationAccessGrants.updatedAt,
              })
              .from(reservationAccessGrants)
              .where(eq(reservationAccessGrants.workspaceReservationId, row.id))
              .limit(1),
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
            latePaymentRows: db
              .select(latePaymentSelection)
              .from(webhookEvents)
              .innerJoin(
                paymentAttempts,
                eq(webhookEvents.paymentAttemptId, paymentAttempts.id)
              )
              .where(latePaymentCondition([row.id]))
              .orderBy(webhookEvents.receivedAt),
            recoveryRows: db
              .select(latePaymentRecoverySelection)
              .from(latePaymentRecoveries)
              .where(eq(latePaymentRecoveries.workspaceReservationId, row.id))
              .orderBy(latePaymentRecoveries.createdAt),
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
          { concurrency: 8 }
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
        const recovery = recoveryRows.at(-1);
        const latePayment = recovery
          ? recovery.state === "refund_required"
          : latePaymentRows.length > 0;
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
            latePayment,
            recoveryState: recovery?.state,
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
            failureCode: row.failureCode,
            fulfillmentState: row.fulfillmentState,
            latePayment,
            latePaymentRecovery: recovery?.state,
            paymentState: row.paymentState,
            reservationState: row.reservationState,
          }),
          operatorNotice: getReservationOperatorNotice(
            row,
            latePayment,
            recovery
          ),
          timeline: mergeReservationHistory({
            durable: [
              ...buildTimeline(row),
              ...buildPaymentAttemptTimeline(attempts),
              ...buildLatePaymentTimeline(latePaymentRows),
              ...buildLatePaymentRecoveryTimeline(recoveryRows),
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
          accessGrant: accessRows[0]
            ? {
                ...accessRows[0],
                accessName: `Deskohub ${row.id}`.slice(0, 60),
                scheduledStartsAt: accessRows[0].scheduledStartsAt.toString(),
                startsAt: accessRows[0].startsAt.toString(),
                endsAt: accessRows[0].endsAt.toString(),
                provisioningStartedAt:
                  accessRows[0].provisioningStartedAt?.toString() ?? null,
                issuedAt: accessRows[0].issuedAt?.toString() ?? null,
                failedAt: accessRows[0].failedAt?.toString() ?? null,
                createdAt: accessRows[0].createdAt.toString(),
                updatedAt: accessRows[0].updatedAt.toString(),
              }
            : null,
          otherCustomerReservations,
          sameDateReservations,
          references: {
            workspaceReservationId: row.id,
            dotyposReservationId: row.dotyposReservationId,
            customerId: row.dotyposCustomerId,
          },
          canCancel: canCancelReservation(row),
          requiresProviderCredentialRemoval: Boolean(
            accessRows[0] &&
              ["issued", "uncertain", "provisioning"].includes(
                accessRows[0].state
              ) &&
              Temporal.Instant.compare(
                accessRows[0].endsAt,
                Temporal.Now.instant()
              ) > 0
          ),
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
        function* (input: AdministrationBookingListInput) {
          const bookings = (yield* dotypos.listReservations({
            ...getDateBounds(input.date),
            order: "startDateAscending",
          })).flatMap((booking) => {
            const id = Option.getOrUndefined(
              decodeDotyposReservationId(booking.id)
            );
            return id ? [{ ...booking, id }] : [];
          });
          const direction = input.direction === "desc" ? -1 : 1;
          const sortedBookings = bookings.toSorted((left, right) => {
            const primary =
              input.sort === "status"
                ? left.status.localeCompare(right.status)
                : left.startDate.localeCompare(right.startDate);
            return (
              direction *
              (primary ||
                left.startDate.localeCompare(right.startDate) ||
                left.id.localeCompare(right.id))
            );
          });
          const pagination = getAdministrationPagination({
            pageSize: bookingPageSize,
            requestedPage: input.page,
            total: sortedBookings.length,
          });
          const pageBookings = sortedBookings.slice(
            pagination.offset,
            pagination.offset + bookingPageSize
          );
          const bookingIds = pageBookings.map(({ id }) => id);
          const customerIds = [
            ...new Set(
              pageBookings.flatMap((booking) => {
                const customerId = Option.getOrUndefined(
                  decodeDotyposCustomerId(booking._customerId)
                );
                return customerId ? [customerId] : [];
              })
            ),
          ];
          const { customersById, rows, tables } = yield* Effect.all(
            {
              customersById: loadCustomers(customerIds),
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
                customer: Option.match(
                  decodeDotyposCustomerId(booking._customerId),
                  {
                    onNone: () => null,
                    onSome: (customerId) =>
                      customersById.get(customerId) ?? null,
                  }
                ),
                row: rowsByBookingId.get(booking.id) ?? null,
                table: Option.match(decodeDotyposTableId(booking._tableId), {
                  onNone: () => null,
                  onSome: (tableId) => tablesById.get(tableId) ?? null,
                }),
              })
            ),
            page: pagination.page,
            pageCount: pagination.pageCount,
            total: sortedBookings.length,
          } satisfies AdministrationBookingPage;
        }
      );

      const loadReservationBreadcrumbLabel = Effect.fn(
        "AdministrationService.loadReservationBreadcrumbLabel"
      )(function* (id: WorkspaceReservationId) {
        const [row] = yield* db
          .select({
            reservationDetails: workspaceReservations.reservationDetails,
          })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, id))
          .limit(1);
        return row ? getReservationTypeLabel(row) : null;
      });

      const loadBooking = Effect.fn("AdministrationService.loadBooking")(
        function* (id: DotyposReservationId) {
          const { details, rows, tables } = yield* Effect.all(
            {
              details: dotypos
                .getReservation(id)
                .pipe(
                  Effect.catchTag("ExternalAPIError", (error) =>
                    error.statusCode === 404
                      ? Effect.succeed(null)
                      : Effect.fail(error)
                  )
                ),
              rows: db
                .select(safeReservationSelection)
                .from(workspaceReservations)
                .where(eq(workspaceReservations.dotyposReservationId, id))
                .limit(1),
              tables: loadBookingTables(),
            },
            { concurrency: 3 }
          );
          if (!details) return null;
          const { customer, reservation } = details;
          const [row] = rows;
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

      const loadBookingBreadcrumb = Effect.fn(
        "AdministrationService.loadBookingBreadcrumb"
      )(function* (id: DotyposReservationId) {
        const { details, tables } = yield* Effect.all(
          {
            details: dotypos
              .getReservation(id)
              .pipe(
                Effect.catchTag("ExternalAPIError", (error) =>
                  error.statusCode === 404
                    ? Effect.succeed(null)
                    : Effect.fail(error)
                )
              ),
            tables: loadBookingTables(),
          },
          { concurrency: 2 }
        );
        if (!details) return null;
        const tableId = Option.getOrUndefined(
          decodeDotyposTableId(details.reservation._tableId)
        );
        const tableName = tableId
          ? (tables.find(
              ({ id: candidateId }) =>
                Option.getOrUndefined(decodeDotyposTableId(candidateId)) ===
                tableId
            )?.name ?? null)
          : null;
        return { startsAt: details.reservation.startDate, tableName };
      });

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
          const reservationCount = count();
          const lastActivityAt = max(workspaceReservations.updatedAt);
          const order = input.direction === "asc" ? asc : desc;
          const rows = yield* db
            .select({
              customerId: workspaceReservations.dotyposCustomerId,
              reservationCount,
              lastActivityAt,
            })
            .from(workspaceReservations)
            .groupBy(workspaceReservations.dotyposCustomerId)
            .orderBy(
              order(
                input.sort === "reservations"
                  ? reservationCount
                  : lastActivityAt
              ),
              asc(workspaceReservations.dotyposCustomerId)
            )
            .limit(customerPageSize)
            .offset(pagination.offset);
          const customersById = yield* loadCustomers(
            rows.map(({ customerId }) => customerId)
          );
          const items = rows.map((row) => {
            const customer = customersById.get(row.customerId);
            return {
              customer: customer ? toCustomer(customer, row.customerId) : null,
              customerId: row.customerId,
              reservationCount: Number(row.reservationCount),
              lastActivityAt: row.lastActivityAt
                ? toIsoString(row.lastActivityAt)
                : Temporal.Instant.fromEpochMilliseconds(0).toString(),
            };
          });
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

      const loadCustomerReservationActivity = Effect.fn(
        "AdministrationService.loadCustomerReservationActivity"
      )(function* (customerId: DotyposCustomerId) {
        const now = Temporal.Now.instant();
        const to = getCurrentWorkspaceDate(now);
        const from = to.subtract({ days: 364 });
        const reservations = yield* dotypos
          .listReservations({
            customerId,
            ...getInclusiveDateRangeBounds({
              from: from.toString(),
              to: to.toString(),
            }),
            order: "startDateAscending",
          })
          .pipe(
            Effect.catch((cause) => {
              unstable_rethrow(cause);
              return Effect.logWarning(
                "Customer reservation activity unavailable",
                { cause, customerId }
              ).pipe(Effect.as(null));
            })
          );

        if (!reservations) {
          return {
            from: from.toString(),
            to: to.toString(),
            dates: null,
          } satisfies AdministrationCustomerReservationActivity;
        }

        const reservationIds = reservations.flatMap((reservation) => {
          const id = Option.getOrUndefined(
            decodeDotyposReservationId(reservation.id)
          );
          return id ? [id] : [];
        });
        const linkedRows =
          reservationIds.length === 0
            ? []
            : yield* db
                .select({
                  id: workspaceReservations.dotyposReservationId,
                  reservationDetails: workspaceReservations.reservationDetails,
                })
                .from(workspaceReservations)
                .where(
                  and(
                    eq(workspaceReservations.dotyposCustomerId, customerId),
                    inArray(
                      workspaceReservations.dotyposReservationId,
                      reservationIds
                    )
                  )
                );
        const linkedReservations = new Map(
          linkedRows.flatMap(({ id, reservationDetails }) =>
            id ? ([[id, reservationDetails]] as const) : []
          )
        );
        const activityByDate = new Map<
          string,
          {
            readonly category: AdministrationCustomerReservationActivityCategory;
            readonly count: number;
          }
        >();
        for (const reservation of reservations) {
          const id = Option.getOrUndefined(
            decodeDotyposReservationId(reservation.id)
          );
          const reservationDetails = id
            ? linkedReservations.get(id)
            : undefined;
          if (!reservationDetails) {
            continue;
          }
          const date = getReservationDate(reservation.startDate);
          const category =
            reservationDetails.kind === "cowork"
              ? (`cowork-${reservationDetails.entryTier}` as const)
              : reservationDetails.kind;
          const current = activityByDate.get(date);
          activityByDate.set(date, {
            count: (current?.count ?? 0) + 1,
            category:
              !current ||
              customerReservationActivityCategoryPriority[category] >
                customerReservationActivityCategoryPriority[current.category]
                ? category
                : current.category,
          });
        }

        return {
          from: from.toString(),
          to: to.toString(),
          dates: [...activityByDate]
            .map(([date, activity]) => ({ date, ...activity }))
            .toSorted((left, right) => left.date.localeCompare(right.date)),
        } satisfies AdministrationCustomerReservationActivity;
      });

      const loadOverviewSource = Effect.fn(
        "AdministrationService.loadOverviewSource"
      )(function* () {
        const currentDate = getCurrentWorkspaceDate();
        const ranges = getAdministrationOverviewDateRanges(currentDate);
        const overviewRange = {
          from: ranges.lastSevenDays.from,
          to: ranges.upcoming.to,
        };
        const reservations = yield* dotypos
          .listReservations({
            ...getInclusiveDateRangeBounds(overviewRange),
            order: "startDateAscending",
          })
          .pipe(
            Effect.map((items) => ({
              kind: "available" as const,
              items,
            })),
            Effect.catch((cause) => {
              unstable_rethrow(cause);
              return Effect.logWarning("Reservation overview unavailable", {
                cause,
                ...overviewRange,
              }).pipe(Effect.as({ kind: "unavailable" as const }));
            })
          );
        const reservationIds =
          reservations.kind === "available"
            ? reservations.items.flatMap((reservation) => {
                const id = Option.getOrUndefined(
                  decodeDotyposReservationId(reservation.id)
                );
                return id ? [id] : [];
              })
            : [];
        const rows =
          reservationIds.length === 0
            ? []
            : yield* db
                .select({
                  id: workspaceReservations.dotyposReservationId,
                  customerId: workspaceReservations.dotyposCustomerId,
                  failureCode: workspaceReservations.failureCode,
                  fulfillmentState: workspaceReservations.fulfillmentState,
                  paymentState: workspaceReservations.paymentState,
                  reservationState: workspaceReservations.reservationState,
                })
                .from(workspaceReservations)
                .where(
                  inArray(
                    workspaceReservations.dotyposReservationId,
                    reservationIds
                  )
                );
        return { currentDate, ranges, reservations, rows };
      });

      const loadReservationOverview = Effect.fn(
        "AdministrationService.loadReservationOverview"
      )(function* () {
        return getReservationOverview(yield* loadOverviewSource());
      });

      const loadOverview = Effect.fn("AdministrationService.loadOverview")(
        function* () {
          const { currentDate, ranges, reservations, rows } =
            yield* loadOverviewSource();
          const customerIdsByReservationId = new Map(
            rows.flatMap(({ customerId, id }) =>
              id ? ([[id, customerId]] as const) : []
            )
          );
          const customerActivityBounds = getDateRangeBounds(
            ranges.lastSevenDays.from,
            currentDate.add({ days: 1 }).toString()
          );
          const customerActivityStartsAt = Temporal.Instant.from(
            customerActivityBounds.startsAtOrAfter
          );
          const customerActivityEndsBefore = Temporal.Instant.from(
            customerActivityBounds.startsBefore
          );
          const uniqueCustomerIds =
            reservations.kind === "available"
              ? getUniqueCustomerIds({
                  customerIdsByReservationId,
                  range: ranges.lastSevenDays,
                  reservations: reservations.items,
                })
              : [];
          const [uniqueCustomersById, recentCustomers] = yield* Effect.all(
            [
              loadCustomers(uniqueCustomerIds.slice(0, 3)),
              reservations.kind === "available"
                ? dotypos
                    .getCustomers({
                      createdAtOrAfter: customerActivityBounds.startsAtOrAfter,
                      createdBefore: customerActivityBounds.startsBefore,
                    })
                    .pipe(
                      Effect.map((items) => ({
                        items,
                        kind: "available" as const,
                      })),
                      Effect.catch((cause) => {
                        unstable_rethrow(cause);
                        return Effect.logWarning(
                          "New customer details unavailable",
                          { cause }
                        ).pipe(
                          Effect.as({
                            items: [] as const,
                            kind: "unavailable" as const,
                          })
                        );
                      })
                    )
                : Effect.succeed({
                    items: [] as const,
                    kind: "unavailable" as const,
                  }),
            ],
            { concurrency: "inherit" }
          );
          const recentCustomersById = indexCustomersById(recentCustomers.items);
          const recentCustomerIds = [...recentCustomersById.keys()];
          const recentReservationLookups =
            recentCustomers.kind === "available"
              ? yield* Effect.all(
                  EffectArray.chunksOf(
                    recentCustomerIds,
                    providerIdBatchSize
                  ).map((customerIds) =>
                    dotypos.listReservations({ customerIds }).pipe(
                      Effect.map((items) => ({
                        items,
                        kind: "available" as const,
                      })),
                      Effect.catch((cause) => {
                        unstable_rethrow(cause);
                        return Effect.logWarning(
                          "New customer bookings unavailable",
                          { cause, customerCount: customerIds.length }
                        ).pipe(
                          Effect.as({
                            items: [] as const,
                            kind: "unavailable" as const,
                          })
                        );
                      })
                    )
                  ),
                  { concurrency: 5 }
                )
              : [];
          const reservationsById = new Map<
            DotyposReservationId,
            DotyposReservation
          >();
          for (const reservation of [
            ...(reservations.kind === "available" ? reservations.items : []),
            ...recentReservationLookups.flatMap(({ items }) => items),
          ]) {
            const id = Option.getOrUndefined(
              decodeDotyposReservationId(reservation.id)
            );
            if (id) reservationsById.set(id, reservation);
          }
          const recentReservationIds = [
            ...new Set(
              recentReservationLookups.flatMap(({ items }) =>
                items.flatMap((reservation) => {
                  const id = Option.getOrUndefined(
                    decodeDotyposReservationId(reservation.id)
                  );
                  return id ? [id] : [];
                })
              )
            ),
          ];
          const recentBookingsAvailable = recentReservationLookups.every(
            ({ kind }) => kind === "available"
          );
          const recentRows =
            recentCustomerIds.length === 0 || !recentBookingsAvailable
              ? []
              : yield* db
                  .select({
                    id: workspaceReservations.dotyposReservationId,
                    customerId: workspaceReservations.dotyposCustomerId,
                  })
                  .from(workspaceReservations)
                  .where(
                    recentReservationIds.length === 0
                      ? inArray(
                          workspaceReservations.dotyposCustomerId,
                          recentCustomerIds
                        )
                      : or(
                          inArray(
                            workspaceReservations.dotyposCustomerId,
                            recentCustomerIds
                          ),
                          inArray(
                            workspaceReservations.dotyposReservationId,
                            recentReservationIds
                          )
                        )
                  );
          const missingReservationBatches = yield* Effect.all(
            EffectArray.chunksOf(
              [
                ...new Set(
                  recentRows.flatMap(({ id }) =>
                    id && !reservationsById.has(id) ? [id] : []
                  )
                ),
              ],
              providerIdBatchSize
            ).map((ids) =>
              dotypos.listReservations({ ids }).pipe(
                Effect.map((items) => ({
                  items,
                  kind: "available" as const,
                })),
                Effect.catch((cause) => {
                  unstable_rethrow(cause);
                  return Effect.logWarning(
                    "Current booking customers unavailable",
                    { cause }
                  ).pipe(
                    Effect.as({
                      items: [] as const,
                      kind: "unavailable" as const,
                    })
                  );
                })
              )
            ),
            { concurrency: 3 }
          );
          for (const reservation of missingReservationBatches.flatMap(
            ({ items }) => items
          )) {
            const id = Option.getOrUndefined(
              decodeDotyposReservationId(reservation.id)
            );
            if (id) reservationsById.set(id, reservation);
          }
          const customerIdentitiesAvailable =
            reservations.kind === "available" &&
            recentCustomers.kind === "available" &&
            recentCustomers.items.every((customer) =>
              Option.isSome(decodeDotyposCustomerId(customer.id))
            ) &&
            recentBookingsAvailable &&
            missingReservationBatches.every(({ kind }) => kind === "available");
          const referencedCustomerIds = customerIdentitiesAvailable
            ? [
                ...new Set(
                  recentRows.flatMap(({ customerId, id }) => {
                    const currentCustomerId = id
                      ? Option.getOrUndefined(
                          decodeDotyposCustomerId(
                            reservationsById.get(id)?._customerId
                          )
                        )
                      : undefined;
                    const referencedCustomerId =
                      currentCustomerId ?? customerId;
                    return recentCustomersById.has(referencedCustomerId)
                      ? [referencedCustomerId]
                      : [];
                  })
                ),
              ]
            : [];
          const newCustomerIds = customerIdentitiesAvailable
            ? getNewCustomerIds({
                candidateIds: referencedCustomerIds,
                customersById: recentCustomersById,
                endsBefore: customerActivityEndsBefore,
                startsAt: customerActivityStartsAt,
              })
            : { ids: [], unavailable: true, value: 0 };
          const toCustomerMetric = (
            metric: {
              readonly ids: readonly DotyposCustomerId[];
              readonly unavailable: boolean;
              readonly value: number;
            },
            customersById: ReadonlyMap<DotyposCustomerId, DotyposCustomer>
          ): AdministrationCustomerOverviewMetric => ({
            customers: metric.ids.slice(0, 3).map((customerId) => {
              const customer = customersById.get(customerId);
              return {
                customer: customer ? toCustomer(customer, customerId) : null,
                customerId,
              };
            }),
            unavailable: metric.unavailable,
            value: metric.value,
          });
          const uniqueCustomers = toCustomerMetric(
            {
              ids: uniqueCustomerIds,
              unavailable: reservations.kind === "unavailable",
              value:
                reservations.kind === "available"
                  ? uniqueCustomerIds.length
                  : 0,
            },
            uniqueCustomersById
          );
          const newCustomers = toCustomerMetric(
            newCustomerIds,
            recentCustomersById
          );
          return {
            ...getReservationOverview({ ranges, reservations, rows }),
            uniqueCustomers,
            newCustomers,
          };
        }
      );

      return {
        loadOverview,
        loadReservationOverview,
        listReservations,
        loadReservation,
        loadReservationBreadcrumbLabel,
        findReservationId,
        listBookings,
        loadBooking,
        loadBookingBreadcrumb,
        listCustomers,
        loadCustomerReservations,
        loadCustomerActivity,
        loadCustomerReservationActivity,
        listOrders: paymentAdministration.listOrders,
        loadOrder: paymentAdministration.loadOrder,
        listOperations: paymentAdministration.listOperations,
        loadOperation: paymentAdministration.loadOperation,
      };
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        WorkspaceDotyposLayer,
        PaymentAdministrationService.Live,
        PostHogReservationHistory.Live
      )
    )
  );
}

function getReservationOverview({
  ranges,
  reservations,
  rows,
}: Pick<AdministrationOverviewSource, "ranges" | "reservations" | "rows">) {
  if (reservations.kind === "unavailable") {
    const unavailable = {
      completed: 0,
      unavailable: true,
      value: 0,
    } as const;
    return {
      ranges,
      today: unavailable,
      upcoming: unavailable,
      lastSevenDays: unavailable,
    } satisfies AdministrationReservationOverview;
  }

  const linkedReservationIds = new Set(
    rows.flatMap(({ id }) => (id ? [id] : []))
  );
  const completedReservationIds = new Set(
    rows.flatMap((row) =>
      row.id && getAdministrationReservationStatus(row).group === "complete"
        ? [row.id]
        : []
    )
  );
  const getMetric = (range: AdministrationReservationDateRange) => ({
    completed: countLinkedReservations({
      linkedReservationIds: completedReservationIds,
      range,
      reservations: reservations.items,
      status: "CONFIRMED",
    }),
    unavailable: false,
    value: countLinkedReservations({
      linkedReservationIds,
      range,
      reservations: reservations.items,
    }),
  });
  return {
    ranges,
    today: getMetric(ranges.today),
    upcoming: getMetric(ranges.upcoming),
    lastSevenDays: getMetric(ranges.lastSevenDays),
  } satisfies AdministrationReservationOverview;
}

function getUniqueCustomerIds(input: {
  readonly customerIdsByReservationId: ReadonlyMap<
    DotyposReservationId,
    DotyposCustomerId
  >;
  readonly range: AdministrationReservationDateRange;
  readonly reservations: readonly DotyposReservation[];
}) {
  const latestBookingByCustomerId = new Map<
    DotyposCustomerId,
    Temporal.Instant
  >();
  for (const reservation of input.reservations) {
    const reservationId = Option.getOrUndefined(
      decodeDotyposReservationId(reservation.id)
    );
    const fallbackCustomerId = reservationId
      ? input.customerIdsByReservationId.get(reservationId)
      : undefined;
    if (!fallbackCustomerId || !isReservationInRange(reservation, input.range))
      continue;

    const customerId =
      Option.getOrUndefined(decodeDotyposCustomerId(reservation._customerId)) ??
      fallbackCustomerId;
    const startsAt = Temporal.Instant.from(reservation.startDate);
    const latestBooking = latestBookingByCustomerId.get(customerId);
    if (!latestBooking || Temporal.Instant.compare(startsAt, latestBooking) > 0)
      latestBookingByCustomerId.set(customerId, startsAt);
  }
  return [...latestBookingByCustomerId]
    .toSorted(
      ([leftId, left], [rightId, right]) =>
        Temporal.Instant.compare(right, left) || leftId.localeCompare(rightId)
    )
    .map(([customerId]) => customerId);
}

function getNewCustomerIds(input: {
  readonly candidateIds: readonly DotyposCustomerId[];
  readonly customersById: ReadonlyMap<DotyposCustomerId, DotyposCustomer>;
  readonly endsBefore: Temporal.Instant;
  readonly startsAt: Temporal.Instant;
}) {
  const newCustomers: [DotyposCustomerId, Temporal.Instant][] = [];
  for (const customerId of input.candidateIds) {
    const created = input.customersById.get(customerId)?.created;
    const createdAt = Option.getOrUndefined(
      decodeInstantString(created).pipe(
        Option.map((value) => Temporal.Instant.from(value))
      )
    );
    if (!createdAt) return { ids: [], unavailable: true, value: 0 } as const;
    if (
      Temporal.Instant.compare(createdAt, input.startsAt) >= 0 &&
      Temporal.Instant.compare(createdAt, input.endsBefore) < 0
    ) {
      newCustomers.push([customerId, createdAt]);
    }
  }
  const ids = newCustomers
    .toSorted(
      ([leftId, left], [rightId, right]) =>
        Temporal.Instant.compare(right, left) || leftId.localeCompare(rightId)
    )
    .map(([customerId]) => customerId);
  return { ids, unavailable: false, value: ids.length } as const;
}
