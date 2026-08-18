import {
  type AdminCliInfoType,
  type AdministrationBookingDetailType,
  type AdministrationBookingPageType,
  type AdministrationBookingQueryType,
  type AdministrationCustomerDetailType,
  type AdministrationCustomerPageType,
  type AdministrationCustomerQueryType,
  type AdministrationCustomerReservationPageType,
  type AdministrationCustomerReservationsQueryType,
  type AdministrationCustomerSearchQueryType,
  type AdministrationCustomerSearchResultType,
  type AdministrationDiscountCodeDetailType,
  type AdministrationDiscountCodeIdType,
  type AdministrationDiscountDashboardType,
  type AdministrationDiscountMutationResultType,
  type AdministrationDiscountMutationType,
  type AdministrationDotyposCustomerIdType,
  type AdministrationDotyposReservationIdType,
  type AdministrationInvoiceCreateInputType,
  type AdministrationInvoiceCreateResultType,
  type AdministrationInvoiceDetailType,
  type AdministrationInvoiceIdType,
  type AdministrationInvoicePageType,
  type AdministrationInvoiceQueryType,
  type AdministrationInvoiceRetryResultType,
  type AdministrationNexiOperationIdType,
  type AdministrationNexiOrderIdType,
  type AdministrationOperationDetailType,
  type AdministrationOperationListType,
  type AdministrationOperationQueryType,
  type AdministrationOrderListType,
  type AdministrationOrderQueryType,
  type AdministrationOrderType,
  type AdministrationOverviewType,
  type AdministrationReservationAccessGrantType,
  type AdministrationReservationAccessMutationType,
  type AdministrationReservationCancellationInputType,
  type AdministrationReservationCancellationResultType,
  type AdministrationReservationDetailType,
  type AdministrationReservationLookupResultType,
  type AdministrationReservationPageType,
  type AdministrationReservationQueryType,
  type AdministrationVoucherDetailType,
  type AdministrationVoucherIdType,
  type AdministrationWorkspaceReservationIdType,
  type CliAccessTokenType,
  type CliAuthenticationCodeType,
  CliAuthenticationRateLimited,
  type CliAuthenticationStatusType,
  CliGrantRejected,
  CliMutationInProgress,
  CliMutationRejected,
  type CliMutationRequestIdType,
  CliResourceNotFound,
  CliServiceUnavailable,
  type CliSessionAdministrationType,
  type CliSessionIdType,
  type CliSessionMutationResultType,
  type CliSessionType,
  CliSessionUnauthorized,
  type ExchangeCliGrantType,
  type GrantedCliSessionType,
  type RenameCliSessionType,
  type StartCliAuthenticationType,
  type StartedCliAuthenticationType,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import {
  Context,
  Data,
  Effect,
  Layer,
  Redacted,
  Schedule,
  type Schema,
} from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
} from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { DhwConfig } from "../config/dhw-config.service";

interface IWorkspaceAdminApiClient {
  readonly getInfo: Effect.Effect<
    AdminCliInfoType,
    HttpClientError.HttpClientError | Schema.SchemaError
  >;
  readonly startAuthentication: (
    input: StartCliAuthenticationType
  ) => Effect.Effect<
    StartedCliAuthenticationType,
    CliApiRequestError | CliAuthenticationRateLimited | CliServiceUnavailable
  >;
  readonly getAuthenticationStatus: (
    code: CliAuthenticationCodeType
  ) => Effect.Effect<
    CliAuthenticationStatusType,
    CliApiRequestError | CliServiceUnavailable
  >;
  readonly exchangeGrant: (
    input: ExchangeCliGrantType
  ) => Effect.Effect<
    GrantedCliSessionType,
    CliApiRequestError | CliGrantRejected | CliServiceUnavailable
  >;
  readonly getCurrentSession: (
    accessToken: Redacted.Redacted<CliAccessTokenType>
  ) => Effect.Effect<
    CliSessionType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly getOverview: (
    accessToken: Redacted.Redacted<CliAccessTokenType>
  ) => Effect.Effect<
    AdministrationOverviewType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly listReservations: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    query: AdministrationReservationQueryType
  ) => Effect.Effect<
    AdministrationReservationPageType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly getReservation: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    reservationId: AdministrationWorkspaceReservationIdType
  ) => Effect.Effect<
    AdministrationReservationDetailType,
    | CliApiRequestError
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly cancelReservation: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    reservationId: AdministrationWorkspaceReservationIdType,
    input: AdministrationReservationCancellationInputType
  ) => Effect.Effect<
    AdministrationReservationCancellationResultType,
    | CliApiRequestError
    | CliMutationRejected
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly mutateReservationAccess: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    requestId: CliMutationRequestIdType,
    reservationId: AdministrationWorkspaceReservationIdType,
    mutation: AdministrationReservationAccessMutationType
  ) => Effect.Effect<
    AdministrationReservationAccessGrantType,
    | CliApiRequestError
    | CliMutationInProgress
    | CliMutationRejected
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly findReservation: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    identifier: string
  ) => Effect.Effect<
    AdministrationReservationLookupResultType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly listBookings: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    query: AdministrationBookingQueryType
  ) => Effect.Effect<
    AdministrationBookingPageType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly getBooking: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    bookingId: AdministrationDotyposReservationIdType
  ) => Effect.Effect<
    AdministrationBookingDetailType,
    | CliApiRequestError
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly listOrders: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    query: AdministrationOrderQueryType
  ) => Effect.Effect<
    AdministrationOrderListType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly getOrder: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    orderId: AdministrationNexiOrderIdType
  ) => Effect.Effect<
    AdministrationOrderType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly listOperations: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    query: AdministrationOperationQueryType
  ) => Effect.Effect<
    AdministrationOperationListType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly getOperation: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    operationId: AdministrationNexiOperationIdType
  ) => Effect.Effect<
    AdministrationOperationDetailType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly listCustomers: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    query: AdministrationCustomerQueryType
  ) => Effect.Effect<
    AdministrationCustomerPageType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly searchCustomers: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    query: AdministrationCustomerSearchQueryType
  ) => Effect.Effect<
    AdministrationCustomerSearchResultType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly getCustomer: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    customerId: AdministrationDotyposCustomerIdType
  ) => Effect.Effect<
    AdministrationCustomerDetailType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly listCustomerReservations: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    customerId: AdministrationDotyposCustomerIdType,
    query: AdministrationCustomerReservationsQueryType
  ) => Effect.Effect<
    AdministrationCustomerReservationPageType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly getDiscountDashboard: (
    accessToken: Redacted.Redacted<CliAccessTokenType>
  ) => Effect.Effect<
    AdministrationDiscountDashboardType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly getDiscountCode: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    codeId: AdministrationDiscountCodeIdType
  ) => Effect.Effect<
    AdministrationDiscountCodeDetailType,
    | CliApiRequestError
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly getVoucher: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    voucherId: AdministrationVoucherIdType
  ) => Effect.Effect<
    AdministrationVoucherDetailType,
    | CliApiRequestError
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly listInvoices: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    query: AdministrationInvoiceQueryType
  ) => Effect.Effect<
    AdministrationInvoicePageType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly getInvoice: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    invoiceId: AdministrationInvoiceIdType
  ) => Effect.Effect<
    AdministrationInvoiceDetailType,
    | CliApiRequestError
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly getInvoicePdf: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    invoiceId: AdministrationInvoiceIdType
  ) => Effect.Effect<
    Uint8Array,
    | CliApiRequestError
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly createInvoice: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    input: AdministrationInvoiceCreateInputType
  ) => Effect.Effect<
    AdministrationInvoiceCreateResultType,
    | CliApiRequestError
    | CliMutationInProgress
    | CliMutationRejected
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly resendInvoice: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    invoiceId: AdministrationInvoiceIdType
  ) => Effect.Effect<
    AdministrationInvoiceRetryResultType,
    | CliApiRequestError
    | CliMutationRejected
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly listSessions: (
    accessToken: Redacted.Redacted<CliAccessTokenType>
  ) => Effect.Effect<
    ReadonlyArray<CliSessionAdministrationType>,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly mutateDiscounts: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    requestId: CliMutationRequestIdType,
    input: AdministrationDiscountMutationType
  ) => Effect.Effect<
    AdministrationDiscountMutationResultType,
    | CliApiRequestError
    | CliMutationInProgress
    | CliMutationRejected
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly renameSession: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    sessionId: CliSessionIdType,
    input: RenameCliSessionType
  ) => Effect.Effect<
    CliSessionMutationResultType,
    | CliApiRequestError
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly revokeSession: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    sessionId: CliSessionIdType
  ) => Effect.Effect<
    CliSessionMutationResultType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
}

export class WorkspaceAdminApiClient extends Context.Service<
  WorkspaceAdminApiClient,
  IWorkspaceAdminApiClient
>()("WorkspaceAdminApiClient") {
  static Default = Layer.effect(
    this,
    Effect.suspend(() => makeWorkspaceAdminApiClient)
  );
}

const makeWorkspaceAdminApiClient = Effect.gen(function* () {
  const config = yield* DhwConfig;
  const httpClient = yield* HttpClient.HttpClient;
  const requestHeaders = Object.fromEntries(
    Object.entries(config.requestHeaders).map(([name, value]) => [
      name,
      Redacted.value(value),
    ])
  );
  const makeClient = (accessToken?: Redacted.Redacted<CliAccessTokenType>) =>
    HttpApiClient.make(WorkspaceAdminApi, {
      baseUrl: config.baseUrl,
      transformClient: HttpClient.mapRequest(
        HttpClientRequest.setHeaders({
          ...requestHeaders,
          ...(accessToken && {
            authorization: `Bearer ${Redacted.value(accessToken)}`,
          }),
        })
      ),
    }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient));
  const client = yield* makeClient();

  return {
    getInfo: Effect.fn("WorkspaceAdminApiClient.getInfo")(() =>
      client.cli.getInfo({})
    )(),
    startAuthentication: Effect.fn(
      "WorkspaceAdminApiClient.startAuthentication"
    )((input: StartCliAuthenticationType) =>
      client.cli
        .startAuthentication({ payload: input })
        .pipe(Effect.mapError(sanitizeStartError))
    ),
    getAuthenticationStatus: Effect.fn(
      "WorkspaceAdminApiClient.getAuthenticationStatus"
    )((code: CliAuthenticationCodeType) =>
      client.cli
        .getAuthenticationStatus({ query: { code } })
        .pipe(Effect.mapError(sanitizeRequestError))
    ),
    exchangeGrant: Effect.fn("WorkspaceAdminApiClient.exchangeGrant")(
      (input: ExchangeCliGrantType) =>
        client.cli
          .exchangeGrant({ payload: input })
          .pipe(Effect.mapError(sanitizeGrantError))
    ),
    getCurrentSession: Effect.fn("WorkspaceAdminApiClient.getCurrentSession")(
      (accessToken: Redacted.Redacted<CliAccessTokenType>) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) => authorized.cli.getCurrentSession({})),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    getOverview: Effect.fn("WorkspaceAdminApiClient.getOverview")(
      (accessToken: Redacted.Redacted<CliAccessTokenType>) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getOverview({})
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    listReservations: Effect.fn("WorkspaceAdminApiClient.listReservations")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        query: AdministrationReservationQueryType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.listReservations({ query })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    getReservation: Effect.fn("WorkspaceAdminApiClient.getReservation")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        reservationId: AdministrationWorkspaceReservationIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getReservation({
              params: { reservationId },
            })
          ),
          Effect.mapError(sanitizeResourceError)
        )
    ),
    mutateReservationAccess: Effect.fn(
      "WorkspaceAdminApiClient.mutateReservationAccess"
    )((accessToken, requestId, reservationId, mutation) =>
      makeClient(accessToken).pipe(
        Effect.flatMap((authorized) =>
          authorized.administration.mutateReservationAccess({
            params: { reservationId },
            payload: { requestId, mutation },
          })
        ),
        Effect.retry({
          schedule: Schedule.spaced("250 millis"),
          times: 20,
          while: (cause) =>
            cause instanceof CliMutationInProgress ||
            cause instanceof CliServiceUnavailable ||
            HttpClientError.isHttpClientError(cause),
        }),
        Effect.mapError(sanitizeMutationError)
      )
    ),
    findReservation: Effect.fn("WorkspaceAdminApiClient.findReservation")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        identifier: string
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.findReservation({
              query: { identifier },
            })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    listBookings: Effect.fn("WorkspaceAdminApiClient.listBookings")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        query: AdministrationBookingQueryType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.listBookings({ query })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    getBooking: Effect.fn("WorkspaceAdminApiClient.getBooking")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        bookingId: AdministrationDotyposReservationIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getBooking({ params: { bookingId } })
          ),
          Effect.mapError(sanitizeResourceError)
        )
    ),
    listOrders: Effect.fn("WorkspaceAdminApiClient.listOrders")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        query: AdministrationOrderQueryType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.listOrders({ query })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    getOrder: Effect.fn("WorkspaceAdminApiClient.getOrder")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        orderId: AdministrationNexiOrderIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getOrder({ params: { orderId } })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    listOperations: Effect.fn("WorkspaceAdminApiClient.listOperations")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        query: AdministrationOperationQueryType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.listOperations({ query })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    getOperation: Effect.fn("WorkspaceAdminApiClient.getOperation")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        operationId: AdministrationNexiOperationIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getOperation({
              params: { operationId },
            })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    listCustomers: Effect.fn("WorkspaceAdminApiClient.listCustomers")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        query: AdministrationCustomerQueryType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.listCustomers({ query })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    searchCustomers: Effect.fn("WorkspaceAdminApiClient.searchCustomers")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        query: AdministrationCustomerSearchQueryType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.searchCustomers({ query })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    getCustomer: Effect.fn("WorkspaceAdminApiClient.getCustomer")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        customerId: AdministrationDotyposCustomerIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getCustomer({ params: { customerId } })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    listCustomerReservations: Effect.fn(
      "WorkspaceAdminApiClient.listCustomerReservations"
    )(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        customerId: AdministrationDotyposCustomerIdType,
        query: AdministrationCustomerReservationsQueryType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.listCustomerReservations({
              params: { customerId },
              query,
            })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    getDiscountDashboard: Effect.fn(
      "WorkspaceAdminApiClient.getDiscountDashboard"
    )((accessToken: Redacted.Redacted<CliAccessTokenType>) =>
      makeClient(accessToken).pipe(
        Effect.flatMap((authorized) =>
          authorized.administration.getDiscountDashboard({})
        ),
        Effect.mapError(sanitizeSessionError)
      )
    ),
    cancelReservation: Effect.fn("WorkspaceAdminApiClient.cancelReservation")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        reservationId: AdministrationWorkspaceReservationIdType,
        input: AdministrationReservationCancellationInputType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.cancelReservation({
              params: { reservationId },
              payload: input,
            })
          ),
          Effect.mapError(sanitizeReservationMutationError)
        )
    ),
    getDiscountCode: Effect.fn("WorkspaceAdminApiClient.getDiscountCode")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        codeId: AdministrationDiscountCodeIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getDiscountCode({ params: { codeId } })
          ),
          Effect.mapError(sanitizeResourceError)
        )
    ),
    getVoucher: Effect.fn("WorkspaceAdminApiClient.getVoucher")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        voucherId: AdministrationVoucherIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getVoucher({ params: { voucherId } })
          ),
          Effect.mapError(sanitizeResourceError)
        )
    ),
    listInvoices: Effect.fn("WorkspaceAdminApiClient.listInvoices")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        query: AdministrationInvoiceQueryType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.listInvoices({ query })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    getInvoice: Effect.fn("WorkspaceAdminApiClient.getInvoice")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        invoiceId: AdministrationInvoiceIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getInvoice({ params: { invoiceId } })
          ),
          Effect.mapError(sanitizeResourceError)
        )
    ),
    getInvoicePdf: Effect.fn("WorkspaceAdminApiClient.getInvoicePdf")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        invoiceId: AdministrationInvoiceIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getInvoicePdf({
              params: { invoiceId },
            })
          ),
          Effect.mapError(sanitizeResourceError)
        )
    ),
    createInvoice: Effect.fn("WorkspaceAdminApiClient.createInvoice")(
      (accessToken, input: AdministrationInvoiceCreateInputType) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.createInvoice({ payload: input })
          ),
          Effect.retry({
            schedule: Schedule.spaced("250 millis"),
            times: 20,
            while: (cause) =>
              cause instanceof CliMutationInProgress ||
              cause instanceof CliServiceUnavailable ||
              HttpClientError.isHttpClientError(cause),
          }),
          Effect.mapError(sanitizeInvoiceCreationError)
        )
    ),
    resendInvoice: Effect.fn("WorkspaceAdminApiClient.resendInvoice")(
      (accessToken, invoiceId: AdministrationInvoiceIdType) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.resendInvoice({
              params: { invoiceId },
            })
          ),
          Effect.mapError(sanitizeReservationMutationError)
        )
    ),
    listSessions: Effect.fn("WorkspaceAdminApiClient.listSessions")(
      (accessToken: Redacted.Redacted<CliAccessTokenType>) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.listSessions({})
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    mutateDiscounts: Effect.fn("WorkspaceAdminApiClient.mutateDiscounts")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        requestId: CliMutationRequestIdType,
        input: AdministrationDiscountMutationType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.mutateDiscounts({
              payload: { requestId, mutation: input },
            })
          ),
          Effect.retry({
            schedule: Schedule.spaced("250 millis"),
            times: 20,
            while: (cause) =>
              cause instanceof CliMutationInProgress ||
              cause instanceof CliServiceUnavailable ||
              HttpClientError.isHttpClientError(cause),
          }),
          Effect.mapError(sanitizeMutationError)
        )
    ),
    renameSession: Effect.fn("WorkspaceAdminApiClient.renameSession")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        sessionId: CliSessionIdType,
        input: RenameCliSessionType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.renameSession({
              params: { sessionId },
              payload: input,
            })
          ),
          Effect.mapError(sanitizeResourceError)
        )
    ),
    revokeSession: Effect.fn("WorkspaceAdminApiClient.revokeSession")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        sessionId: CliSessionIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.revokeSession({
              params: { sessionId },
            })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
  };
});

export class CliApiRequestError extends Data.TaggedError("CliApiRequestError")<{
  readonly message: string;
}> {}

const sanitizedRequestError = () =>
  new CliApiRequestError({
    message: "The CLI API request could not be completed.",
  });

const sanitizeRequestError = (
  cause:
    | CliServiceUnavailable
    | HttpClientError.HttpClientError
    | Schema.SchemaError
) => (cause instanceof CliServiceUnavailable ? cause : sanitizedRequestError());

const sanitizeStartError = (
  cause:
    | CliAuthenticationRateLimited
    | CliServiceUnavailable
    | HttpClientError.HttpClientError
    | Schema.SchemaError
) => {
  if (
    cause instanceof CliAuthenticationRateLimited ||
    cause instanceof CliServiceUnavailable
  ) {
    return cause;
  }
  return sanitizedRequestError();
};

const sanitizeGrantError = (
  cause:
    | CliGrantRejected
    | CliServiceUnavailable
    | HttpClientError.HttpClientError
    | Schema.SchemaError
) => {
  if (
    cause instanceof CliGrantRejected ||
    cause instanceof CliServiceUnavailable
  ) {
    return cause;
  }
  return sanitizedRequestError();
};

const sanitizeSessionError = (
  cause:
    | CliServiceUnavailable
    | CliSessionUnauthorized
    | HttpClientError.HttpClientError
    | Schema.SchemaError
) => {
  if (
    cause instanceof CliServiceUnavailable ||
    cause instanceof CliSessionUnauthorized
  ) {
    return cause;
  }
  return sanitizedRequestError();
};

const sanitizeResourceError = (
  cause:
    | CliResourceNotFound
    | CliServiceUnavailable
    | CliSessionUnauthorized
    | HttpClientError.HttpClientError
    | Schema.SchemaError
) =>
  cause instanceof CliResourceNotFound ? cause : sanitizeSessionError(cause);

const sanitizeMutationError = (
  cause:
    | CliMutationInProgress
    | CliMutationRejected
    | CliResourceNotFound
    | CliServiceUnavailable
    | CliSessionUnauthorized
    | HttpClientError.HttpClientError
    | Schema.SchemaError
) => {
  if (
    cause instanceof CliMutationInProgress ||
    cause instanceof CliMutationRejected
  ) {
    return cause;
  }
  return sanitizeResourceError(cause);
};

const sanitizeReservationMutationError = (
  cause:
    | CliMutationRejected
    | CliResourceNotFound
    | CliServiceUnavailable
    | CliSessionUnauthorized
    | HttpClientError.HttpClientError
    | Schema.SchemaError
) =>
  cause instanceof CliMutationRejected ? cause : sanitizeResourceError(cause);

const sanitizeInvoiceCreationError = (
  cause:
    | CliMutationInProgress
    | CliMutationRejected
    | CliServiceUnavailable
    | CliSessionUnauthorized
    | HttpClientError.HttpClientError
    | Schema.SchemaError
) =>
  cause instanceof CliMutationInProgress || cause instanceof CliMutationRejected
    ? cause
    : sanitizeSessionError(cause);
