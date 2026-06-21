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
export type CreateHostedPaymentPageResponse = { readonly "hostedPage": string, readonly "securityToken": string, readonly "orderId"?: string }
export const CreateHostedPaymentPageResponse = Schema.Struct({ "hostedPage": Schema.String.annotate({ "format": "uri" }), "securityToken": Schema.String, "orderId": Schema.optionalKey(Schema.String) })
export type OrderStatusOrder = { readonly "orderId": string, readonly "amount": string, readonly "currency": string }
export const OrderStatusOrder = Schema.Struct({ "orderId": Schema.String, "amount": Schema.String.check(Schema.isPattern(new RegExp("^[0-9]+$"))), "currency": Schema.String.check(Schema.isMinLength(3)).check(Schema.isMaxLength(3)) })
export type ErrorResponse = { readonly "errors"?: ReadonlyArray<{ readonly "code"?: string, readonly "description"?: string }>, readonly "error"?: string, readonly "message"?: string, readonly "status"?: number }
export const ErrorResponse = Schema.Struct({ "errors": Schema.optionalKey(Schema.Array(Schema.Struct({ "code": Schema.optionalKey(Schema.String), "description": Schema.optionalKey(Schema.String) }))), "error": Schema.optionalKey(Schema.String), "message": Schema.optionalKey(Schema.String), "status": Schema.optionalKey(Schema.Number.check(Schema.isInt())) })
export type Operation = { readonly "operationId"?: string, readonly "operationType"?: "AUTHORIZATION" | "CAPTURE", readonly "operationResult"?: "AUTHORIZED" | "PENDING" | "EXECUTED" | "DECLINED" | "DENIED_BY_RISK" | "DENIED" | "THREEDS_FAILED" | "FAILED" | "CANCELED" | "VOIDED" | "REFUNDED", readonly "amount"?: Amount, readonly "operationAmount"?: string, readonly "operationCurrency"?: string, readonly "securityToken"?: string, readonly "operationTime"?: string }
export const Operation = Schema.Struct({ "operationId": Schema.optionalKey(Schema.String), "operationType": Schema.optionalKey(Schema.Literals(["AUTHORIZATION", "CAPTURE"])), "operationResult": Schema.optionalKey(Schema.Literals(["AUTHORIZED", "PENDING", "EXECUTED", "DECLINED", "DENIED_BY_RISK", "DENIED", "THREEDS_FAILED", "FAILED", "CANCELED", "VOIDED", "REFUNDED"])), "amount": Schema.optionalKey(Amount), "operationAmount": Schema.optionalKey(Schema.String.check(Schema.isPattern(new RegExp("^[0-9]+$")))), "operationCurrency": Schema.optionalKey(Schema.String.check(Schema.isMinLength(3)).check(Schema.isMaxLength(3))), "securityToken": Schema.optionalKey(Schema.String), "operationTime": Schema.optionalKey(Schema.String) })
export type CreateHostedPaymentPageRequest = { readonly "order": { readonly "orderId": string, readonly "amount": string, readonly "currency"?: string }, readonly "paymentSession": PaymentSession, readonly "paymentService"?: "CARDS", readonly "captureType"?: "IMPLICIT" }
export const CreateHostedPaymentPageRequest = Schema.Struct({ "order": Schema.Struct({ "orderId": Schema.String, "amount": Schema.String.annotate({ "description": "Transaction amount in smallest currency unit." }).check(Schema.isPattern(new RegExp("^[0-9]+$"))), "currency": Schema.optionalKey(Schema.String.check(Schema.isMinLength(3)).check(Schema.isMaxLength(3))) }), "paymentSession": PaymentSession, "paymentService": Schema.optionalKey(Schema.Literal("CARDS")), "captureType": Schema.optionalKey(Schema.Literal("IMPLICIT")) })
export type OrderStatus = { readonly "authorizedAmount"?: string, readonly "capturedAmount"?: string, readonly "lastOperationTime"?: string, readonly "lastOperationType"?: string, readonly "order": OrderStatusOrder }
export const OrderStatus = Schema.Struct({ "authorizedAmount": Schema.optionalKey(Schema.String), "capturedAmount": Schema.optionalKey(Schema.String), "lastOperationTime": Schema.optionalKey(Schema.String), "lastOperationType": Schema.optionalKey(Schema.String), "order": OrderStatusOrder })
export type OrderResponse = { readonly "orderId"?: string, readonly "amount"?: Amount, readonly "securityToken"?: string, readonly "orderStatus"?: OrderStatus, readonly "operations"?: ReadonlyArray<Operation> }
export const OrderResponse = Schema.Struct({ "orderId": Schema.optionalKey(Schema.String), "amount": Schema.optionalKey(Amount), "securityToken": Schema.optionalKey(Schema.String), "orderStatus": Schema.optionalKey(OrderStatus), "operations": Schema.optionalKey(Schema.Array(Operation)) })
// schemas
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
        HttpClientResponse.schemaBodyJson(schema)(response),
        (cause) => Effect.fail(NexiClientError(tag, cause, response)),
      )
  return {
    httpClient,
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
  )
  }
}

export interface NexiClient {
  readonly httpClient: HttpClient.HttpClient
  /**
* Create hosted payment page session
*/
readonly "createHostedPaymentPage": <Config extends OperationConfig>(options: { readonly payload: typeof CreateHostedPaymentPageRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof CreateHostedPaymentPage200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Get order outcome
*/
readonly "getOrder": <Config extends OperationConfig>(orderId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetOrder200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
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
