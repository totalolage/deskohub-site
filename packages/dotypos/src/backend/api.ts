import { createHash } from "node:crypto";
import { Effect, Ref, Schema } from "effect";
import { DotyposRuntimeConfig, type DotyposRuntimeConfigObj } from "../config";
import { ExternalAPIError, NetworkError, ValidationError } from "../errors";
import { createClient } from "../generated/client";
import * as generatedApi from "../generated/sdk.gen";
import type {
  Category,
  CreateCustomerRequest,
  Customer,
  ErrorResponse,
  Product,
  Table,
  TokenResponse,
  UpdateCustomerRequest,
} from "../generated/types.gen";
import { zCreateCustomerRequest, zTokenResponse } from "../generated/zod.gen";
import { injectReqResLogger } from "../utils/req-res-logger";

type DiscountGroup = {
  readonly id?: string | number;
  readonly discountPercent?: number | string | null;
};

interface ApiErrorWithViolations {
  error?: string;
  error_description?: string;
  code?: number;
  violations?: Array<{
    path?: string[];
    message: string;
  }>;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

const secretFingerprint = (value: string) => ({
  length: value.length,
  sha256Prefix: createHash("sha256").update(value).digest("hex").slice(0, 12),
});

const dotyposAuthDiagnostics = (config: DotyposRuntimeConfigObj) => ({
  apiUrl: config.apiUrl,
  apiTimeout: config.apiTimeout,
  cloudId: config.cloudId,
  clientId: secretFingerprint(config.clientId),
  clientSecret: secretFingerprint(config.clientSecret),
  refreshToken: secretFingerprint(config.refreshToken),
});

type DirectTokenResult =
  | { readonly ok: true; readonly data: TokenResponse }
  | {
      readonly ok: false;
      readonly status?: number;
      readonly statusText?: string;
      readonly error: unknown;
    };

const fetchAccessTokenDirect = async (
  config: DotyposRuntimeConfigObj
): Promise<DirectTokenResult> => {
  try {
    const response = await fetch(`${config.apiUrl}/signin/token`, {
      method: "POST",
      headers: {
        Authorization: `User ${config.refreshToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ _cloudId: config.cloudId }),
      signal: AbortSignal.timeout(config.apiTimeout),
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : undefined;

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        error: body ?? text,
      };
    }

    const parsedBody = zTokenResponse.safeParse(body);
    if (!parsedBody.success) {
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
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
            const result = await generatedApi.getAccessToken({
              client,
              headers: {
                Authorization: `User ${config.refreshToken}`,
              },
              body: {
                _cloudId: config.cloudId,
              },
              signal: AbortSignal.timeout(config.apiTimeout),
            });

            if (result.error) {
              Effect.runSync(
                Effect.logError("Dotypos access token request failed", {
                  status: result.response.status,
                  statusText: result.response.statusText,
                  error: result.error,
                  config: dotyposAuthDiagnostics(config),
                })
              );
              const directResponse = await fetchAccessTokenDirect(config);
              if (directResponse.ok) return directResponse.data;

              Effect.runSync(
                Effect.logError("Dotypos direct access token request failed", {
                  status: directResponse.status,
                  statusText: directResponse.statusText,
                  error: directResponse.error,
                  config: dotyposAuthDiagnostics(config),
                })
              );
              throw result.error satisfies ErrorResponse;
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

        const cleanBody = Object.fromEntries(
          Object.entries(params.body).filter(([_, value]) => value !== null)
        ) as typeof params.body;
        const requestBody = [cleanBody];

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
              const errorWithViolations =
                response.error as ApiErrorWithViolations;
              if (Array.isArray(errorWithViolations.violations)) {
                const violationMessages = errorWithViolations.violations
                  .map(
                    (violation) =>
                      `${violation.path?.join(".")}: ${violation.message}`
                  )
                  .join(", ");
                errorMessage = `Validation failed: ${violationMessages}`;
              }

              throw {
                ...response.error,
                error_description: [
                  response.error.error_description,
                  errorMessage,
                ]
                  .filter(Boolean)
                  .join("\n"),
              } satisfies ErrorResponse;
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

            if (response.error) throw response.error satisfies ErrorResponse;

            return response.data;
          },
          catch: (error) =>
            transformErrorResponse(error, "Get reservation", config.apiUrl),
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
              throw response.error satisfies ErrorResponse;
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

            if (response.error) throw response.error satisfies ErrorResponse;

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

              if (!response.data || response.error) {
                throw response.error satisfies ErrorResponse;
              }

              return response.data as Customer;
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

          const cleanBody = Object.fromEntries(
            Object.entries(params.body).filter(([_, value]) => value !== null)
          ) as typeof params.body;

          return yield* Effect.tryPromise({
            try: async () => {
              const response = await generatedApi.updateCustomer(
                createApiOptions(token, config, client, {
                  path: params.path,
                  body: cleanBody,
                })
              );

              if (response.error) throw response.error satisfies ErrorResponse;

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

            if (response.error) throw response.error satisfies ErrorResponse;

            if (
              response.data &&
              typeof response.data === "object" &&
              "data" in response.data
            ) {
              return (response.data.data || []) as Table[];
            }

            return [] as Table[];
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

            if (response.error) throw response.error satisfies ErrorResponse;

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

            if (response.error) throw response.error satisfies ErrorResponse;

            if (
              response.data &&
              typeof response.data === "object" &&
              "data" in response.data
            ) {
              return (response.data.data || []) as Category[];
            }

            return [] as Category[];
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
            const baseUrl = config.apiUrl.replace(/\/$/, "");
            const response = await fetch(
              `${baseUrl}/clouds/${encodeURIComponent(
                params.path.cloudId
              )}/discount-groups/${encodeURIComponent(
                params.path.discountGroupId
              )}`,
              {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(config.apiTimeout),
              }
            );

            if (!response.ok) {
              throw await readResponseError(response);
            }

            return (await response.json()) as DiscountGroup;
          },
          catch: (error) =>
            transformErrorResponse(error, "Get discount group", config.apiUrl),
        });
      }),
    };
  }),
}) {}

const readResponseError = async (response: Response) => {
  const body = await response.json().catch(() => undefined);

  if (body && typeof body === "object") {
    return body;
  }

  return {
    code: response.status,
    error: response.statusText,
    error_description: await response.text().catch(() => undefined),
  } satisfies ErrorResponse;
};

const ErrorResponseSchema = Schema.Struct({
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
  code: Schema.optional(Schema.Int),
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
    const { error, error_description, code } = parseResult.value;
    return new ExternalAPIError({
      service: "Dotypos",
      operation,
      statusCode: code ?? 500,
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
