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
  .middleware(CliBearerAuthentication)
  .prefix("/api/v1/cli");

export const WorkspaceAdminApi = HttpApi.make("workspaceAdminApi")
  .add(AdminCliApi)
  .add(AdminCliReadApi);
