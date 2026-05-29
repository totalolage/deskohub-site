import { Effect, Schema } from "effect";
import { NexiRuntimeConfig, type NexiRuntimeConfigObj } from "../config";
import { ExternalAPIError, NetworkError } from "../errors";
import { createClient } from "../generated/client";
import * as generatedApi from "../generated/sdk.gen";
import type {
  CreateHostedPaymentPageRequest,
  ErrorResponse,
} from "../generated/types.gen";

export class NexiApi extends Effect.Service<NexiApi>()("NexiApi", {
  effect: Effect.gen(function* () {
    const config = yield* NexiRuntimeConfig;
    const baseUrl = getNexiApiBaseUrl(config.baseUrl);

    const client = createClient({
      baseUrl,
    });

    return {
      createHostedPaymentPage: Effect.fn("createHostedPaymentPage")(
        function* (params: {
          body: CreateHostedPaymentPageRequest;
          headers?: Record<string, string>;
        }) {
          return yield* Effect.tryPromise({
            try: async () => {
              const response = await generatedApi.createHostedPaymentPage(
                createApiOptions(config, client, {
                  body: params.body,
                  headers: params.headers,
                })
              );

              if (response.error) throw response.error satisfies ErrorResponse;

              return response.data;
            },
            catch: (error) =>
              transformErrorResponse(
                error,
                "Create hosted payment page",
                baseUrl
              ),
          });
        }
      ),

      getOrder: Effect.fn("getOrder")(function* (params: {
        path: { orderId: string };
        headers?: Record<string, string>;
      }) {
        return yield* Effect.tryPromise({
          try: async () => {
            const response = await generatedApi.getOrder(
              createApiOptions(config, client, {
                path: params.path,
                headers: params.headers,
              })
            );

            if (response.error) throw response.error satisfies ErrorResponse;

            return response.data;
          },
          catch: (error) => transformErrorResponse(error, "Get order", baseUrl),
        });
      }),
    };
  }),
}) {}

const ErrorResponseSchema = Schema.Struct({
  errors: Schema.optional(
    Schema.Array(
      Schema.Struct({
        code: Schema.optional(Schema.String),
        description: Schema.optional(Schema.String),
      })
    )
  ),
  status: Schema.optional(Schema.Int),
  error: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
});

const NEXI_API_PATH = "/api/phoenix-0.0/psp/api/v1";

const getNexiApiBaseUrl = (origin: string) =>
  new URL(NEXI_API_PATH, origin).toString().replace(/\/$/, "");

const transformErrorResponse = (
  error: unknown,
  operation: string,
  _apiUrl: string
): ExternalAPIError | NetworkError => {
  if (error instanceof Error) {
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

  const parseResult = Schema.decodeUnknownOption(ErrorResponseSchema)(error);
  if (parseResult._tag === "Some") {
    const { errors, status, error: errorCode, message } = parseResult.value;
    return new ExternalAPIError({
      service: "Nexi",
      operation,
      statusCode: status ?? 500,
      message: message ?? errors?.[0]?.description,
      cause: errors ?? errorCode,
    });
  }

  return new ExternalAPIError({
    service: "Nexi",
    operation,
  });
};

type ApiCallOptions = {
  path?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
};

const createApiOptions = <T extends ApiCallOptions>(
  config: NexiRuntimeConfigObj,
  client: ReturnType<typeof createClient>,
  options: T
): T & {
  client: ReturnType<typeof createClient>;
  headers: Record<string, string>;
  signal: AbortSignal;
} => ({
  ...options,
  client,
  headers: {
    "X-API-KEY": config.apiKey,
    ...options.headers,
  },
  signal: AbortSignal.timeout(config.apiTimeout),
});
