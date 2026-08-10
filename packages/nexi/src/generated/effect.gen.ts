// @effect-diagnostics schemaNumber:off unnecessaryTypeofType:off
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type { SchemaError } from "effect/Schema"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
// non-recursive definitions
export type Amount = { readonly "amount": string, readonly "currency": string }
export const Amount = Schema.Struct({ "amount": Schema.String.annotate({ "description": "Integer minor-unit/scaled amount string." }).check(Schema.isPattern(new RegExp("^[0-9]+$"))), "currency": Schema.String.check(Schema.isMinLength(3)).check(Schema.isMaxLength(3)) }).annotate({ "description": "Monetary amount as an integer minor-unit/scaled amount string, e.g. 5000 means 50.00 for currencies with two decimal places." })
export type PaymentSession = { readonly "amount": string, readonly "language": "CZE" | "ENG", readonly "resultUrl"?: string, readonly "cancelUrl"?: string, readonly "notificationUrl": string, readonly "paymentService"?: "CARDS", readonly "captureType"?: "IMPLICIT", readonly "actionType"?: "PAY" | "VERIFY" | "PURCHASE" | "PREAUTH" }
export const PaymentSession = Schema.Struct({ "amount": Schema.String.annotate({ "description": "Amount of the first payment in smallest currency unit." }).check(Schema.isPattern(new RegExp("^[0-9]+$"))), "language": Schema.Literals(["CZE", "ENG"]), "resultUrl": Schema.optionalKey(Schema.String.annotate({ "format": "uri" })), "cancelUrl": Schema.optionalKey(Schema.String.annotate({ "format": "uri" })), "notificationUrl": Schema.String.annotate({ "format": "uri" }), "paymentService": Schema.optionalKey(Schema.Literal("CARDS")), "captureType": Schema.optionalKey(Schema.Literal("IMPLICIT")), "actionType": Schema.optionalKey(Schema.Literals(["PAY", "VERIFY", "PURCHASE", "PREAUTH"])) }).annotate({ "description": "Nexi marks notificationUrl optional, but this wrapper requires it for server-authoritative fulfillment." })
export type CustomerInfo = { readonly "cardHolderName": string, readonly "cardHolderEmail"?: string, readonly "mobilePhoneCountryCode"?: string, readonly "mobilePhone"?: string }
export const CustomerInfo = Schema.Struct({ "cardHolderName": Schema.String.check(Schema.isMinLength(1)), "cardHolderEmail": Schema.optionalKey(Schema.String.annotate({ "format": "email" })), "mobilePhoneCountryCode": Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))), "mobilePhone": Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))) })
export type CreateHostedPaymentPageResponse = { readonly "hostedPage": string, readonly "securityToken": string, readonly "orderId"?: string }
export const CreateHostedPaymentPageResponse = Schema.Struct({ "hostedPage": Schema.String.annotate({ "format": "uri" }), "securityToken": Schema.String.check(Schema.isMinLength(1)), "orderId": Schema.optionalKey(Schema.String) })
export type OrderStatusOrder = { readonly "orderId": string, readonly "amount": string, readonly "currency": string }
export const OrderStatusOrder = Schema.Struct({ "orderId": Schema.String, "amount": Schema.String.check(Schema.isPattern(new RegExp("^[0-9]+$"))), "currency": Schema.String.check(Schema.isMinLength(3)).check(Schema.isMaxLength(3)) })
export type ErrorResponse = { readonly "errors"?: ReadonlyArray<{ readonly "code"?: string, readonly "description"?: string }>, readonly "error"?: string, readonly "message"?: string, readonly "status"?: number }
export const ErrorResponse = Schema.Struct({ "errors": Schema.optionalKey(Schema.Array(Schema.Struct({ "code": Schema.optionalKey(Schema.String), "description": Schema.optionalKey(Schema.String) }))), "error": Schema.optionalKey(Schema.String), "message": Schema.optionalKey(Schema.String), "status": Schema.optionalKey(Schema.Number.check(Schema.isInt())) })
export type Operation = { readonly "orderId"?: string, readonly "operationId"?: string, readonly "channel"?: string, readonly "operationType"?: string, readonly "operationResult"?: string, readonly "amount"?: Amount, readonly "operationAmount"?: string, readonly "operationCurrency"?: string, readonly "securityToken"?: string, readonly "operationTime"?: string, readonly "cancelledOperationId"?: string }
export const Operation = Schema.Struct({ "orderId": Schema.optionalKey(Schema.String), "operationId": Schema.optionalKey(Schema.String), "channel": Schema.optionalKey(Schema.String), "operationType": Schema.optionalKey(Schema.String), "operationResult": Schema.optionalKey(Schema.String), "amount": Schema.optionalKey(Amount), "operationAmount": Schema.optionalKey(Schema.String.check(Schema.isPattern(new RegExp("^[0-9]+$")))), "operationCurrency": Schema.optionalKey(Schema.String.check(Schema.isMinLength(3)).check(Schema.isMaxLength(3))), "securityToken": Schema.optionalKey(Schema.String), "operationTime": Schema.optionalKey(Schema.String), "cancelledOperationId": Schema.optionalKey(Schema.String) })
export type CreateHostedPaymentPageRequest = { readonly "order": { readonly "orderId": string, readonly "amount": string, readonly "currency"?: string, readonly "customerId"?: string, readonly "customerInfo"?: CustomerInfo }, readonly "paymentSession": PaymentSession, readonly "paymentService"?: "CARDS", readonly "captureType"?: "IMPLICIT" }
export const CreateHostedPaymentPageRequest = Schema.Struct({ "order": Schema.Struct({ "orderId": Schema.String, "amount": Schema.String.annotate({ "description": "Transaction amount in smallest currency unit." }).check(Schema.isPattern(new RegExp("^[0-9]+$"))), "currency": Schema.optionalKey(Schema.String.check(Schema.isMinLength(3)).check(Schema.isMaxLength(3))), "customerId": Schema.optionalKey(Schema.String), "customerInfo": Schema.optionalKey(CustomerInfo) }), "paymentSession": PaymentSession, "paymentService": Schema.optionalKey(Schema.Literal("CARDS")), "captureType": Schema.optionalKey(Schema.Literal("IMPLICIT")) })
export type OrderStatus = { readonly "authorizedAmount"?: string, readonly "capturedAmount"?: string, readonly "lastOperationTime"?: string, readonly "lastOperationType"?: string, readonly "order": OrderStatusOrder }
export const OrderStatus = Schema.Struct({ "authorizedAmount": Schema.optionalKey(Schema.String), "capturedAmount": Schema.optionalKey(Schema.String), "lastOperationTime": Schema.optionalKey(Schema.String), "lastOperationType": Schema.optionalKey(Schema.String), "order": OrderStatusOrder })
export type OperationListResponse = { readonly "operations"?: ReadonlyArray<Operation> }
export const OperationListResponse = Schema.Struct({ "operations": Schema.optionalKey(Schema.Array(Operation)) })
export type OrderResponse = { readonly "orderId"?: string, readonly "amount"?: Amount, readonly "securityToken"?: string, readonly "orderStatus"?: OrderStatus, readonly "operations"?: ReadonlyArray<Operation> }
export const OrderResponse = Schema.Struct({ "orderId": Schema.optionalKey(Schema.String), "amount": Schema.optionalKey(Amount), "securityToken": Schema.optionalKey(Schema.String), "orderStatus": Schema.optionalKey(OrderStatus), "operations": Schema.optionalKey(Schema.Array(Operation)) })
export type OrderListResponse = { readonly "orders"?: ReadonlyArray<OrderStatus> }
export const OrderListResponse = Schema.Struct({ "orders": Schema.optionalKey(Schema.Array(OrderStatus)) })
// schemas
export type ListOrdersParams = { readonly "fromTime"?: string, readonly "toTime"?: string, readonly "maxRecords"?: number, readonly "customField"?: string }
export const ListOrdersParams = Schema.Struct({ "fromTime": Schema.optionalKey(Schema.String), "toTime": Schema.optionalKey(Schema.String), "maxRecords": Schema.optionalKey(Schema.Number.check(Schema.isInt())), "customField": Schema.optionalKey(Schema.String) })
export type ListOrders200 = OrderListResponse
export const ListOrders200 = OrderListResponse
export type ListOrdersdefault = ErrorResponse
export const ListOrdersdefault = ErrorResponse
export type CreateHostedPaymentPageRequestJson = CreateHostedPaymentPageRequest
export const CreateHostedPaymentPageRequestJson = CreateHostedPaymentPageRequest
export type CreateHostedPaymentPage200 = CreateHostedPaymentPageResponse
export const CreateHostedPaymentPage200 = CreateHostedPaymentPageResponse
export type CreateHostedPaymentPagedefault = ErrorResponse
export const CreateHostedPaymentPagedefault = ErrorResponse
export type GetOrder200 = OrderResponse
export const GetOrder200 = OrderResponse
export type GetOrderdefault = ErrorResponse
export const GetOrderdefault = ErrorResponse
export type ListOperationsParams = { readonly "fromTime"?: string, readonly "toTime"?: string, readonly "maxRecords"?: number, readonly "channel"?: string, readonly "operationType"?: string, readonly "customField"?: string }
export const ListOperationsParams = Schema.Struct({ "fromTime": Schema.optionalKey(Schema.String), "toTime": Schema.optionalKey(Schema.String), "maxRecords": Schema.optionalKey(Schema.Number.check(Schema.isInt())), "channel": Schema.optionalKey(Schema.String), "operationType": Schema.optionalKey(Schema.String), "customField": Schema.optionalKey(Schema.String) })
export type ListOperations200 = OperationListResponse
export const ListOperations200 = OperationListResponse
export type ListOperationsdefault = ErrorResponse
export const ListOperationsdefault = ErrorResponse
export type GetOperation200 = Operation
export const GetOperation200 = Operation
export type GetOperationdefault = ErrorResponse
export const GetOperationdefault = ErrorResponse

export interface OperationConfig {
  /**
   * Whether or not the response should be included in the value returned from
   * an operation.
   *
   * If set to `true`, a tuple of `[A, HttpClientResponse]` will be returned,
   * where `A` is the success type of the operation.
   *
   * If set to `false`, only the success type of the operation will be returned.
   */
  readonly includeResponse?: boolean | undefined
}

/**
 * A utility type which optionally includes the response in the return result
 * of an operation based upon the value of the `includeResponse` configuration
 * option.
 */
export type WithOptionalResponse<A, Config extends OperationConfig> = Config extends {
  readonly includeResponse: true
} ? [A, HttpClientResponse.HttpClientResponse] : A

export const make = (
  httpClient: HttpClient.HttpClient,
  options: {
    readonly transformClient?: ((client: HttpClient.HttpClient) => Effect.Effect<HttpClient.HttpClient>) | undefined
  } = {}
): NexiClient => {
  const unexpectedStatus = (response: HttpClientResponse.HttpClientResponse) =>
    Effect.flatMap(
      Effect.orElseSucceed(response.json, () => "Unexpected status code"),
      (description) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.StatusCodeError({
              request: response.request,
              response,
              description: typeof description === "string" ? description : JSON.stringify(description),
            }),
          }),
        ),
    )
  const withResponse = <Config extends OperationConfig>(config: Config | undefined) => (
    f: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<any, any>,
  ): (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<any, any> => {
    const withOptionalResponse = (
      config?.includeResponse
        ? (response: HttpClientResponse.HttpClientResponse) => Effect.map(f(response), (a) => [a, response])
        : (response: HttpClientResponse.HttpClientResponse) => f(response)
    ) as any
    return options?.transformClient
      ? (request) =>
          Effect.flatMap(
            Effect.flatMap(options.transformClient!(httpClient), (client) => client.execute(request)),
            withOptionalResponse
          )
      : (request) => Effect.flatMap(httpClient.execute(request), withOptionalResponse)
  }
  const decodeSuccess =
    <Schema extends Schema.Top>(schema: Schema) =>
    (response: HttpClientResponse.HttpClientResponse) =>
      HttpClientResponse.schemaBodyJson(schema)(response)
  const decodeError =
    <const Tag extends string, Schema extends Schema.Top>(tag: Tag, schema: Schema) =>
    (response: HttpClientResponse.HttpClientResponse) =>
      Effect.flatMap(
        HttpClientResponse.schemaBodyJson(schema)(response).pipe(
          Effect.mapError(
            () =>
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.StatusCodeError({
                  request: response.request,
                  response,
                  description: "Error response did not match the documented schema",
                }),
              }),
          ),
        ),
        (cause) => Effect.fail(NexiClientError(tag, cause, response)),
      )
  return {
    httpClient,
    "listOrders": (options) => HttpClientRequest.get(`/orders`).pipe(
    HttpClientRequest.setUrlParams({ "fromTime": options?.params?.["fromTime"] as any, "toTime": options?.params?.["toTime"] as any, "maxRecords": options?.params?.["maxRecords"] as any, "customField": options?.params?.["customField"] as any }),
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(ListOrders200),
      orElse: unexpectedStatus
    }))
  ),
    "createHostedPaymentPage": (options) => HttpClientRequest.post(`/orders/hpp`).pipe(
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(CreateHostedPaymentPage200),
      orElse: unexpectedStatus
    }))
  ),
    "getOrder": (orderId, options) => HttpClientRequest.get(`/orders/${orderId}`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetOrder200),
      orElse: unexpectedStatus
    }))
  ),
    "listOperations": (options) => HttpClientRequest.get(`/operations`).pipe(
    HttpClientRequest.setUrlParams({ "fromTime": options?.params?.["fromTime"] as any, "toTime": options?.params?.["toTime"] as any, "maxRecords": options?.params?.["maxRecords"] as any, "channel": options?.params?.["channel"] as any, "operationType": options?.params?.["operationType"] as any, "customField": options?.params?.["customField"] as any }),
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(ListOperations200),
      orElse: unexpectedStatus
    }))
  ),
    "getOperation": (operationId, options) => HttpClientRequest.get(`/operations/${operationId}`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetOperation200),
      orElse: unexpectedStatus
    }))
  )
  }
}

export interface NexiClient {
  readonly httpClient: HttpClient.HttpClient
  /**
* List orders in reverse chronological order
*/
readonly "listOrders": <Config extends OperationConfig>(options: { readonly params?: typeof ListOrdersParams.Encoded | undefined; readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof ListOrders200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Create hosted payment page session
*/
readonly "createHostedPaymentPage": <Config extends OperationConfig>(options: { readonly payload: typeof CreateHostedPaymentPageRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof CreateHostedPaymentPage200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Get order outcome
*/
readonly "getOrder": <Config extends OperationConfig>(orderId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetOrder200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* List operations in a time interval
*/
readonly "listOperations": <Config extends OperationConfig>(options: { readonly params?: typeof ListOperationsParams.Encoded | undefined; readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof ListOperations200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Get one operation
*/
readonly "getOperation": <Config extends OperationConfig>(operationId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetOperation200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
}

export interface NexiClientError<Tag extends string, E> {
  readonly _tag: Tag
  readonly request: HttpClientRequest.HttpClientRequest
  readonly response: HttpClientResponse.HttpClientResponse
  readonly cause: E
}

class NexiClientErrorImpl extends Data.Error<{
  _tag: string
  cause: any
  request: HttpClientRequest.HttpClientRequest
  response: HttpClientResponse.HttpClientResponse
}> {}

export const NexiClientError = <Tag extends string, E>(
  tag: Tag,
  cause: E,
  response: HttpClientResponse.HttpClientResponse,
): NexiClientError<Tag, E> =>
  new NexiClientErrorImpl({
    _tag: tag,
    cause,
    response,
    request: response.request,
  }) as any
