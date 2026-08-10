import { Context, Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
} from "effect/unstable/httpapi";

export const WORKSPACE_ADMIN_API_VERSION = "v1" as const;

const base64UrlSecretSchema = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{43}$/)
);

const uuidSchema = Schema.String.check(
  Schema.isPattern(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  )
);

export const CliAuthenticationCode = base64UrlSecretSchema
  .pipe(Schema.brand("CliAuthenticationCode"))
  .annotate({ identifier: "CliAuthenticationCode" });
export type CliAuthenticationCode = typeof CliAuthenticationCode.Type;

export const CliAuthenticationVerifier = base64UrlSecretSchema
  .pipe(Schema.brand("CliAuthenticationVerifier"))
  .annotate({ identifier: "CliAuthenticationVerifier" });
export type CliAuthenticationVerifier = typeof CliAuthenticationVerifier.Type;

export const CliAuthenticationChallenge = base64UrlSecretSchema
  .pipe(Schema.brand("CliAuthenticationChallenge"))
  .annotate({ identifier: "CliAuthenticationChallenge" });
export type CliAuthenticationChallenge = typeof CliAuthenticationChallenge.Type;

export const CliGrantToken = base64UrlSecretSchema
  .pipe(Schema.brand("CliGrantToken"))
  .annotate({ identifier: "CliGrantToken" });
export type CliGrantToken = typeof CliGrantToken.Type;

export const CliAccessToken = base64UrlSecretSchema
  .pipe(Schema.brand("CliAccessToken"))
  .annotate({ identifier: "CliAccessToken" });
export type CliAccessToken = typeof CliAccessToken.Type;

export const CliSessionId = uuidSchema
  .pipe(Schema.brand("CliSessionId"))
  .annotate({ identifier: "CliSessionId" });
export type CliSessionId = typeof CliSessionId.Type;

export const CLI_BUILD_TARGETS = [
  "development",
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64-baseline",
] as const;

export const CliBuildTarget = Schema.Literals(CLI_BUILD_TARGETS);
export type CliBuildTarget = typeof CliBuildTarget.Type;

export const CliClientName = Schema.Trim.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(80)
);
export type CliClientName = typeof CliClientName.Type;

export const AdminCliInfo = Schema.Struct({
  apiVersion: Schema.Literal(WORKSPACE_ADMIN_API_VERSION),
  service: Schema.Literal("deskohub-workspace"),
});
export type AdminCliInfo = typeof AdminCliInfo.Type;

export const StartCliAuthentication = Schema.Struct({
  challenge: CliAuthenticationChallenge,
  clientName: CliClientName,
  cliVersion: Schema.String.check(Schema.isMinLength(1)).check(
    Schema.isMaxLength(32)
  ),
  buildTarget: CliBuildTarget,
});
export type StartCliAuthentication = typeof StartCliAuthentication.Type;

export const StartedCliAuthentication = Schema.Struct({
  code: CliAuthenticationCode,
  approvalPath: Schema.String,
  expiresAt: Schema.String,
}).pipe(HttpApiSchema.status("Created"));
export type StartedCliAuthentication = typeof StartedCliAuthentication.Type;

const PendingCliAuthentication = Schema.Struct({
  authStatus: Schema.Literal("pending"),
  expiresAt: Schema.String,
});

const ApprovedCliAuthentication = Schema.Struct({
  authStatus: Schema.Literal("approved"),
  grantToken: CliGrantToken,
  expiresAt: Schema.String,
});

const GrantedCliAuthentication = Schema.Struct({
  authStatus: Schema.Literal("granted"),
});

const ExpiredCliAuthentication = Schema.Struct({
  authStatus: Schema.Literal("expired"),
});

const RevokedCliAuthentication = Schema.Struct({
  authStatus: Schema.Literal("revoked"),
});

export const CliAuthenticationStatus = Schema.Union([
  PendingCliAuthentication,
  ApprovedCliAuthentication,
  GrantedCliAuthentication,
  ExpiredCliAuthentication,
  RevokedCliAuthentication,
]);
export type CliAuthenticationStatus = typeof CliAuthenticationStatus.Type;

export const ExchangeCliGrant = Schema.Struct({
  code: CliAuthenticationCode,
  grantToken: CliGrantToken,
  verifier: CliAuthenticationVerifier,
});
export type ExchangeCliGrant = typeof ExchangeCliGrant.Type;

export const CliSession = Schema.Struct({
  id: CliSessionId,
  clientName: CliClientName,
  cliVersion: Schema.String,
  buildTarget: CliBuildTarget,
  createdAt: Schema.String,
  lastUsedAt: Schema.String,
});
export type CliSession = typeof CliSession.Type;

export class CurrentCliSession extends Context.Service<
  CurrentCliSession,
  CliSession
>()("@deskohub/workspace-admin-api/CurrentCliSession") {}

export const GrantedCliSession = Schema.Struct({
  accessToken: CliAccessToken,
  session: CliSession,
}).pipe(HttpApiSchema.status("Created"));
export type GrantedCliSession = typeof GrantedCliSession.Type;

export class CliGrantRejected extends Schema.TaggedErrorClass<CliGrantRejected>()(
  "CliGrantRejected",
  { message: Schema.String }
) {
  static schema = this.pipe(HttpApiSchema.status("Unauthorized"));
}

export class CliAuthenticationRateLimited extends Schema.TaggedErrorClass<CliAuthenticationRateLimited>()(
  "CliAuthenticationRateLimited",
  { message: Schema.String }
) {
  static schema = this.pipe(HttpApiSchema.status("TooManyRequests"));
}

export class CliSessionUnauthorized extends Schema.TaggedErrorClass<CliSessionUnauthorized>()(
  "CliSessionUnauthorized",
  { message: Schema.String }
) {
  static schema = this.pipe(HttpApiSchema.status("Unauthorized"));
}

export class CliServiceUnavailable extends Schema.TaggedErrorClass<CliServiceUnavailable>()(
  "CliServiceUnavailable",
  { message: Schema.String }
) {
  static schema = this.pipe(HttpApiSchema.status("ServiceUnavailable"));
}

export class CliResourceNotFound extends Schema.TaggedErrorClass<CliResourceNotFound>()(
  "CliResourceNotFound",
  { message: Schema.String }
) {
  static schema = this.pipe(HttpApiSchema.status("NotFound"));
}

export class CliBearerAuthentication extends HttpApiMiddleware.Service<
  CliBearerAuthentication,
  { provides: CurrentCliSession }
>()("@deskohub/workspace-admin-api/CliBearerAuthentication", {
  error: [CliSessionUnauthorized.schema, CliServiceUnavailable.schema],
  security: { bearer: HttpApiSecurity.bearer },
}) {}

export const AdministrationOverviewMetric = Schema.Struct({
  unavailable: Schema.Boolean,
  value: Schema.Number,
});
export type AdministrationOverviewMetric =
  typeof AdministrationOverviewMetric.Type;

export const AdministrationOverview = Schema.Struct({
  today: AdministrationOverviewMetric,
  upcoming: AdministrationOverviewMetric,
  lastSevenDays: AdministrationOverviewMetric,
});
export type AdministrationOverview = typeof AdministrationOverview.Type;

export const AdministrationReservationSort = Schema.Literals([
  "created",
  "date",
  "reservation",
  "status",
]);
export type AdministrationReservationSort =
  typeof AdministrationReservationSort.Type;

export const AdministrationReservationSortDirection = Schema.Literals([
  "asc",
  "desc",
]);
export type AdministrationReservationSortDirection =
  typeof AdministrationReservationSortDirection.Type;

export const AdministrationReservationStatusGroup = Schema.Literals([
  "attention",
  "in_progress",
  "complete",
  "cancelled",
]);
export type AdministrationReservationStatusGroup =
  typeof AdministrationReservationStatusGroup.Type;

export const AdministrationReservationQuery = Schema.Struct({
  customerId: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
  date: Schema.optional(
    Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))
  ),
  direction: Schema.optional(AdministrationReservationSortDirection),
  page: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))
  ),
  sort: Schema.optional(AdministrationReservationSort),
  status: Schema.optional(
    Schema.Literals(["in_progress", "complete", "cancelled"])
  ),
  type: Schema.optional(Schema.Literals(["cowork", "meeting-room"])),
});
export type AdministrationReservationQuery =
  typeof AdministrationReservationQuery.Type;

export const AdministrationCustomer = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  email: Schema.NullOr(Schema.String),
  phone: Schema.NullOr(Schema.String),
});
export type AdministrationCustomer = typeof AdministrationCustomer.Type;

export const AdministrationMoney = Schema.Struct({
  value: Schema.Number,
  exponent: Schema.Number,
  currency: Schema.String,
});
export type AdministrationMoney = typeof AdministrationMoney.Type;

export const AdministrationPaymentAttempt = Schema.Struct({
  id: Schema.String,
  state: Schema.Literals([
    "created",
    "pending",
    "paid",
    "failed",
    "cancelled",
    "expired",
  ]),
  providerOrderId: Schema.NullOr(Schema.String),
  providerLabel: Schema.String,
  stateLabel: Schema.String,
  amount: AdministrationMoney,
  createdAt: Schema.String,
  providerOrderCreatedAt: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
});
export type AdministrationPaymentAttempt =
  typeof AdministrationPaymentAttempt.Type;

export const AdministrationReservationSummary = Schema.Struct({
  id: Schema.String,
  customerId: Schema.String,
  customer: Schema.NullOr(AdministrationCustomer),
  liveDetailsAvailable: Schema.Boolean,
  startsAt: Schema.NullOr(Schema.String),
  endsAt: Schema.NullOr(Schema.String),
  date: Schema.NullOr(Schema.String),
  type: Schema.Literals(["cowork", "meeting-room"]),
  typeLabel: Schema.String,
  status: Schema.Struct({
    group: AdministrationReservationStatusGroup,
    label: Schema.String,
  }),
  statusNote: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  latestPayment: Schema.NullOr(AdministrationPaymentAttempt),
  updatedAt: Schema.String,
});
export type AdministrationReservationSummary =
  typeof AdministrationReservationSummary.Type;

export const AdministrationReservationPage = Schema.Struct({
  items: Schema.Array(AdministrationReservationSummary),
  page: Schema.Number,
  pageCount: Schema.Number,
  total: Schema.Number,
  dateFilterUnavailable: Schema.Boolean,
  dateSortUnavailable: Schema.Boolean,
});
export type AdministrationReservationPage =
  typeof AdministrationReservationPage.Type;

export const AdministrationBookingSummary = Schema.Struct({
  id: Schema.String,
  customerId: Schema.NullOr(Schema.String),
  customer: Schema.NullOr(AdministrationCustomer),
  startsAt: Schema.String,
  endsAt: Schema.String,
  seats: Schema.String,
  status: Schema.Literals(["NEW", "CONFIRMED", "CANCELLED"]),
  statusLabel: Schema.String,
  tableId: Schema.NullOr(Schema.String),
  tableName: Schema.NullOr(Schema.String),
  tableLocation: Schema.NullOr(Schema.String),
  linkedReservation: Schema.NullOr(
    Schema.Struct({ id: Schema.String, label: Schema.String })
  ),
  createdAt: Schema.NullOr(Schema.String),
  updatedAt: Schema.NullOr(Schema.String),
});
export type AdministrationBookingSummary =
  typeof AdministrationBookingSummary.Type;

export const AdministrationBookingPage = Schema.Struct({
  items: Schema.Array(AdministrationBookingSummary),
  page: Schema.Number,
  pageCount: Schema.Number,
  total: Schema.Number,
});
export type AdministrationBookingPage = typeof AdministrationBookingPage.Type;

export const AdministrationBookingQuery = Schema.Struct({
  date: Schema.optional(
    Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))
  ),
  page: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))
  ),
});
export type AdministrationBookingQuery = typeof AdministrationBookingQuery.Type;

export const AdministrationBookingDetail = Schema.Struct({
  booking: AdministrationBookingSummary,
  references: Schema.Struct({
    bookingId: Schema.String,
    customerId: Schema.NullOr(Schema.String),
    workspaceReservationId: Schema.NullOr(Schema.String),
  }),
});
export type AdministrationBookingDetail =
  typeof AdministrationBookingDetail.Type;

export const AdministrationNexiOperation = Schema.Struct({
  orderId: Schema.optional(Schema.String),
  operationId: Schema.optional(Schema.String),
  channel: Schema.optional(Schema.String),
  operationType: Schema.optional(Schema.String),
  operationResult: Schema.optional(Schema.String),
  operationTime: Schema.optional(Schema.String),
  amount: Schema.optional(Schema.String),
  currency: Schema.optional(Schema.String),
  cancelledOperationId: Schema.optional(Schema.String),
});
export type AdministrationNexiOperation =
  typeof AdministrationNexiOperation.Type;

export const AdministrationNexiOrder = Schema.Struct({
  orderId: Schema.String,
  amount: Schema.optional(Schema.String),
  currency: Schema.optional(Schema.String),
  authorizedAmount: Schema.optional(Schema.String),
  capturedAmount: Schema.optional(Schema.String),
  lastOperationTime: Schema.optional(Schema.String),
  lastOperationType: Schema.optional(Schema.String),
  operations: Schema.Array(AdministrationNexiOperation),
});
export type AdministrationNexiOrder = typeof AdministrationNexiOrder.Type;

export const AdministrationOrderLink = Schema.Struct({
  paymentAttemptId: Schema.String,
  reservationId: Schema.String,
  state: Schema.Literals([
    "created",
    "pending",
    "paid",
    "failed",
    "cancelled",
    "expired",
  ]),
  stateLabel: Schema.String,
  amount: AdministrationMoney,
  attemptCreatedAt: Schema.String,
  providerOrderCreatedAt: Schema.NullOr(Schema.String),
  providerOrderCreatedAtEstimated: Schema.Boolean,
});
export type AdministrationOrderLink = typeof AdministrationOrderLink.Type;

export const AdministrationOrder = Schema.Struct({
  orderId: Schema.String,
  provider: Schema.NullOr(AdministrationNexiOrder),
  providerAvailable: Schema.Boolean,
  providerStatus: Schema.Literals([
    "available",
    "not_found",
    "not_returned",
    "unavailable",
  ]),
  link: Schema.NullOr(AdministrationOrderLink),
});
export type AdministrationOrder = typeof AdministrationOrder.Type;

export const AdministrationOrderList = Schema.Struct({
  items: Schema.Array(AdministrationOrder),
  providerAvailable: Schema.Boolean,
  truncated: Schema.Boolean,
});
export type AdministrationOrderList = typeof AdministrationOrderList.Type;

const administrationDateRangeQuery = {
  from: Schema.optional(
    Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))
  ),
  to: Schema.optional(
    Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))
  ),
};

export const AdministrationOrderQuery = Schema.Struct(
  administrationDateRangeQuery
);
export type AdministrationOrderQuery = typeof AdministrationOrderQuery.Type;

export const AdministrationOperation = Schema.Struct({
  ...AdministrationNexiOperation.fields,
  linkedReservationId: Schema.NullOr(Schema.String),
});
export type AdministrationOperation = typeof AdministrationOperation.Type;

export const AdministrationOperationList = Schema.Struct({
  items: Schema.Array(AdministrationOperation),
  providerAvailable: Schema.Boolean,
  truncated: Schema.Boolean,
});
export type AdministrationOperationList =
  typeof AdministrationOperationList.Type;

export const AdministrationOperationQuery = Schema.Struct({
  ...administrationDateRangeQuery,
  channel: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
  operationType: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
});
export type AdministrationOperationQuery =
  typeof AdministrationOperationQuery.Type;

export const AdministrationOperationDetail = Schema.Struct({
  operationId: Schema.String,
  operation: Schema.NullOr(AdministrationNexiOperation),
  providerAvailable: Schema.Boolean,
  providerStatus: Schema.Literals(["available", "not_found", "unavailable"]),
  linkedReservationId: Schema.NullOr(Schema.String),
});
export type AdministrationOperationDetail =
  typeof AdministrationOperationDetail.Type;

export const AdministrationReservationLifecycleStage = Schema.Literals([
  "started",
  "held",
  "paid",
  "complete",
  "hold_expired",
  "cancelling",
  "cancellation_failed",
  "cancelled",
]);
export type AdministrationReservationLifecycleStage =
  typeof AdministrationReservationLifecycleStage.Type;

export const AdministrationReservationLifecycle = Schema.Struct({
  currentStage: AdministrationReservationLifecycleStage,
  label: Schema.String,
  reachedStages: Schema.Array(AdministrationReservationLifecycleStage),
  tone: Schema.Literals(["attention", "neutral", "positive"]),
});
export type AdministrationReservationLifecycle =
  typeof AdministrationReservationLifecycle.Type;

export const AdministrationTimelineItem = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  occurredAt: Schema.String,
  tone: Schema.Literals(["neutral", "positive", "warning"]),
  href: Schema.optional(Schema.String),
});
export type AdministrationTimelineItem = typeof AdministrationTimelineItem.Type;

export const AdministrationDiscountApplication = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  amount: AdministrationMoney,
});
export type AdministrationDiscountApplication =
  typeof AdministrationDiscountApplication.Type;

export const AdministrationReservationDetail = Schema.Struct({
  reservation: AdministrationReservationSummary,
  booking: Schema.NullOr(AdministrationBookingSummary),
  lifecycle: AdministrationReservationLifecycle,
  timeline: Schema.Array(AdministrationTimelineItem),
  paymentAttempts: Schema.Array(AdministrationPaymentAttempt),
  orders: Schema.Array(AdministrationOrder),
  discounts: Schema.Array(AdministrationDiscountApplication),
  otherCustomerReservations: Schema.Array(AdministrationReservationSummary),
  sameDateReservations: Schema.Array(AdministrationReservationSummary),
  references: Schema.Struct({
    workspaceReservationId: Schema.String,
    dotyposReservationId: Schema.NullOr(Schema.String),
    customerId: Schema.String,
  }),
});
export type AdministrationReservationDetail =
  typeof AdministrationReservationDetail.Type;

export const AdministrationCustomerSummary = Schema.Struct({
  customer: Schema.NullOr(AdministrationCustomer),
  customerId: Schema.String,
  reservationCount: Schema.Number,
  lastActivityAt: Schema.String,
});
export type AdministrationCustomerSummary =
  typeof AdministrationCustomerSummary.Type;

export const AdministrationCustomerPage = Schema.Struct({
  items: Schema.Array(AdministrationCustomerSummary),
  page: Schema.Number,
  pageCount: Schema.Number,
  total: Schema.Number,
});
export type AdministrationCustomerPage = typeof AdministrationCustomerPage.Type;

export const AdministrationCustomerQuery = Schema.Struct({
  page: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))
  ),
});
export type AdministrationCustomerQuery =
  typeof AdministrationCustomerQuery.Type;

export const AdministrationCustomerSearchQuery = Schema.Struct({
  query: Schema.Trim.check(
    Schema.isMinLength(2),
    Schema.isMaxLength(100),
    Schema.isPattern(/^[^|;]+$/)
  ),
});
export type AdministrationCustomerSearchQuery =
  typeof AdministrationCustomerSearchQuery.Type;

export const AdministrationExternalCustomer = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  email: Schema.NullOr(Schema.String),
  phone: Schema.NullOr(Schema.String),
  discountGroupId: Schema.NullOr(Schema.String),
});
export type AdministrationExternalCustomer =
  typeof AdministrationExternalCustomer.Type;

export const AdministrationCustomerSearchResult = Schema.Struct({
  kind: Schema.Literals(["matched", "not-found", "ambiguous"]),
  customers: Schema.Array(AdministrationExternalCustomer),
});
export type AdministrationCustomerSearchResult =
  typeof AdministrationCustomerSearchResult.Type;

export const AdministrationCustomerTransaction = Schema.Struct({
  attempt: AdministrationPaymentAttempt,
  reservation: Schema.Struct({
    id: Schema.String,
    typeLabel: Schema.String,
  }),
});
export type AdministrationCustomerTransaction =
  typeof AdministrationCustomerTransaction.Type;

export const AdministrationCustomerMarketingConsent = Schema.Struct({
  documentHash: Schema.String,
  locale: Schema.String,
  grantedAt: Schema.String,
  withdrawnAt: Schema.NullOr(Schema.String),
});
export type AdministrationCustomerMarketingConsent =
  typeof AdministrationCustomerMarketingConsent.Type;

export const AdministrationCustomerActivity = Schema.Struct({
  reservations: Schema.Array(AdministrationReservationSummary),
  reservationHistoryTruncated: Schema.Boolean,
  transactions: Schema.Array(AdministrationCustomerTransaction),
  transactionHistoryTruncated: Schema.Boolean,
  stats: Schema.Struct({
    reservationCount: Schema.Number,
    favoriteProduct: Schema.NullOr(Schema.String),
    revenue: Schema.Array(AdministrationMoney),
    discountSavings: Schema.Array(AdministrationMoney),
  }),
  marketingConsent: Schema.NullOr(AdministrationCustomerMarketingConsent),
});
export type AdministrationCustomerActivity =
  typeof AdministrationCustomerActivity.Type;

export const AdministrationDiscountGroup = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  basisPoints: Schema.Number,
});
export type AdministrationDiscountGroup =
  typeof AdministrationDiscountGroup.Type;

export const AdministrationDiscountCode = Schema.Struct({
  id: Schema.String,
  discountId: Schema.String,
  code: Schema.String,
  enabled: Schema.Boolean,
  validFrom: Schema.NullOr(Schema.String),
  validUntil: Schema.NullOr(Schema.String),
  maxUses: Schema.NullOr(Schema.Number),
  audienceSize: Schema.Number,
  reservedUses: Schema.Number,
  redeemedUses: Schema.Number,
  releasedUses: Schema.Number,
  remainingUses: Schema.NullOr(Schema.Number),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type AdministrationDiscountCode = typeof AdministrationDiscountCode.Type;

export const AdministrationCustomerCode = Schema.Struct({
  ...AdministrationDiscountCode.fields,
  discountLabel: Schema.String,
  eligible: Schema.Boolean,
});
export type AdministrationCustomerCode = typeof AdministrationCustomerCode.Type;

export const AdministrationDiscountCodeClaim = Schema.Struct({
  id: Schema.String,
  codeId: Schema.String,
  dotyposCustomerId: Schema.String,
  state: Schema.Literals(["reserved", "redeemed", "released"]),
  paymentAttemptId: Schema.String,
  workspaceReservationId: Schema.String,
  reservationExpiresAt: Schema.String,
  reservedAt: Schema.String,
  redeemedAt: Schema.NullOr(Schema.String),
  releasedAt: Schema.NullOr(Schema.String),
  releaseReason: Schema.NullOr(Schema.String),
});
export type AdministrationDiscountCodeClaim =
  typeof AdministrationDiscountCodeClaim.Type;

export const AdministrationCustomerProfile = Schema.Struct({
  customer: AdministrationExternalCustomer,
  discountGroups: Schema.Array(AdministrationDiscountGroup),
  codes: Schema.Array(AdministrationCustomerCode),
  claims: Schema.Array(AdministrationDiscountCodeClaim),
});
export type AdministrationCustomerProfile =
  typeof AdministrationCustomerProfile.Type;

export const AdministrationCustomerDetail = Schema.Struct({
  profile: Schema.NullOr(AdministrationCustomerProfile),
  activity: AdministrationCustomerActivity,
});
export type AdministrationCustomerDetail =
  typeof AdministrationCustomerDetail.Type;

export const AdministrationCustomerReservationsQuery = Schema.Struct({
  page: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))
  ),
});
export type AdministrationCustomerReservationsQuery =
  typeof AdministrationCustomerReservationsQuery.Type;

export const AdministrationCustomerReservationPage = Schema.Struct({
  items: Schema.Array(AdministrationReservationSummary),
  page: Schema.Number,
  pageCount: Schema.Number,
  total: Schema.Number,
});
export type AdministrationCustomerReservationPage =
  typeof AdministrationCustomerReservationPage.Type;

export const AdminCliApi = HttpApiGroup.make("cli")
  .add(
    HttpApiEndpoint.get("getInfo", "/info", {
      success: AdminCliInfo,
    })
  )
  .add(
    HttpApiEndpoint.post("startAuthentication", "/auth", {
      payload: StartCliAuthentication,
      success: StartedCliAuthentication,
      error: [
        CliAuthenticationRateLimited.schema,
        CliServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.get("getAuthenticationStatus", "/status", {
      query: { code: CliAuthenticationCode },
      success: CliAuthenticationStatus,
      error: CliServiceUnavailable.schema,
    })
  )
  .add(
    HttpApiEndpoint.post("exchangeGrant", "/grant", {
      payload: ExchangeCliGrant,
      success: GrantedCliSession,
      error: [CliGrantRejected.schema, CliServiceUnavailable.schema],
    })
  )
  .add(
    HttpApiEndpoint.get("getCurrentSession", "/session", {
      success: CliSession,
    }).middleware(CliBearerAuthentication)
  )
  .prefix("/api/v1/cli");

export const AdminCliReadApi = HttpApiGroup.make("administration")
  .add(
    HttpApiEndpoint.get("getOverview", "/overview", {
      success: AdministrationOverview,
    })
  )
  .add(
    HttpApiEndpoint.get("listReservations", "/reservations", {
      query: AdministrationReservationQuery,
      success: AdministrationReservationPage,
    })
  )
  .add(
    HttpApiEndpoint.get("getReservation", "/reservations/:reservationId", {
      params: { reservationId: Schema.String },
      success: AdministrationReservationDetail,
      error: CliResourceNotFound.schema,
    })
  )
  .add(
    HttpApiEndpoint.get("listBookings", "/bookings", {
      query: AdministrationBookingQuery,
      success: AdministrationBookingPage,
    })
  )
  .add(
    HttpApiEndpoint.get("getBooking", "/bookings/:bookingId", {
      params: { bookingId: Schema.String },
      success: AdministrationBookingDetail,
      error: CliResourceNotFound.schema,
    })
  )
  .add(
    HttpApiEndpoint.get("listOrders", "/orders", {
      query: AdministrationOrderQuery,
      success: AdministrationOrderList,
    })
  )
  .add(
    HttpApiEndpoint.get("getOrder", "/orders/:orderId", {
      params: { orderId: Schema.String },
      success: AdministrationOrder,
    })
  )
  .add(
    HttpApiEndpoint.get("listOperations", "/operations", {
      query: AdministrationOperationQuery,
      success: AdministrationOperationList,
    })
  )
  .add(
    HttpApiEndpoint.get("getOperation", "/operations/:operationId", {
      params: { operationId: Schema.String },
      success: AdministrationOperationDetail,
    })
  )
  .add(
    HttpApiEndpoint.get("listCustomers", "/customers", {
      query: AdministrationCustomerQuery,
      success: AdministrationCustomerPage,
    })
  )
  .add(
    HttpApiEndpoint.get("searchCustomers", "/customers/search", {
      query: AdministrationCustomerSearchQuery,
      success: AdministrationCustomerSearchResult,
    })
  )
  .add(
    HttpApiEndpoint.get("getCustomer", "/customers/:customerId", {
      params: { customerId: Schema.String },
      success: AdministrationCustomerDetail,
    })
  )
  .add(
    HttpApiEndpoint.get(
      "listCustomerReservations",
      "/customers/:customerId/reservations",
      {
        params: { customerId: Schema.String },
        query: AdministrationCustomerReservationsQuery,
        success: AdministrationCustomerReservationPage,
      }
    )
  )
  .middleware(CliBearerAuthentication)
  .prefix("/api/v1/cli");

export const WorkspaceAdminApi = HttpApi.make("workspaceAdminApi")
  .add(AdminCliApi)
  .add(AdminCliReadApi);
