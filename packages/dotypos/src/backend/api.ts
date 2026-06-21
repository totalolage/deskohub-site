import { Context, Effect, Layer, Option, Predicate, Schema } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { DotyposRuntimeConfig, type DotyposRuntimeConfigObj } from "../config";
import { ExternalAPIError, NetworkError } from "../errors";
import {
  type DotyposClient,
  ErrorResponse,
  make,
} from "../generated/effect.gen";

const DiscountGroup = Schema.Struct({
  discountPercent: Schema.optionalKey(
    Schema.Union([Schema.Number, Schema.String, Schema.Null])
  ),
});

interface IDotyposAccessToken {
  readonly get: Effect.Effect<string, ExternalAPIError | NetworkError>;
}

interface IDotyposGeneratedClient {
  readonly client: DotyposClient;
  readonly httpClient: HttpClient.HttpClient;
}

type GeneratedClientError = {
  readonly response: HttpClientResponse.HttpClientResponse;
  readonly cause: unknown;
};

export const makeDotyposClient = ({
  config,
  httpClient,
}: {
  config: DotyposRuntimeConfigObj;
  httpClient: HttpClient.HttpClient;
}): DotyposClient =>
  make(httpClient, {
    transformClient: (client) =>
      Effect.succeed(
        client.pipe(
          HttpClient.mapRequestInput((request) =>
            request.pipe(HttpClientRequest.prependUrl(config.apiUrl))
          )
        )
      ),
  });

export class DotyposAccessToken extends Context.Service<
  DotyposAccessToken,
  IDotyposAccessToken
>()("@deskohub/dotypos/DotyposAccessToken") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* DotyposRuntimeConfig;
      const httpClient = yield* HttpClient.HttpClient;
      const client = makeDotyposClient({ config, httpClient });
      const get = yield* Effect.cached(
        client
          .getAccessToken({
            params: { Authorization: `User ${config.refreshToken}` },
            payload: { _cloudId: config.cloudId },
          })
          .pipe(
            Effect.map((response) => response.accessToken),
            Effect.mapError((error) =>
              mapDotyposClientError(error, "Get access token", config.apiUrl)
            )
          )
      );

      return { get };
    })
  );
}

export class DotyposGeneratedClient extends Context.Service<
  DotyposGeneratedClient,
  IDotyposGeneratedClient
>()("@deskohub/dotypos/DotyposGeneratedClient") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* DotyposRuntimeConfig;
      const httpClient = yield* HttpClient.HttpClient;
      const accessToken = yield* DotyposAccessToken;
      const authenticatedHttpClient = httpClient.pipe(
        HttpClient.mapRequestInputEffect((request) =>
          accessToken.get.pipe(
            Effect.map((token) =>
              request.pipe(
                HttpClientRequest.prependUrl(config.apiUrl),
                HttpClientRequest.setHeaders({
                  Authorization: `Bearer ${token}`,
                })
              )
            )
          )
        )
      ) as HttpClient.HttpClient;

      return {
        client: make(authenticatedHttpClient),
        httpClient: authenticatedHttpClient,
      };
    })
  );
}

export const getDiscountGroup = ({
  config,
  discountGroupId,
  httpClient,
}: {
  config: DotyposRuntimeConfigObj;
  discountGroupId: string;
  httpClient: HttpClient.HttpClient;
}) =>
  // ponytail: endpoint is missing from Dotypos OpenAPI; delete this when the spec includes discount-groups.
  HttpClientRequest.get(
    `/clouds/${config.cloudId}/discount-groups/${discountGroupId}`
  ).pipe(
    httpClient.execute,
    Effect.flatMap(
      HttpClientResponse.matchStatus({
        "2xx": HttpClientResponse.schemaBodyJson(DiscountGroup),
        orElse: unexpectedStatus,
      })
    )
  );

export const mapDotyposClientError = (
  error: unknown,
  operation: string,
  apiUrl: string
): ExternalAPIError | NetworkError => {
  if (Predicate.isTagged(error, "ExternalAPIError")) {
    return error as ExternalAPIError;
  }
  if (Predicate.isTagged(error, "NetworkError")) {
    return error as NetworkError;
  }

  if (HttpClientError.isHttpClientError(error)) {
    const reason = error.reason;
    if (
      Predicate.isTagged(reason, "TransportError") ||
      Predicate.isTagged(reason, "InvalidUrlError")
    ) {
      return new NetworkError({
        message: "Failed to connect to Dotypos",
        url: error.request.url || apiUrl,
        cause: error,
      });
    }

    const providerError = parseProviderError(
      Predicate.hasProperty(reason, "description")
        ? reason.description
        : undefined
    );
    return toExternalApiError({
      cause: providerError?.error ?? reason.cause,
      message: providerError?.error_description,
      operation,
      providerError,
      statusCode: error.response?.status,
    });
  }

  if (isGeneratedClientError(error)) {
    const providerError = parseProviderError(error.cause);
    return toExternalApiError({
      cause: providerError?.error ?? error.cause,
      message: providerError?.error_description,
      operation,
      providerError,
      statusCode: error.response.status,
    });
  }

  if (Predicate.isError(error)) {
    if (
      error.name === "AbortError" ||
      error.message.includes("fetch") ||
      error.message.includes("ECONNREFUSED")
    ) {
      return new NetworkError({
        message: "Failed to connect to Dotypos",
        url: apiUrl,
        cause: error,
      });
    }
  }

  const providerError = parseProviderError(error);
  if (providerError) {
    return toExternalApiError({
      cause: providerError.error,
      message: providerError.error_description,
      operation,
      providerError,
      statusCode: providerError.code ?? 500,
    });
  }

  return new ExternalAPIError({
    service: "Dotypos",
    operation,
    cause: error,
  });
};

const unexpectedStatus = (response: HttpClientResponse.HttpClientResponse) =>
  Effect.flatMap(
    Effect.orElseSucceed(response.json, () => "Unexpected status code"),
    (description) =>
      Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.StatusCodeError({
            request: response.request,
            response,
            description: Predicate.isString(description)
              ? description
              : JSON.stringify(description),
          }),
        })
      )
  );

const parseProviderError = (error: unknown) => {
  const decoded = Schema.decodeUnknownOption(ErrorResponse)(error);
  if (Option.isSome(decoded)) return decoded.value;

  if (!Predicate.isString(error)) return undefined;

  try {
    const parsed = JSON.parse(error);
    const parsedDecoded = Schema.decodeUnknownOption(ErrorResponse)(parsed);
    return Option.isSome(parsedDecoded) ? parsedDecoded.value : undefined;
  } catch {
    return undefined;
  }
};

const isGeneratedClientError = (
  error: unknown
): error is GeneratedClientError =>
  Predicate.hasProperty(error, "response") &&
  Predicate.hasProperty(error, "cause");

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
    service: "Dotypos",
    operation,
    statusCode: statusCode ?? providerError?.code,
    message,
    cause,
  });
