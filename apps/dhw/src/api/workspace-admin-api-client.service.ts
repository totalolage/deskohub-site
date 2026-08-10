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
  type AdministrationDiscountDashboardType,
  type AdministrationOperationDetailType,
  type AdministrationOperationListType,
  type AdministrationOperationQueryType,
  type AdministrationOrderListType,
  type AdministrationOrderQueryType,
  type AdministrationOrderType,
  type AdministrationOverviewType,
  type AdministrationReservationDetailType,
  type AdministrationReservationLookupResultType,
  type AdministrationReservationPageType,
  type AdministrationReservationQueryType,
  type CliAccessTokenType,
  type CliAuthenticationCodeType,
  CliAuthenticationRateLimited,
  type CliAuthenticationStatusType,
  CliGrantRejected,
  CliResourceNotFound,
  CliServiceUnavailable,
  type CliSessionAdministrationType,
  type CliSessionType,
  CliSessionUnauthorized,
  type ExchangeCliGrantType,
  type GrantedCliSessionType,
  type StartCliAuthenticationType,
  type StartedCliAuthenticationType,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { Context, Data, Effect, Layer, Redacted, type Schema } from "effect";
import {
  HttpClient,
  type HttpClientError,
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
    reservationId: string
  ) => Effect.Effect<
    AdministrationReservationDetailType,
    | CliApiRequestError
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
    bookingId: string
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
    orderId: string
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
    operationId: string
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
    customerId: string
  ) => Effect.Effect<
    AdministrationCustomerDetailType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly listCustomerReservations: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    customerId: string,
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
    codeId: string
  ) => Effect.Effect<
    AdministrationDiscountCodeDetailType,
    | CliApiRequestError
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
}

export class WorkspaceAdminApiClient extends Context.Service<
  WorkspaceAdminApiClient,
  IWorkspaceAdminApiClient
>()("WorkspaceAdminApiClient") {
  static Live = Layer.effect(
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
        reservationId: string
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
      (accessToken: Redacted.Redacted<CliAccessTokenType>, bookingId: string) =>
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
      (accessToken: Redacted.Redacted<CliAccessTokenType>, orderId: string) =>
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
        operationId: string
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
        customerId: string
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
        customerId: string,
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
    getDiscountCode: Effect.fn("WorkspaceAdminApiClient.getDiscountCode")(
      (accessToken: Redacted.Redacted<CliAccessTokenType>, codeId: string) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getDiscountCode({ params: { codeId } })
          ),
          Effect.mapError(sanitizeResourceError)
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
  };
});

export class CliApiRequestError extends Data.TaggedError("CliApiRequestError")<{
  readonly message: string;
}> {}

const sanitizedRequestError = () =>
  new CliApiRequestError({
    message: "The CLI authentication request could not be completed.",
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
