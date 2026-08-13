import { Temporal } from "@js-temporal/polyfill";
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

export const CliMutationRequestId = uuidSchema
  .pipe(Schema.brand("CliMutationRequestId"))
  .annotate({ identifier: "CliMutationRequestId" });
export type CliMutationRequestId = typeof CliMutationRequestId.Type;

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

export class CliMutationRejected extends Schema.TaggedErrorClass<CliMutationRejected>()(
  "CliMutationRejected",
  { message: Schema.String }
) {
  static schema = this.pipe(HttpApiSchema.status("Conflict"));
}

export class CliMutationInProgress extends Schema.TaggedErrorClass<CliMutationInProgress>()(
  "CliMutationInProgress",
  {
    message: Schema.String,
    requestId: CliMutationRequestId,
  }
) {
  static schema = this.pipe(HttpApiSchema.status("Conflict"));
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

export const AdministrationWorkspaceReservationId = Schema.NonEmptyString.pipe(
  Schema.brand("WorkspaceReservationId")
).annotate({
  identifier: "WorkspaceReservationId",
  description: "Opaque identifier for a persisted Workspace reservation.",
});
export type AdministrationWorkspaceReservationId =
  typeof AdministrationWorkspaceReservationId.Type;

export const AdministrationPaymentAttemptId = Schema.NonEmptyString.pipe(
  Schema.brand("PaymentAttemptId")
).annotate({
  identifier: "PaymentAttemptId",
  description: "Opaque identifier for a persisted payment attempt.",
});
export type AdministrationPaymentAttemptId =
  typeof AdministrationPaymentAttemptId.Type;

export const AdministrationNexiOrderId = Schema.NonEmptyString.pipe(
  Schema.brand("NexiOrderId")
).annotate({
  identifier: "NexiOrderId",
  description: "Opaque order identifier assigned by Nexi.",
});
export type AdministrationNexiOrderId = typeof AdministrationNexiOrderId.Type;

export const AdministrationNexiOperationId = Schema.NonEmptyString.pipe(
  Schema.brand("NexiOperationId")
).annotate({
  identifier: "NexiOperationId",
  description: "Opaque payment-operation identifier assigned by Nexi.",
});
export type AdministrationNexiOperationId =
  typeof AdministrationNexiOperationId.Type;

export const AdministrationDotyposCustomerId = Schema.NonEmptyString.pipe(
  Schema.brand("DotyposCustomerId")
).annotate({
  identifier: "DotyposCustomerId",
  description: "Opaque customer identifier assigned by Dotypos.",
});
export type AdministrationDotyposCustomerId =
  typeof AdministrationDotyposCustomerId.Type;

export const AdministrationDotyposReservationId = Schema.NonEmptyString.pipe(
  Schema.brand("DotyposReservationId")
).annotate({
  identifier: "DotyposReservationId",
  description: "Opaque reservation identifier assigned by Dotypos.",
});
export type AdministrationDotyposReservationId =
  typeof AdministrationDotyposReservationId.Type;

export const AdministrationDotyposTableId = Schema.NonEmptyString.pipe(
  Schema.brand("DotyposTableId")
).annotate({
  identifier: "DotyposTableId",
  description: "Opaque table identifier assigned by Dotypos.",
});
export type AdministrationDotyposTableId =
  typeof AdministrationDotyposTableId.Type;

export const AdministrationDotyposDiscountGroupId = Schema.NonEmptyString.pipe(
  Schema.brand("DotyposDiscountGroupId")
).annotate({
  identifier: "DotyposDiscountGroupId",
  description: "Opaque discount-group identifier assigned by Dotypos.",
});
export type AdministrationDotyposDiscountGroupId =
  typeof AdministrationDotyposDiscountGroupId.Type;

export const AdministrationDiscountApplicationId = Schema.NonEmptyString.pipe(
  Schema.brand("DiscountApplicationId")
).annotate({
  identifier: "DiscountApplicationId",
  description: "Opaque identifier for an immutable discount application.",
});
export type AdministrationDiscountApplicationId =
  typeof AdministrationDiscountApplicationId.Type;

export const AdministrationDiscountCodeClaimId = Schema.NonEmptyString.pipe(
  Schema.brand("DiscountCodeClaimId")
).annotate({
  identifier: "DiscountCodeClaimId",
  description: "Opaque identifier for a discount-code claim lifecycle.",
});
export type AdministrationDiscountCodeClaimId =
  typeof AdministrationDiscountCodeClaimId.Type;

export const AdministrationStoredDiscountId = uuidSchema
  .pipe(Schema.brand("DiscountId"))
  .pipe(Schema.brand("StoredDiscountId"))
  .annotate({ identifier: "StoredDiscountId" });
export type AdministrationStoredDiscountId =
  typeof AdministrationStoredDiscountId.Type;

export const AdministrationDiscountCodeId = Schema.NonEmptyString.pipe(
  Schema.brand("DiscountCodeId")
).annotate({ identifier: "DiscountCodeId" });
export type AdministrationDiscountCodeId =
  typeof AdministrationDiscountCodeId.Type;

export const AdministrationGoogleCalendarEventId = Schema.NonEmptyString.pipe(
  Schema.brand("GoogleCalendarEventId")
).annotate({
  identifier: "GoogleCalendarEventId",
  description: "Opaque event identifier assigned by Google Calendar.",
});
export type AdministrationGoogleCalendarEventId =
  typeof AdministrationGoogleCalendarEventId.Type;

export const AdministrationGoogleCalendarICalUid = Schema.NonEmptyString.pipe(
  Schema.brand("GoogleCalendarICalUid")
).annotate({
  identifier: "GoogleCalendarICalUid",
  description: "iCalendar UID assigned to a Google Calendar event.",
});
export type AdministrationGoogleCalendarICalUid =
  typeof AdministrationGoogleCalendarICalUid.Type;

const isCalendarDate = (value: string) => {
  try {
    return Temporal.PlainDate.from(value).toString() === value;
  } catch {
    return false;
  }
};

const administrationCalendarDate = Schema.String.check(
  Schema.makeFilter(isCalendarDate, {
    description: "A calendar date in YYYY-MM-DD format.",
  })
).annotate({ format: "date" });

export const AdministrationReservationQuery = Schema.Struct({
  customerId: Schema.optional(AdministrationDotyposCustomerId),
  date: Schema.optional(administrationCalendarDate),
  direction: Schema.optional(AdministrationReservationSortDirection),
  page: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))
  ),
  sort: Schema.optional(AdministrationReservationSort),
  status: Schema.optional(
    Schema.Literals(["in_progress", "complete", "cancelled"])
  ),
  type: Schema.optional(Schema.Literals(["cowork", "meeting-room", "office"])),
});
export type AdministrationReservationQuery =
  typeof AdministrationReservationQuery.Type;

export const AdministrationReservationLookupQuery = Schema.Struct({
  identifier: Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(200)),
});
export type AdministrationReservationLookupQuery =
  typeof AdministrationReservationLookupQuery.Type;

export const AdministrationReservationLookupResult = Schema.Struct({
  reservationId: Schema.NullOr(AdministrationWorkspaceReservationId),
});
export type AdministrationReservationLookupResult =
  typeof AdministrationReservationLookupResult.Type;

export const AdministrationCustomer = Schema.Struct({
  id: AdministrationDotyposCustomerId,
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
  id: AdministrationPaymentAttemptId,
  state: Schema.Literals([
    "created",
    "pending",
    "paid",
    "failed",
    "cancelled",
    "expired",
  ]),
  providerOrderId: Schema.NullOr(AdministrationNexiOrderId),
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
  id: AdministrationWorkspaceReservationId,
  customerId: AdministrationDotyposCustomerId,
  customer: Schema.NullOr(AdministrationCustomer),
  liveDetailsAvailable: Schema.Boolean,
  startsAt: Schema.NullOr(Schema.String),
  endsAt: Schema.NullOr(Schema.String),
  date: Schema.NullOr(Schema.String),
  type: Schema.Literals(["cowork", "meeting-room", "office"]),
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
  id: AdministrationDotyposReservationId,
  customerId: Schema.NullOr(AdministrationDotyposCustomerId),
  customer: Schema.NullOr(AdministrationCustomer),
  startsAt: Schema.String,
  endsAt: Schema.String,
  seats: Schema.String,
  status: Schema.Literals(["NEW", "CONFIRMED", "CANCELLED"]),
  statusLabel: Schema.String,
  tableId: Schema.NullOr(AdministrationDotyposTableId),
  tableName: Schema.NullOr(Schema.String),
  tableLocation: Schema.NullOr(Schema.String),
  linkedReservation: Schema.NullOr(
    Schema.Struct({
      id: AdministrationWorkspaceReservationId,
      label: Schema.String,
    })
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
  date: Schema.optional(administrationCalendarDate),
  page: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))
  ),
});
export type AdministrationBookingQuery = typeof AdministrationBookingQuery.Type;

export const AdministrationBookingDetail = Schema.Struct({
  booking: AdministrationBookingSummary,
  references: Schema.Struct({
    bookingId: AdministrationDotyposReservationId,
    customerId: Schema.NullOr(AdministrationDotyposCustomerId),
    workspaceReservationId: Schema.NullOr(AdministrationWorkspaceReservationId),
  }),
});
export type AdministrationBookingDetail =
  typeof AdministrationBookingDetail.Type;

export const AdministrationNexiOperation = Schema.Struct({
  orderId: Schema.optional(AdministrationNexiOrderId),
  operationId: Schema.optional(AdministrationNexiOperationId),
  channel: Schema.optional(Schema.String),
  operationType: Schema.optional(Schema.String),
  operationResult: Schema.optional(Schema.String),
  operationTime: Schema.optional(Schema.String),
  amount: Schema.optional(Schema.String),
  currency: Schema.optional(Schema.String),
  cancelledOperationId: Schema.optional(AdministrationNexiOperationId),
});
export type AdministrationNexiOperation =
  typeof AdministrationNexiOperation.Type;

export const AdministrationNexiOrder = Schema.Struct({
  orderId: AdministrationNexiOrderId,
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
  paymentAttemptId: AdministrationPaymentAttemptId,
  reservationId: AdministrationWorkspaceReservationId,
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
  orderId: AdministrationNexiOrderId,
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
  from: Schema.optional(administrationCalendarDate),
  to: Schema.optional(administrationCalendarDate),
};

export const AdministrationOrderQuery = Schema.Struct(
  administrationDateRangeQuery
);
export type AdministrationOrderQuery = typeof AdministrationOrderQuery.Type;

export const AdministrationOperation = Schema.Struct({
  ...AdministrationNexiOperation.fields,
  linkedReservationId: Schema.NullOr(AdministrationWorkspaceReservationId),
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
  operationId: AdministrationNexiOperationId,
  operation: Schema.NullOr(AdministrationNexiOperation),
  providerAvailable: Schema.Boolean,
  providerStatus: Schema.Literals(["available", "not_found", "unavailable"]),
  linkedReservationId: Schema.NullOr(AdministrationWorkspaceReservationId),
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
  id: AdministrationDiscountApplicationId,
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
    workspaceReservationId: AdministrationWorkspaceReservationId,
    dotyposReservationId: Schema.NullOr(AdministrationDotyposReservationId),
    customerId: AdministrationDotyposCustomerId,
  }),
  canCancel: Schema.Boolean,
});
export type AdministrationReservationDetail =
  typeof AdministrationReservationDetail.Type;

export const AdministrationReservationCancellationInput = Schema.Struct({
  sendCancellationEmail: Schema.Boolean,
}).annotate({
  parseOptions: { errors: "all", onExcessProperty: "error" },
});
export type AdministrationReservationCancellationInput =
  typeof AdministrationReservationCancellationInput.Type;

export const AdministrationReservationCancellationResult = Schema.Struct({
  outcome: Schema.Literals(["cancelled", "already_cancelled"]),
  email: Schema.Literals(["not_requested", "sent", "failed"]),
});
export type AdministrationReservationCancellationResult =
  typeof AdministrationReservationCancellationResult.Type;

export const AdministrationCustomerSummary = Schema.Struct({
  customer: Schema.NullOr(AdministrationCustomer),
  customerId: AdministrationDotyposCustomerId,
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
  id: AdministrationDotyposCustomerId,
  displayName: Schema.String,
  email: Schema.NullOr(Schema.String),
  phone: Schema.NullOr(Schema.String),
  discountGroupId: Schema.NullOr(AdministrationDotyposDiscountGroupId),
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
    id: AdministrationWorkspaceReservationId,
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
  id: AdministrationDotyposDiscountGroupId,
  name: Schema.String,
  basisPoints: Schema.Number,
});
export type AdministrationDiscountGroup =
  typeof AdministrationDiscountGroup.Type;

export const AdministrationDiscountCode = Schema.Struct({
  id: AdministrationDiscountCodeId,
  discountId: AdministrationStoredDiscountId,
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
  id: AdministrationDiscountCodeClaimId,
  codeId: AdministrationDiscountCodeId,
  dotyposCustomerId: AdministrationDotyposCustomerId,
  state: Schema.Literals(["reserved", "redeemed", "released"]),
  paymentAttemptId: AdministrationPaymentAttemptId,
  workspaceReservationId: AdministrationWorkspaceReservationId,
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

export const AdministrationWorkspaceProductTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("cowork") }),
  Schema.Struct({ kind: Schema.Literal("meeting-room") }),
  Schema.Struct({ kind: Schema.Literal("office") }),
]);
export type AdministrationWorkspaceProductTarget =
  typeof AdministrationWorkspaceProductTarget.Type;

export const AdministrationDiscountAdjustment = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("percentage"),
    basisPoints: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literal("fixed"),
    amount: AdministrationMoney,
  }),
]);
export type AdministrationDiscountAdjustment =
  typeof AdministrationDiscountAdjustment.Type;

export const AdministrationCanonicalDiscountCode = Schema.String.check(
  Schema.isPattern(/^[A-Z0-9][A-Z0-9_-]{2,63}$/)
)
  .pipe(Schema.brand("CanonicalDiscountCode"))
  .annotate({ identifier: "CanonicalDiscountCode" });
export type AdministrationCanonicalDiscountCode =
  typeof AdministrationCanonicalDiscountCode.Type;

const administrationDiscountLabel = Schema.Trim.check(Schema.isNonEmpty());

export const AdministrationDiscountLabels = Schema.Struct({
  "cs-CZ": administrationDiscountLabel,
  "en-US": administrationDiscountLabel,
});
export type AdministrationDiscountLabels =
  typeof AdministrationDiscountLabels.Type;

const administrationDiscountAdjustmentInput =
  AdministrationDiscountAdjustment.check(
    Schema.makeFilter((adjustment) => {
      if (adjustment.kind === "percentage") {
        return (
          Number.isInteger(adjustment.basisPoints) &&
          adjustment.basisPoints >= 1 &&
          adjustment.basisPoints <= 10_000
        );
      }
      return (
        Number.isInteger(adjustment.amount.value) &&
        adjustment.amount.value > 0 &&
        adjustment.amount.exponent === 2 &&
        (adjustment.amount.currency === "CZK" ||
          adjustment.amount.currency === "EUR")
      );
    })
  );

const administrationDiscountProducts = Schema.NonEmptyArray(
  AdministrationWorkspaceProductTarget
).check(
  Schema.makeFilter(
    (products) =>
      new Set(products.map(({ kind }) => kind)).size === products.length
  )
);

export const AdministrationDiscountDefinitionInput = Schema.Struct({
  labels: AdministrationDiscountLabels,
  adjustment: administrationDiscountAdjustmentInput,
  products: administrationDiscountProducts,
});
export type AdministrationDiscountDefinitionInput =
  typeof AdministrationDiscountDefinitionInput.Type;

export const AdministrationDiscountUpdateInput = Schema.Struct({
  id: AdministrationStoredDiscountId,
  ...AdministrationDiscountDefinitionInput.fields,
});
export type AdministrationDiscountUpdateInput =
  typeof AdministrationDiscountUpdateInput.Type;

export const AdministrationInstant = Schema.String.check(
  Schema.makeFilter((value) => {
    try {
      Temporal.Instant.from(value);
      return true;
    } catch {
      return false;
    }
  })
)
  .pipe(Schema.brand("Instant"))
  .annotate({ identifier: "Instant" });
export type AdministrationInstant = typeof AdministrationInstant.Type;

const administrationDiscountCodeWindow = Schema.makeFilter<{
  readonly validFrom: string | null;
  readonly validUntil: string | null;
}>(
  ({ validFrom, validUntil }) =>
    validFrom === null ||
    validUntil === null ||
    Temporal.Instant.compare(
      Temporal.Instant.from(validUntil),
      Temporal.Instant.from(validFrom)
    ) > 0
);

export const AdministrationDiscountCodeConfigurationInput = Schema.Struct({
  code: AdministrationCanonicalDiscountCode,
  enabled: Schema.Boolean,
  validFrom: Schema.NullOr(AdministrationInstant),
  validUntil: Schema.NullOr(AdministrationInstant),
  maxUses: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
}).check(administrationDiscountCodeWindow);
export type AdministrationDiscountCodeConfigurationInput =
  typeof AdministrationDiscountCodeConfigurationInput.Type;

export const AdministrationExistingDiscountCodeCreateInput = Schema.Struct({
  discountId: AdministrationStoredDiscountId,
  ...AdministrationDiscountCodeConfigurationInput.fields,
}).check(administrationDiscountCodeWindow);
export type AdministrationExistingDiscountCodeCreateInput =
  typeof AdministrationExistingDiscountCodeCreateInput.Type;

const AdministrationDiscountSelection = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("existing"),
    discountId: AdministrationStoredDiscountId,
  }),
  Schema.Struct({
    kind: Schema.Literal("new"),
    discount: AdministrationDiscountDefinitionInput,
  }),
]);

export const AdministrationDiscountCodeCreateInput = Schema.Struct({
  code: AdministrationDiscountCodeConfigurationInput,
  discount: AdministrationDiscountSelection,
});
export type AdministrationDiscountCodeCreateInput =
  typeof AdministrationDiscountCodeCreateInput.Type;

export const AdministrationCustomerDiscountCodeCreateInput = Schema.Struct({
  customerId: AdministrationDotyposCustomerId,
  ...AdministrationDiscountCodeCreateInput.fields,
});
export type AdministrationCustomerDiscountCodeCreateInput =
  typeof AdministrationCustomerDiscountCodeCreateInput.Type;

export const AdministrationDiscountCodeUpdateInput = Schema.Struct({
  id: AdministrationDiscountCodeId,
  discountId: AdministrationStoredDiscountId,
  ...AdministrationDiscountCodeConfigurationInput.fields,
}).check(administrationDiscountCodeWindow);
export type AdministrationDiscountCodeUpdateInput =
  typeof AdministrationDiscountCodeUpdateInput.Type;

export const ADMINISTRATION_DISCOUNT_MUTATION_KINDS = [
  "create-discount",
  "update-discount",
  "delete-discount",
  "create-code",
  "create-customer-code",
  "update-code",
  "delete-code",
  "add-code-customer",
  "remove-code-customer",
  "make-code-unrestricted",
  "set-customer-discount-group",
] as const;

export const AdministrationDiscountMutation = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("create-discount"),
    discount: AdministrationDiscountDefinitionInput,
  }),
  Schema.Struct({
    kind: Schema.Literal("update-discount"),
    discount: AdministrationDiscountUpdateInput,
  }),
  Schema.Struct({
    kind: Schema.Literal("delete-discount"),
    id: AdministrationStoredDiscountId,
  }),
  Schema.Struct({
    kind: Schema.Literal("create-code"),
    ...AdministrationDiscountCodeCreateInput.fields,
  }),
  Schema.Struct({
    kind: Schema.Literal("create-customer-code"),
    ...AdministrationCustomerDiscountCodeCreateInput.fields,
  }),
  Schema.Struct({
    kind: Schema.Literal("update-code"),
    code: AdministrationDiscountCodeUpdateInput,
  }),
  Schema.Struct({
    kind: Schema.Literal("delete-code"),
    id: AdministrationDiscountCodeId,
  }),
  Schema.Struct({
    kind: Schema.Literal("add-code-customer"),
    codeId: AdministrationDiscountCodeId,
    customerId: AdministrationDotyposCustomerId,
  }),
  Schema.Struct({
    kind: Schema.Literal("remove-code-customer"),
    codeId: AdministrationDiscountCodeId,
    customerId: AdministrationDotyposCustomerId,
  }),
  Schema.Struct({
    kind: Schema.Literal("make-code-unrestricted"),
    codeId: AdministrationDiscountCodeId,
  }),
  Schema.Struct({
    kind: Schema.Literal("set-customer-discount-group"),
    customerId: AdministrationDotyposCustomerId,
    discountGroupId: Schema.NullOr(AdministrationDotyposDiscountGroupId),
  }),
]).annotate({
  parseOptions: { errors: "all", onExcessProperty: "error" },
});
export type AdministrationDiscountMutation =
  typeof AdministrationDiscountMutation.Type;

export const AdministrationDiscountMutationResult = Schema.Struct({
  kind: Schema.Literals(ADMINISTRATION_DISCOUNT_MUTATION_KINDS),
  createdDiscountId: Schema.NullOr(AdministrationStoredDiscountId),
  createdCodeId: Schema.NullOr(AdministrationDiscountCodeId),
});
export type AdministrationDiscountMutationResult =
  typeof AdministrationDiscountMutationResult.Type;

export const AdministrationDiscount = Schema.Struct({
  id: AdministrationStoredDiscountId,
  labels: Schema.Struct({
    "en-US": Schema.String,
    "cs-CZ": Schema.String,
  }),
  adjustment: AdministrationDiscountAdjustment,
  products: Schema.Array(AdministrationWorkspaceProductTarget),
  codeCount: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type AdministrationDiscount = typeof AdministrationDiscount.Type;

export const AdministrationCalendarSale = Schema.Struct({
  eventReference: Schema.optional(
    Schema.Union([
      AdministrationGoogleCalendarEventId,
      AdministrationGoogleCalendarICalUid,
    ])
  ),
  title: Schema.String,
  description: Schema.String,
  start: Schema.String,
  end: Schema.String,
  status: Schema.String,
  eventUrl: Schema.String,
  association: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("associated"),
      discountId: AdministrationStoredDiscountId,
      discountLabel: Schema.String,
    }),
    Schema.Struct({ kind: Schema.Literal("missing-description") }),
    Schema.Struct({ kind: Schema.Literal("invalid-description") }),
    Schema.Struct({
      kind: Schema.Literal("missing-discount"),
      discountId: AdministrationStoredDiscountId,
    }),
  ]),
});
export type AdministrationCalendarSale = typeof AdministrationCalendarSale.Type;

export const AdministrationDiscountDashboard = Schema.Struct({
  discounts: Schema.Array(AdministrationDiscount),
  codes: Schema.Array(AdministrationDiscountCode),
  calendar: Schema.Struct({
    events: Schema.Array(AdministrationCalendarSale),
    unavailable: Schema.Boolean,
    calendarUrl: Schema.String,
    from: Schema.String,
    to: Schema.String,
  }),
});
export type AdministrationDiscountDashboard =
  typeof AdministrationDiscountDashboard.Type;

export const AdministrationDiscountCodeDetail = Schema.Struct({
  code: AdministrationDiscountCode,
  discountLabel: Schema.String,
  customers: Schema.Array(
    Schema.Struct({
      customerId: AdministrationDotyposCustomerId,
      customer: Schema.NullOr(AdministrationExternalCustomer),
    })
  ),
  claims: Schema.Array(AdministrationDiscountCodeClaim),
});
export type AdministrationDiscountCodeDetail =
  typeof AdministrationDiscountCodeDetail.Type;

export const CliSessionAdministration = Schema.Struct({
  ...CliSession.fields,
  revokedAt: Schema.NullOr(Schema.String),
});
export type CliSessionAdministration = typeof CliSessionAdministration.Type;

export const RenameCliSession = Schema.Struct({ clientName: CliClientName });
export type RenameCliSession = typeof RenameCliSession.Type;

export const CliSessionMutationResult = Schema.Struct({
  changed: Schema.Boolean,
});
export type CliSessionMutationResult = typeof CliSessionMutationResult.Type;

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

export const AdminCliAdministrationApi = HttpApiGroup.make("administration")
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
      params: { reservationId: AdministrationWorkspaceReservationId },
      success: AdministrationReservationDetail,
      error: CliResourceNotFound.schema,
    })
  )
  .add(
    HttpApiEndpoint.post(
      "cancelReservation",
      "/reservations/:reservationId/cancellation",
      {
        params: { reservationId: AdministrationWorkspaceReservationId },
        payload: AdministrationReservationCancellationInput,
        success: AdministrationReservationCancellationResult,
        error: [
          CliMutationRejected.schema,
          CliResourceNotFound.schema,
          CliServiceUnavailable.schema,
        ],
      }
    )
  )
  .add(
    HttpApiEndpoint.get("findReservation", "/reservations/find", {
      query: AdministrationReservationLookupQuery,
      success: AdministrationReservationLookupResult,
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
      params: { bookingId: AdministrationDotyposReservationId },
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
      params: { orderId: AdministrationNexiOrderId },
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
      params: { operationId: AdministrationNexiOperationId },
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
      params: { customerId: AdministrationDotyposCustomerId },
      success: AdministrationCustomerDetail,
    })
  )
  .add(
    HttpApiEndpoint.get(
      "listCustomerReservations",
      "/customers/:customerId/reservations",
      {
        params: { customerId: AdministrationDotyposCustomerId },
        query: AdministrationCustomerReservationsQuery,
        success: AdministrationCustomerReservationPage,
      }
    )
  )
  .add(
    HttpApiEndpoint.get("getDiscountDashboard", "/discounts", {
      success: AdministrationDiscountDashboard,
    })
  )
  .add(
    HttpApiEndpoint.get("getDiscountCode", "/codes/:codeId", {
      params: { codeId: AdministrationDiscountCodeId },
      success: AdministrationDiscountCodeDetail,
      error: CliResourceNotFound.schema,
    })
  )
  .add(
    HttpApiEndpoint.get("listSessions", "/sessions", {
      success: Schema.Array(CliSessionAdministration),
    })
  )
  .add(
    HttpApiEndpoint.post("mutateDiscounts", "/discounts/mutations", {
      payload: Schema.Struct({
        requestId: CliMutationRequestId,
        mutation: AdministrationDiscountMutation,
      }).annotate({
        parseOptions: { errors: "all", onExcessProperty: "error" },
      }),
      success: AdministrationDiscountMutationResult,
      error: [
        CliMutationInProgress.schema,
        CliMutationRejected.schema,
        CliResourceNotFound.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.patch("renameSession", "/sessions/:sessionId", {
      params: { sessionId: CliSessionId },
      payload: RenameCliSession,
      success: CliSessionMutationResult,
      error: CliResourceNotFound.schema,
    })
  )
  .add(
    HttpApiEndpoint.delete("revokeSession", "/sessions/:sessionId", {
      params: { sessionId: CliSessionId },
      success: CliSessionMutationResult,
    })
  )
  .middleware(CliBearerAuthentication)
  .prefix("/api/v1/cli");

export const WorkspaceAdminApi = HttpApi.make("workspaceAdminApi")
  .add(AdminCliApi)
  .add(AdminCliAdministrationApi);
