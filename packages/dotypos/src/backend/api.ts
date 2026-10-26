import {
  Cache,
  Context,
  Data,
  Effect,
  Exit,
  Layer,
  Option,
  Predicate,
  Schema,
} from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/unstable/http";
import { DotyposRuntimeConfig, type DotyposRuntimeConfigObj } from "../config";
import {
  type DotyposClient,
  type ErrorResponse as DotyposErrorResponse,
  ErrorResponse,
  make,
} from "../generated/effect.gen";

/** The error body Dotypos sends with a failed request. */
type DotyposProviderError = {
  readonly error?: string;
  readonly errorDescription?: string;
  readonly code?: number;
};

/**
 * What went wrong on the wire, before the package classifies it into a public
 * outcome by the request's profile:
 * - `status`: Dotypos answered with this HTTP status. A 2xx status means its
 *   body could not be read.
 * - `transport`: the request never got an answer.
 * - `unreadable`: anything else, such as a response that failed generated
 *   decoding. It carries no status.
 */
export type DotyposWireOutcome =
  | {
      readonly kind: "status";
      readonly status: number;
      readonly providerError: DotyposProviderError | undefined;
    }
  | { readonly kind: "transport" }
  | { readonly kind: "unreadable" };

/**
 * A failed Dotypos exchange. `fromAccessToken` marks failures of the
 * access-token request, which runs before the addressed request is sent.
 */
export class DotyposWireFailure extends Data.TaggedError("DotyposWireFailure")<{
  readonly outcome: DotyposWireOutcome;
  readonly fromAccessToken: boolean;
  readonly cause?: unknown;
}> {}

interface IDotyposAccessToken {
  readonly get: Effect.Effect<string, DotyposWireFailure>;
  /** Forgets a cached token that Dotypos no longer accepts. */
  readonly invalidate: Effect.Effect<void>;
}

interface IDotyposGeneratedClient {
  readonly client: DotyposClient;
}

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
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* DotyposRuntimeConfig;
      const httpClient = yield* HttpClient.HttpClient;
      const client = makeDotyposClient({ config, httpClient });
      const tokenCache = yield* Cache.makeWith(
        (_key: "access-token") =>
          client
            .getAccessToken({
              params: { Authorization: `User ${config.refreshToken}` },
              payload: { _cloudId: config.cloudId },
            })
            .pipe(
              Effect.map((response) => response.accessToken),
              Effect.mapError((error) =>
                toDotyposWireFailure(error, { fromAccessToken: true })
              )
            ),
        {
          capacity: 1,
          timeToLive: (exit) => (Exit.isSuccess(exit) ? "59 minutes" : 0),
        }
      );

      return {
        get: Cache.get(tokenCache, "access-token"),
        invalidate: Cache.invalidate(tokenCache, "access-token"),
      };
    })
  );
}

export class DotyposGeneratedClient extends Context.Service<
  DotyposGeneratedClient,
  IDotyposGeneratedClient
>()("@deskohub/dotypos/DotyposGeneratedClient") {
  static Default = Layer.effect(
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
        ),
        HttpClient.tap((response) =>
          Effect.when(
            accessToken.invalidate,
            Effect.succeed(response.status === 401)
          )
        )
      ) as HttpClient.HttpClient;

      return {
        client: make(authenticatedHttpClient),
      };
    })
  );
}

/**
 * Describes a failed Dotypos exchange. An access-token failure that surfaces
 * through the addressed request keeps its access-token origin.
 */
export const toDotyposWireFailure = (
  error: unknown,
  { fromAccessToken }: { readonly fromAccessToken: boolean }
): DotyposWireFailure => {
  if (error instanceof DotyposWireFailure) return error;

  if (HttpClientError.isHttpClientError(error)) {
    const reason = error.reason;
    if (
      Predicate.isTagged(reason, "TransportError") ||
      Predicate.isTagged(reason, "InvalidUrlError")
    ) {
      return new DotyposWireFailure({
        outcome: { kind: "transport" },
        fromAccessToken,
        cause: error,
      });
    }

    const providerErrorInput = Predicate.hasProperty(reason, "description")
      ? reason.description
      : undefined;
    return statusFailure({
      providerError: parseProviderError(
        Predicate.isString(providerErrorInput) ||
          Schema.is(ErrorResponse)(providerErrorInput)
          ? providerErrorInput
          : undefined
      ),
      status: error.response?.status,
      fromAccessToken,
    });
  }

  if (isGeneratedClientError(error)) {
    return statusFailure({
      providerError: parseProviderError(
        Predicate.isString(error.cause) || Schema.is(ErrorResponse)(error.cause)
          ? error.cause
          : undefined
      ),
      status: error.response.status,
      fromAccessToken,
    });
  }

  if (
    Predicate.isError(error) &&
    (error.name === "AbortError" ||
      error.message.includes("fetch") ||
      error.message.includes("ECONNREFUSED"))
  ) {
    return new DotyposWireFailure({
      outcome: { kind: "transport" },
      fromAccessToken,
      cause: error,
    });
  }

  const providerError = parseProviderError(
    Predicate.isString(error) || Schema.is(ErrorResponse)(error)
      ? error
      : undefined
  );
  if (providerError) {
    return statusFailure({
      providerError,
      status: providerError.code ?? 500,
      fromAccessToken,
    });
  }

  return new DotyposWireFailure({
    outcome: { kind: "unreadable" },
    fromAccessToken,
    cause: error,
  });
};

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

/**
 * A failure Dotypos answered with a status. It keeps only the parsed provider
 * error, never the request or response, as the cause.
 */
const statusFailure = ({
  providerError,
  status,
  fromAccessToken,
}: {
  readonly providerError: DotyposProviderError | undefined;
  readonly status: number | undefined;
  readonly fromAccessToken: boolean;
}) => {
  const httpStatus = status ?? providerError?.code;
  return new DotyposWireFailure({
    outcome:
      httpStatus === undefined
        ? { kind: "unreadable" }
        : { kind: "status", status: httpStatus, providerError },
    fromAccessToken,
    ...(providerError && { cause: providerError }),
  });
};
