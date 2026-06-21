import { Context, Effect, Layer, Option, Predicate, Schema } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { NexiRuntimeConfig, type NexiRuntimeConfigObj } from "../config";
import { ExternalAPIError, NetworkError } from "../errors";
import {
  type CreateHostedPaymentPageRequest,
  type CreateHostedPaymentPageResponse,
  ErrorResponse,
  make,
  type NexiClient,
  type OrderResponse,
} from "../generated/effect.gen";

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
    readonly correlationId: string;
    readonly payload: CreateHostedPaymentPageRequest;
  }) => Effect.Effect<
    CreateHostedPaymentPageResponse,
    ExternalAPIError | NetworkError
  >;
  readonly getOrder: (input: {
    readonly correlationId: string;
    readonly orderId: string;
  }) => Effect.Effect<OrderResponse, ExternalAPIError | NetworkError>;
}

type GeneratedClientError = {
  readonly response: HttpClientResponse.HttpClientResponse;
  readonly cause: unknown;
};

const makeNexiGeneratedClient = Effect.gen(function* () {
  const config = yield* NexiRuntimeConfig;
  const httpClient = yield* HttpClient.HttpClient;

  const clientFor = (correlationId: string) =>
    makeNexiClient({
      config,
      httpClient,
      headers: { "Correlation-Id": correlationId },
    });

  const runNexiRequest = <A, E>(
    effect: Effect.Effect<A, E>,
    operation: string
  ) =>
    effect.pipe(
      Effect.mapError((error) => mapNexiClientError(error, operation)),
      Effect.timeoutOrElse({
        duration: config.apiTimeout,
        orElse: () =>
          Effect.fail(
            new NetworkError({
              message: "Failed to connect to Nexi",
            })
          ),
      })
    );

  return {
    createHostedPaymentPage: ({ correlationId, payload }) =>
      runNexiRequest(
        clientFor(correlationId).createHostedPaymentPage({ payload }),
        "Create hosted payment page"
      ),
    getOrder: ({ correlationId, orderId }) =>
      runNexiRequest(
        clientFor(correlationId).getOrder(orderId, undefined),
        "Get order"
      ),
  } satisfies INexiGeneratedClient;
});

export class NexiGeneratedClient extends Context.Service<
  NexiGeneratedClient,
  INexiGeneratedClient
>()("NexiGeneratedClient") {
  static Live = Layer.effect(this, makeNexiGeneratedClient);
}

export const mapNexiClientError = (
  error: unknown,
  operation: string
): ExternalAPIError | NetworkError => {
  if (isNetworkError(error)) return error;

  if (HttpClientError.isHttpClientError(error)) {
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

    const providerError = parseProviderError(
      "description" in reason ? reason.description : undefined
    );
    return toExternalApiError({
      operation,
      providerError,
      statusCode: error.response?.status,
      cause: providerError?.errors ?? providerError?.error ?? reason.cause,
      message:
        providerError?.message ?? providerError?.errors?.[0]?.description,
    });
  }

  if (isGeneratedClientError(error)) {
    const providerError = parseProviderError(error.cause);
    return toExternalApiError({
      operation,
      providerError,
      statusCode: error.response.status,
      cause: providerError?.errors ?? providerError?.error ?? error.cause,
      message:
        providerError?.message ?? providerError?.errors?.[0]?.description,
    });
  }

  if (Predicate.isError(error)) {
    if (
      error.name === "AbortError" ||
      error.message.includes("fetch") ||
      error.message.includes("ECONNREFUSED")
    ) {
      return new NetworkError({
        message: "Failed to connect to Nexi",
        cause: error,
      });
    }
  }

  const providerError = parseProviderError(error);
  if (providerError) {
    return toExternalApiError({
      operation,
      providerError,
      statusCode: providerError.status ?? 500,
      cause: providerError.errors ?? providerError.error,
      message: providerError.message ?? providerError.errors?.[0]?.description,
    });
  }

  return new ExternalAPIError({
    service: "Nexi",
    operation,
  });
};

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
