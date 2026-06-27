import { Context, Effect, Layer, Option, Predicate, Ref, Schema } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { DotyposRuntimeConfig, type DotyposRuntimeConfigObj } from "../config";
import {
  type DotyposProviderError,
  ExternalAPIError,
  NetworkError,
} from "../errors";
import {
  type DotyposClient,
  type ErrorResponse as DotyposErrorResponse,
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

type AccessTokenCache = {
  readonly token: string;
  readonly expiresAt: number;
};

type GeneratedClientError = {
  readonly response: HttpClientResponse.HttpClientResponse;
  readonly cause: unknown;
};

type ProviderErrorInput = DotyposErrorResponse | string | undefined;

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
      const tokenCache = yield* Ref.make<AccessTokenCache | null>(null);
      const get = Effect.gen(function* () {
        const cached = yield* Ref.get(tokenCache);
        const now = Date.now();
        if (cached && now < cached.expiresAt) return cached.token;

        const token = yield* client
          .getAccessToken({
            params: { Authorization: `User ${config.refreshToken}` },
            payload: { _cloudId: config.cloudId },
          })
          .pipe(
            Effect.map((response) => response.accessToken),
            Effect.mapError((error) =>
              mapDotyposClientError(error, "Get access token", config.apiUrl)
            )
          );

        yield* Ref.set(tokenCache, {
          token,
          expiresAt: now + 59 * 60 * 1000,
        });

        return token;
      });

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

    const providerErrorInput = Predicate.hasProperty(reason, "description")
      ? reason.description
      : undefined;
    const providerError = parseProviderError(
      Predicate.isString(providerErrorInput) ||
        Schema.is(ErrorResponse)(providerErrorInput)
        ? providerErrorInput
        : undefined
    );
    return toExternalApiError({
      operation,
      providerError,
      statusCode: error.response?.status,
    });
  }

  if (isGeneratedClientError(error)) {
    const providerError = parseProviderError(
      Predicate.isString(error.cause) || Schema.is(ErrorResponse)(error.cause)
        ? error.cause
        : undefined
    );
    return toExternalApiError({
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

  const providerError = parseProviderError(
    Predicate.isString(error) || Schema.is(ErrorResponse)(error)
      ? error
      : undefined
  );
  if (providerError) {
    return toExternalApiError({
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

const parseProviderError = (error: ProviderErrorInput) => {
  if (!error) return undefined;
  if (!Predicate.isString(error)) return toProviderError(error);

  try {
    const parsed = JSON.parse(error);
    const parsedDecoded = Schema.decodeUnknownOption(ErrorResponse)(parsed);
    return Option.isSome(parsedDecoded)
      ? toProviderError(parsedDecoded.value)
      : undefined;
  } catch {
    return undefined;
  }
};

const toProviderError = (
  error: DotyposErrorResponse
): DotyposProviderError | undefined => {
  const providerError: DotyposProviderError = {
    error: error.error,
    errorDescription: error.error_description,
    code: error.code,
  };

  return providerError.error ||
    providerError.errorDescription ||
    providerError.code !== undefined
    ? providerError
    : undefined;
};

const isGeneratedClientError = (
  error: unknown
): error is GeneratedClientError =>
  Predicate.hasProperty(error, "response") &&
  Predicate.hasProperty(error, "cause");

const toExternalApiError = ({
  operation,
  providerError,
  statusCode,
}: {
  operation: string;
  providerError: DotyposProviderError | undefined;
  statusCode: number | undefined;
}) =>
  new ExternalAPIError({
    service: "Dotypos",
    operation,
    statusCode: statusCode ?? providerError?.code,
    message: "Dotypos API request failed",
    providerError,
  });
