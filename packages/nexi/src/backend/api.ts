import { Context, Effect, Layer, Option, Predicate, Schema } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/unstable/http";
import { NexiRuntimeConfig, type NexiRuntimeConfigObj } from "../config";
import { ExternalAPIError, NetworkError } from "../errors";
import {
  type CreateHostedPaymentPageRequest,
  type CreateHostedPaymentPageResponse,
  ErrorResponse,
  make,
  type NexiClient,
  type Operation,
  type OperationListResponse,
  type OrderListResponse,
  type OrderResponse,
} from "../generated/effect.gen";
import type { NexiCorrelationId, NexiOperationId, NexiOrderId } from "../types";
import { getNexiRequestPolicy } from "./request-policy";

const NEXI_API_PATH = "/api/phoenix-0.0/psp/api/v1";

export const makeNexiClient = ({
  config,
  headers,
  httpClient,
}: {
  config: NexiRuntimeConfigObj;
  headers?: Record<string, string>;
  httpClient: HttpClient.HttpClient;
}): NexiClient => {
  const baseUrl = new URL(NEXI_API_PATH, config.baseUrl).toString();
  return make(httpClient, {
    transformClient: (client) =>
      Effect.succeed(
        client.pipe(
          HttpClient.mapRequestInput((request) =>
            request.pipe(
              HttpClientRequest.prependUrl(baseUrl),
              HttpClientRequest.setHeaders({
                "X-API-KEY": config.apiKey,
                ...headers,
              })
            )
          )
        )
      ),
  });
};

interface INexiGeneratedClient {
  readonly createHostedPaymentPage: (input: {
    readonly correlationId: NexiCorrelationId;
    readonly payload: CreateHostedPaymentPageRequest;
  }) => Effect.Effect<
    CreateHostedPaymentPageResponse,
    ExternalAPIError | NetworkError
  >;
  readonly getOrder: (input: {
    readonly correlationId: NexiCorrelationId;
    readonly orderId: NexiOrderId;
  }) => Effect.Effect<OrderResponse, ExternalAPIError | NetworkError>;
  readonly listOrders: (input: {
    readonly correlationId: NexiCorrelationId;
    readonly fromTime?: string;
    readonly toTime?: string;
    readonly maxRecords?: number;
  }) => Effect.Effect<OrderListResponse, ExternalAPIError | NetworkError>;
  readonly getOperation: (input: {
    readonly correlationId: NexiCorrelationId;
    readonly operationId: NexiOperationId;
  }) => Effect.Effect<Operation, ExternalAPIError | NetworkError>;
  readonly listOperations: (input: {
    readonly correlationId: NexiCorrelationId;
    readonly fromTime?: string;
    readonly toTime?: string;
    readonly maxRecords?: number;
    readonly channel?: string;
    readonly operationType?: string;
  }) => Effect.Effect<OperationListResponse, ExternalAPIError | NetworkError>;
}

type GeneratedClientError = {
  readonly response: HttpClientResponse.HttpClientResponse;
  readonly cause: unknown;
};

const makeNexiGeneratedClient = Effect.gen(function* () {
  const config = yield* NexiRuntimeConfig;
  const httpClient = yield* HttpClient.HttpClient;

  const clientFor = (correlationId: NexiCorrelationId) =>
    makeNexiClient({
      config,
      httpClient,
      headers: { "Correlation-Id": correlationId },
    });

  const boundAttempt = getNexiRequestPolicy(config.apiTimeout).attempt(
    () =>
      new NetworkError({
        message: "Failed to connect to Nexi",
      })
  );

  const runNexiRequest = <A, E>(
    effect: Effect.Effect<A, E>,
    operation: string
  ) =>
    effect.pipe(
      Effect.mapError((error) => mapNexiClientError(error, operation)),
      boundAttempt
    );

  return {
    createHostedPaymentPage: ({ correlationId, payload }) =>
      runNexiRequest(
        clientFor(correlationId).createHostedPaymentPage({ payload }),
        "Create hosted payment page"
      ),
    getOrder: ({ correlationId, orderId }) =>
      runNexiRequest(
        clientFor(correlationId).getOrder(
          encodeURIComponent(orderId),
          undefined
        ),
        "Get order"
      ),
    listOrders: ({ correlationId, ...options }) =>
      runNexiRequest(
        clientFor(correlationId).listOrders({ params: options }),
        "List orders"
      ),
    getOperation: ({ correlationId, operationId }) =>
      runNexiRequest(
        clientFor(correlationId).getOperation(
          encodeURIComponent(operationId),
          undefined
        ),
        "Get operation"
      ),
    listOperations: ({ correlationId, ...options }) =>
      runNexiRequest(
        clientFor(correlationId).listOperations({ params: options }),
        "List operations"
      ),
  } satisfies INexiGeneratedClient;
});

export class NexiGeneratedClient extends Context.Service<
  NexiGeneratedClient,
  INexiGeneratedClient
>()("NexiGeneratedClient") {
  static Default = Layer.effect(this, makeNexiGeneratedClient);
}

export const mapNexiClientError = (
  error: unknown,
  operation: string
): ExternalAPIError | NetworkError => {
  if (isNetworkError(error)) return error;
  if (Schema.isSchemaError(error)) return toInvalidResponseError(operation);
  if (HttpClientError.isHttpClientError(error)) {
    return mapHttpClientError(error, operation);
  }
  if (isGeneratedClientError(error)) {
    return mapGeneratedClientError(error, operation);
  }
  if (isConnectionFailure(error)) {
    return new NetworkError({
      message: "Failed to connect to Nexi",
      cause: error,
    });
  }

  return mapUnclassifiedError(error, operation);
};

const toInvalidResponseError = (operation: string) =>
  new ExternalAPIError({
    service: "Nexi",
    operation,
    message: "Nexi returned an invalid response.",
  });

/**
 * A transport or URL failure never reached Nexi; any other HTTP client
 * failure carries the provider's error body in its description.
 */
const mapHttpClientError = (
  error: HttpClientError.HttpClientError,
  operation: string
) => {
  const reason = error.reason;
  if (
    Predicate.isTagged(reason, "TransportError") ||
    Predicate.isTagged(reason, "InvalidUrlError")
  ) {
    return new NetworkError({
      message: "Failed to connect to Nexi",
      url: error.request.url,
      cause: error,
    });
  }

  return toProviderApiError({
    operation,
    providerError: parseProviderError(
      "description" in reason ? reason.description : undefined
    ),
    statusCode: error.response?.status,
    fallbackCause: reason.cause,
  });
};

const mapGeneratedClientError = (
  error: GeneratedClientError,
  operation: string
) =>
  toProviderApiError({
    operation,
    providerError: parseProviderError(error.cause),
    statusCode: error.response.status,
    fallbackCause: error.cause,
  });

/** An aborted request or a failed fetch or connection. */
const isConnectionFailure = (error: unknown): error is Error =>
  Predicate.isError(error) &&
  (error.name === "AbortError" ||
    error.message.includes("fetch") ||
    error.message.includes("ECONNREFUSED"));

// Every field of the provider error body is optional, so only a plain
// payload counts; an unexpected Error is not a provider response.
const mapUnclassifiedError = (error: unknown, operation: string) => {
  const providerError = Predicate.isError(error)
    ? undefined
    : parseProviderError(error);
  if (providerError) {
    return toProviderApiError({
      operation,
      providerError,
      statusCode: providerError.status ?? 500,
      fallbackCause: undefined,
    });
  }

  return new ExternalAPIError({
    service: "Nexi",
    operation,
    cause: error,
  });
};

/** The provider's errors, else its error code, else the fallback cause. */
const getProviderErrorCause = (
  providerError: ErrorResponse | undefined,
  fallbackCause: unknown
) => providerError?.errors ?? providerError?.error ?? fallbackCause;

/** The provider's message, else its first error's description. */
const getProviderErrorMessage = (providerError: ErrorResponse | undefined) =>
  providerError?.message ?? providerError?.errors?.[0]?.description;

const toProviderApiError = ({
  operation,
  providerError,
  statusCode,
  fallbackCause,
}: {
  operation: string;
  providerError: ErrorResponse | undefined;
  statusCode: number | undefined;
  fallbackCause: unknown;
}) =>
  toExternalApiError({
    operation,
    providerError,
    statusCode,
    cause: getProviderErrorCause(providerError, fallbackCause),
    message: getProviderErrorMessage(providerError),
  });

const parseProviderError = (error: unknown): ErrorResponse | undefined => {
  const decoded = Schema.decodeUnknownOption(ErrorResponse)(error);
  if (Option.isSome(decoded)) return decoded.value;

  if (typeof error !== "string") return undefined;

  try {
    const parsed = JSON.parse(error);
    const parsedDecoded = Schema.decodeUnknownOption(ErrorResponse)(parsed);
    return Option.isSome(parsedDecoded) ? parsedDecoded.value : undefined;
  } catch {
    return undefined;
  }
};

const toExternalApiError = ({
  cause,
  message,
  operation,
  providerError,
  statusCode,
}: {
  cause: unknown;
  message: string | undefined;
  operation: string;
  providerError: ErrorResponse | undefined;
  statusCode: number | undefined;
}) =>
  new ExternalAPIError({
    service: "Nexi",
    operation,
    statusCode: providerError?.status ?? statusCode,
    message,
    cause,
  });

const isNetworkError = (error: unknown): error is NetworkError =>
  Predicate.isTagged(error, "NetworkError");

const isGeneratedClientError = (
  error: unknown
): error is GeneratedClientError =>
  Predicate.hasProperty(error, "response") &&
  Predicate.hasProperty(error, "cause");
