import { Effect, Option, Ref, Schema } from "effect";
import { DotyposRuntimeConfig, type DotyposRuntimeConfigObj } from "../config";
import { ExternalAPIError, NetworkError, ValidationError } from "../errors";
import { createClient } from "../generated/client";
import * as generatedApi from "../generated/sdk.gen";
import type {
  CreateCustomerRequest,
  Customer,
  ErrorResponse,
  Product,
  TokenResponse,
  UpdateCustomerRequest,
  UpdateReservationRequest,
} from "../generated/types.gen";
import {
  zCategory,
  zCreateCustomerRequest,
  zCustomer,
  zTable,
  zTokenResponse,
} from "../generated/zod.gen";
import { injectReqResLogger } from "../utils/req-res-logger";

type DiscountGroup = {
  readonly id?: string | number;
  readonly discountPercent?: number | string | null;
};

interface TokenCache {
  token: string;
  expiresAt: number;
}

type ApiErrorViolation = {
  readonly path?: readonly string[];
  readonly message: string;
};

type TokenResult =
  | { readonly ok: true; readonly data: TokenResponse }
  | {
      readonly ok: false;
      readonly status?: number;
      readonly statusText?: string;
      readonly error: unknown;
    };

type GeneratedErrorResponse = {
  readonly error: ErrorResponse;
  readonly response: Pick<Response, "status" | "statusText">;
};

type ErrorResponseWithStatus = ErrorResponse & { readonly status: number };

const fetchUsingRequestInit: typeof fetch = Object.assign(
  async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ): Promise<Response> => {
    if (!(input instanceof Request)) return fetch(input, init);

    const body =
      input.method === "GET" || input.method === "HEAD"
        ? undefined
        : await input.clone().text();

    return fetch(input.url, {
      body,
      headers: input.headers,
      method: input.method,
      signal: input.signal,
      ...init,
    });
  },
  {
    preconnect: fetch.preconnect,
  }
);

const fetchAccessToken = async (
  config: DotyposRuntimeConfigObj,
  client: ReturnType<typeof createClient>
): Promise<TokenResult> => {
  try {
    const result = await generatedApi.getAccessToken({
      client,
      headers: { Authorization: `User ${config.refreshToken}` },
      body: { _cloudId: config.cloudId },
      signal: AbortSignal.timeout(config.apiTimeout),
    });
    if (result.error) {
      return {
        ok: false,
        status: result.response.status,
        statusText: result.response.statusText,
        error: result.error,
      };
    }

    const parsedBody = zTokenResponse.safeParse(result.data);
    if (!parsedBody.success) {
      return {
        ok: false,
        status: result.response.status,
        statusText: result.response.statusText,
        error: parsedBody.error,
      };
    }

    return { ok: true, data: parsedBody.data };
  } catch (error) {
    return { ok: false, error };
  }
};

export class DotyposApi extends Effect.Service<DotyposApi>()("DotyposApi", {
  effect: Effect.gen(function* () {
    const config = yield* DotyposRuntimeConfig;

    const client = createClient({
      baseUrl: config.apiUrl,
      fetch: fetchUsingRequestInit,
    });
    yield* injectReqResLogger(client);

    const tokenCacheRef = yield* Ref.make<TokenCache | null>(null);

    const getToken = (): Effect.Effect<
      string,
      ExternalAPIError | NetworkError
    > =>
      Effect.gen(function* () {
        const cached = yield* Ref.get(tokenCacheRef);
        if (cached && Date.now() < cached.expiresAt - 60000) {
          return cached.token;
        }

        const response = yield* Effect.tryPromise({
          try: async () => {
            const result = await fetchAccessToken(config, client);
            if (!result.ok) {
              Effect.runSync(
                Effect.logError("Dotypos access token request failed", {
                  status: result.status,
                  statusText: result.statusText,
                  error: result.error,
                })
              );
              throw result.error;
            }

            return result.data;
          },
          catch: (error) =>
            transformErrorResponse(error, "Authentication", config.apiUrl),
        });

        const newCache = {
          token: response.accessToken,
          expiresAt: Date.now() + 3600 * 1000,
        };
        yield* Ref.set(tokenCacheRef, newCache);
        return response.accessToken;
      }).pipe(Effect.withSpan("getAccessToken"));

    return {
      createReservation: Effect.fn("createReservation")(function* (params) {
        const token = yield* getToken();

        const requestBody = [params.body];

        return yield* Effect.tryPromise({
          try: async () => {
            const response = await generatedApi.createReservation(
              createApiOptions(token, config, client, {
                path: params.path,
                body: requestBody,
              })
            );

            if (response.error) {
              let errorMessage = "";
              const violations = getViolations(response.error);
              if (violations.length > 0) {
                const violationMessages = violations
                  .map(
                    (violation) =>
                      `${violation.path?.join(".")}: ${violation.message}`
                  )
                  .join(", ");
                errorMessage = `Validation failed: ${violationMessages}`;
              }

              throw withResponseStatus(response, {
                error_description: [
                  response.error.error_description,
                  errorMessage,
                ]
                  .filter(Boolean)
                  .join("\n"),
              });
            }

            const reservations = response.data;
            if (!reservations.length) {
              throw {
                code: 502,
                error: "Unexpected response format from reservation API",
                error_description:
                  "createReservation endpoint returned no reservations",
              } satisfies ErrorResponse;
            }

            return reservations[0]!;
          },
          catch: (error) =>
            transformErrorResponse(error, "Create reservation", config.apiUrl),
        });
      }),

      getReservation: Effect.fn("getReservation")(function* (params) {
        const token = yield* getToken();

        return yield* Effect.tryPromise({
          try: async () => {
            const response = await generatedApi.getReservation(
              createApiOptions(token, config, client, params)
            );

            if (response.error) throw withResponseStatus(response);

            return response.data;
          },
          catch: (error) =>
            transformErrorResponse(error, "Get reservation", config.apiUrl),
        });
      }),

      getReservationForUpdate: Effect.fn("getReservationForUpdate")(
        function* (params: {
          path: { cloudId: string; reservationId: string };
        }) {
          const token = yield* getToken();

          return yield* Effect.tryPromise({
            try: async () => {
              const response = await generatedApi.getReservation(
                createApiOptions(token, config, client, params)
              );

              if (response.error) throw withResponseStatus(response);

              return {
                reservation: response.data,
                etag: response.response.headers.get("etag") ?? undefined,
              };
            },
            catch: (error) =>
              transformErrorResponse(error, "Get reservation", config.apiUrl),
          });
        }
      ),

      cancelReservation: Effect.fn("cancelReservation")(function* (params: {
        path: { cloudId: string; reservationId: string };
      }) {
        const token = yield* getToken();

        return yield* Effect.tryPromise({
          try: async () => {
            const response = await generatedApi.cancelReservation(
              createApiOptions(token, config, client, params)
            );

            if (response.error) throw withResponseStatus(response);
          },
          catch: (error) =>
            transformErrorResponse(error, "Cancel reservation", config.apiUrl),
        });
      }),

      updateReservation: Effect.fn("updateReservation")(function* (params: {
        path: { cloudId: string; reservationId: string };
        body: UpdateReservationRequest;
      }) {
        const token = yield* getToken();

        return yield* Effect.tryPromise({
          try: async () => {
            const response = await generatedApi.updateReservation(
              createApiOptions(token, config, client, params)
            );

            if (response.error) throw withResponseStatus(response);

            return response.data;
          },
          catch: (error) =>
            transformErrorResponse(error, "Update reservation", config.apiUrl),
        });
      }),

      patchReservation: Effect.fn("patchReservation")(function* (params: {
        path: { cloudId: string; reservationId: string };
        headers: { "If-Match": string };
        body: UpdateReservationRequest;
      }) {
        const token = yield* getToken();

        return yield* Effect.tryPromise({
          try: async () => {
            const response = await generatedApi.patchReservation(
              createApiOptions(token, config, client, params)
            );

            if (response.error) throw withResponseStatus(response);

            return response.data;
          },
          catch: (error) =>
            transformErrorResponse(error, "Patch reservation", config.apiUrl),
        });
      }),

      listReservations: Effect.fn("listReservations")(function* (params: {
        path: { cloudId: string };
        query?: { page?: number; limit?: number };
      }) {
        const token = yield* getToken();

        return yield* Effect.tryPromise({
          try: async () => {
            const response = await generatedApi.listReservations(
              createApiOptions(token, config, client, {
                path: params.path,
                query: params.query || { limit: 100 },
              })
            );

            if (response.error) {
              if (response.response.status === 404) return [];
              throw withResponseStatus(response);
            }

            return response.data.data ?? [];
          },
          catch: (error) =>
            transformErrorResponse(error, "List reservations", config.apiUrl),
        });
      }),

      searchCustomers: Effect.fn("searchCustomers")(function* (params) {
        const token = yield* getToken();

        return yield* Effect.tryPromise({
          try: async (): Promise<Customer[]> => {
            const response = await generatedApi.getCustomers(
              createApiOptions(token, config, client, {
                path: params.path,
                query: params.query,
              })
            );

            if (response.error) {
              if (response.response.status === 404) return [];
              throw withResponseStatus(response);
            }

            return response.data.data || [];
          },
          catch: (error) =>
            transformErrorResponse(error, "Search customers", config.apiUrl),
        });
      }),

      createCustomer: (params: {
        path: { cloudId: string };
        body: CreateCustomerRequest;
      }): Effect.Effect<
        Customer,
        ExternalAPIError | NetworkError | ValidationError
      > =>
        Effect.gen(function* () {
          const token = yield* getToken();

          const body = zCreateCustomerRequest.safeParse(params.body);
          if (body.error)
            return yield* new ValidationError({
              message: "Invalid customer request",
              cause: body.error,
            });

          const requestBody = [body.data];

          const customer = yield* Effect.tryPromise(async () => {
            const response = await generatedApi.createCustomers(
              createApiOptions(token, config, client, {
                path: params.path,
                body: requestBody,
              })
            );

            if (response.error) throw withResponseStatus(response);

            const customers = response.data;
            if (!customers.length) {
              throw {
                code: 502,
                error: "Unexpected response format from customer API",
                error_description:
                  "createCustomer endpoint returned no customers",
              } satisfies ErrorResponse;
            }

            return customers[0]!;
          }).pipe(
            Effect.tapError(
              Effect.fn(function* (error) {
                yield* Effect.logError("Dotypos createCustomer failed", {
                  cause: error,
                  request: {
                    path: params.path,
                    body: requestBody,
                  },
                });
              })
            ),
            Effect.mapError((error) =>
              transformErrorResponse(error, "Create customer", config.apiUrl)
            )
          );

          return customer;
        }).pipe(Effect.withSpan("dotyposApi.createCustomer")),

      getCustomer: (params: {
        path: { cloudId: string; customerId: string };
      }) =>
        Effect.gen(function* () {
          const token = yield* getToken();

          return yield* Effect.tryPromise({
            try: async () => {
              const response = await generatedApi.getCustomer(
                createApiOptions(token, config, client, {
                  path: params.path,
                })
              );

              if (response.error) {
                throw withResponseStatus(response);
              }

              if (!response.data) {
                throw {
                  code: 502,
                  error: "Unexpected response format from customer API",
                  error_description:
                    "getCustomer endpoint returned no customer",
                } satisfies ErrorResponse;
              }

              const parsedCustomer = zCustomer.safeParse(response.data);
              if (!parsedCustomer.success) throw parsedCustomer.error;

              return parsedCustomer.data;
            },
            catch: (error) =>
              transformErrorResponse(error, "Get customer", config.apiUrl),
          });
        }).pipe(Effect.withSpan("dotyposApi.getCustomer")),

      updateCustomer: (params: {
        path: { cloudId: string; customerId: string };
        body: UpdateCustomerRequest;
      }) =>
        Effect.gen(function* () {
          const token = yield* getToken();

          return yield* Effect.tryPromise({
            try: async () => {
              const response = await generatedApi.updateCustomer(
                createApiOptions(token, config, client, {
                  path: params.path,
                  body: params.body,
                })
              );

              if (response.error) throw withResponseStatus(response);

              return response.data;
            },
            catch: (error) =>
              transformErrorResponse(error, "Update customer", config.apiUrl),
          });
        }).pipe(Effect.withSpan("dotyposApi.updateCustomer")),

      getTables: Effect.fn("getTables")(function* (params) {
        const token = yield* getToken();

        return yield* Effect.tryPromise({
          try: async () => {
            const response = await generatedApi.getTables(
              createApiOptions(token, config, client, {
                path: params.path,
                query: { limit: 100 },
              })
            );

            if (response.error) throw withResponseStatus(response);

            return parseArrayPageData(response.data, zTable.safeParse);
          },
          catch: (error) =>
            transformErrorResponse(error, "Get tables", config.apiUrl),
        });
      }),

      getProducts: Effect.fn("getProducts")(function* (params) {
        const token = yield* getToken();

        return yield* Effect.tryPromise({
          try: async (): Promise<Product[]> => {
            const response = await generatedApi.getProducts(
              createApiOptions(token, config, client, {
                path: params.path,
                query: params.query || { limit: 100 },
              })
            );

            if (response.error) throw withResponseStatus(response);

            return response.data.data || [];
          },
          catch: (error) =>
            transformErrorResponse(error, "Get products", config.apiUrl),
        });
      }),

      getCategories: Effect.fn("getCategories")(function* (params) {
        const token = yield* getToken();

        return yield* Effect.tryPromise({
          try: async () => {
            const response = await generatedApi.getCategories(
              createApiOptions(token, config, client, {
                path: params.path,
                query: params.query || { limit: 100 },
              })
            );

            if (response.error) throw withResponseStatus(response);

            return parseArrayPageData(response.data, zCategory.safeParse);
          },
          catch: (error) =>
            transformErrorResponse(error, "Get categories", config.apiUrl),
        });
      }),

      getDiscountGroup: Effect.fn("getDiscountGroup")(function* (params: {
        path: { cloudId: string; discountGroupId: string };
      }) {
        const token = yield* getToken();

        return yield* Effect.tryPromise({
          try: async (): Promise<DiscountGroup> => {
            const url = new URL(
              `clouds/${encodeURIComponent(
                params.path.cloudId
              )}/discount-groups/${encodeURIComponent(
                params.path.discountGroupId
              )}`,
              config.apiUrl.endsWith("/") ? config.apiUrl : `${config.apiUrl}/`
            );
            const response = await fetch(url, {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(config.apiTimeout),
            });

            if (!response.ok) {
              throw await readResponseError(response);
            }

            return parseDiscountGroup(await response.json());
          },
          catch: (error) =>
            transformErrorResponse(error, "Get discount group", config.apiUrl),
        });
      }),
    };
  }),
}) {}

const readResponseError = async (
  response: Response
): Promise<ErrorResponseWithStatus> => {
  const body = await response.json().catch(() => undefined);
  const parsedBody = Option.getOrUndefined(
    Schema.decodeUnknownOption(ErrorResponseSchema)(body)
  );

  if (parsedBody) {
    return {
      ...parsedBody,
      code: parsedBody.code ?? response.status,
      status: parsedBody.status ?? response.status,
    };
  }

  return {
    code: response.status,
    status: response.status,
    error: response.statusText,
    // Best-effort fallback detail; the status fields above remain authoritative.
    error_description: await response.text().catch(() => undefined),
  };
};

const withResponseStatus = (
  response: GeneratedErrorResponse,
  overrides: ErrorResponse = {}
): ErrorResponseWithStatus => ({
  ...response.error,
  ...overrides,
  error:
    overrides.error ?? response.error.error ?? response.response.statusText,
  code: overrides.code ?? response.error.code ?? response.response.status,
  status: response.response.status,
});

const ErrorResponseSchema = Schema.Struct({
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
  code: Schema.optional(Schema.Int),
  status: Schema.optional(Schema.Union(Schema.Int, Schema.NumberFromString)),
});

const transformErrorResponse = (
  error: unknown,
  operation: string,
  apiUrl: string
): ExternalAPIError | NetworkError => {
  if (error instanceof Error) {
    if (
      error.message.includes("fetch") ||
      error.message.includes("ECONNREFUSED")
    ) {
      return new NetworkError({
        message: "Failed to connect to Dotypos",
        cause: error,
        url: apiUrl,
      });
    }
  }

  const parseResult = Schema.decodeUnknownOption(ErrorResponseSchema)(error);
  if (parseResult._tag === "Some") {
    const { error, error_description, code, status } = parseResult.value;
    return new ExternalAPIError({
      service: "Dotypos",
      operation,
      statusCode: status ?? code ?? 500,
      message: error_description,
      cause: error,
    });
  }

  return new ExternalAPIError({
    service: "Dotypos",
    operation,
    cause: error,
  });
};

const ApiErrorViolationSchema = Schema.Struct({
  path: Schema.optional(Schema.Array(Schema.String)),
  message: Schema.String,
});

const ApiErrorViolationsSchema = Schema.Struct({
  violations: Schema.optional(Schema.Array(ApiErrorViolationSchema)),
});

const getViolations = (error: unknown): readonly ApiErrorViolation[] => {
  const parsedError = Option.getOrUndefined(
    Schema.decodeUnknownOption(ApiErrorViolationsSchema)(error)
  );

  return parsedError?.violations ?? [];
};

const ArrayPageDataSchema = Schema.Struct({
  data: Schema.Array(Schema.Unknown),
});

const DiscountGroupIdSchema = Schema.Union(Schema.String, Schema.Number);

const DiscountGroupDiscountPercentSchema = Schema.Union(
  Schema.String,
  Schema.Number,
  Schema.Null
);

const DiscountGroupPropertiesSchema = Schema.Struct({
  id: Schema.optional(Schema.Unknown),
  discountPercent: Schema.optional(Schema.Unknown),
});

const parseArrayPageData = <T>(
  data: unknown,
  parse: (
    value: unknown
  ) =>
    | { readonly success: true; readonly data: T }
    | { readonly success: false }
) => {
  const page = Option.getOrUndefined(
    Schema.decodeUnknownOption(ArrayPageDataSchema)(data)
  );
  if (!page) return [];

  return page.data.flatMap((item) => {
    const parsedItem = parse(item);
    return parsedItem.success ? [parsedItem.data] : [];
  });
};

const parseDiscountGroup = (value: unknown): DiscountGroup => {
  const properties = Option.getOrUndefined(
    Schema.decodeUnknownOption(DiscountGroupPropertiesSchema)(value)
  );
  if (!properties) return {};

  const id = Option.getOrUndefined(
    Schema.decodeUnknownOption(DiscountGroupIdSchema)(properties.id)
  );
  const discountPercent = Option.getOrUndefined(
    Schema.decodeUnknownOption(DiscountGroupDiscountPercentSchema)(
      properties.discountPercent
    )
  );

  return {
    ...(id !== undefined ? { id } : {}),
    ...(discountPercent !== undefined ? { discountPercent } : {}),
  };
};

type ApiCallOptions = {
  path?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
};

const createApiOptions = <T extends ApiCallOptions>(
  token: string,
  config: DotyposRuntimeConfigObj,
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
    Authorization: `Bearer ${token}`,
    ...options.headers,
  },
  signal: AbortSignal.timeout(config.apiTimeout),
});
