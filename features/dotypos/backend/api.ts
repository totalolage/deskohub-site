/**
 * Dotypos Effect Service
 *
 * This service wraps the generated OpenAPI client with Effect patterns
 * for better error handling and composition.
 */

import { Effect, Ref, Schema } from "effect";
import {
  DotyposConfig,
  type DotyposConfigObj,
} from "@/shared/backend/config/dotypos.config";
import { ExternalAPIError, NetworkError } from "@/shared/backend/errors";
import { createClient } from "../generated/client";
import * as generatedApi from "../generated/sdk.gen";
import type {
  Category,
  CreateCustomerRequest,
  Customer,
  ErrorResponse,
  Product,
  Table,
  UpdateCustomerRequest,
} from "../generated/types.gen";

/**
 * Extended error response type that includes validation violations
 * This is not part of the OpenAPI spec but is returned by the API
 */
interface ApiErrorWithViolations {
  error?: string;
  error_description?: string;
  code?: number;
  violations?: Array<{
    path?: string[];
    message: string;
  }>;
}

/**
 * Token cache type for managing authentication tokens
 */
interface TokenCache {
  token: string;
  expiresAt: number;
}

/**
 * Authenticated Dotypos API using Effect patterns
 */
export class DotyposApi extends Effect.Service<DotyposApi>()("DotyposApi", {
  effect: Effect.gen(function* () {
    const config = yield* DotyposConfig;

    // Create the client once
    const client = createClient({
      baseUrl: config.apiUrl,
    });

    // Thread-safe token cache using Ref
    const tokenCacheRef = yield* Ref.make<TokenCache | null>(null);

    // Helper to get a fresh token using Effect patterns
    const getToken = (): Effect.Effect<
      string,
      ExternalAPIError | NetworkError
    > =>
      Effect.gen(function* () {
        // Check cache
        const cached = yield* Ref.get(tokenCacheRef);
        if (cached && Date.now() < cached.expiresAt - 60000) {
          yield* Effect.logDebug("Using cached token");
          return cached.token;
        }

        yield* Effect.logDebug("Fetching new access token", {
          clientId: config.clientId,
          hasClientSecret: !!config.clientSecret,
          hasRefreshToken: !!config.refreshToken,
        });

        // Get new token using the client (SDK handles validation)
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

            if (result.error) throw result.error satisfies ErrorResponse;

            return result.data;
          },
          catch: (error) =>
            transformErrorResponse(error, "Authentication", config.apiUrl),
        }).pipe(
          Effect.tap(() => Effect.logInfo("Authentication successful")),
          Effect.tapError((error) =>
            Effect.logError("Authentication failed", error)
          )
        );

        // Update cache atomically
        const newCache = {
          token: response.accessToken,
          expiresAt: Date.now() + 3600 * 1000, // Default to 1 hour expiry
        };
        yield* Ref.set(tokenCacheRef, newCache);
        yield* Effect.logDebug("Token cached", {
          expiresIn: 3600,
        });
        return response.accessToken;
      }).pipe(Effect.withSpan("getAccessToken"));

    return {
      createReservation: Effect.fn("createReservation")(function* (params) {
        yield* Effect.logDebug("DotyposApi.createReservation called", params);

        const token = yield* getToken();

        // Remove null values from the body to prevent API validation errors
        const cleanBody = Object.fromEntries(
          Object.entries(params.body).filter(([_, value]) => value !== null)
        ) as typeof params.body;

        // The API expects an array of reservations
        const requestBody = [cleanBody]; // Wrap single reservation in array

        yield* Effect.logDebug("Sending request to Dotypos API", {
          url: `/clouds/${params.path.cloudId}/reservations`,
          path: params.path,
          body: requestBody,
          bodyStringified: JSON.stringify(requestBody),
        });

        const result = yield* Effect.tryPromise({
          try: async () => {
            // Creating reservation request
            const response = await generatedApi.createReservation(
              createApiOptions(token, config, client, {
                path: params.path,
                body: requestBody,
              })
            );

            // Process API response
            if (response.error) {
              // Handle validation violations if present

              // Extract error message from violations if available
              let errorMessage = "";
              const errorWithViolations =
                response.error as ApiErrorWithViolations;
              if (
                errorWithViolations.violations &&
                Array.isArray(errorWithViolations.violations)
              ) {
                const violationMessages = errorWithViolations.violations
                  .map((v) => `${v.path?.join(".")}: ${v.message}`)
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

            // The API returns an array, extract the first reservation
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
        }).pipe(
          Effect.tap((data) => Effect.logInfo("API call successful", data)),
          Effect.tapError((error) => Effect.logError("API call failed", error))
        );

        return result;
      }),

      getReservation: Effect.fn("getReservation")(function* (params) {
        const token = yield* getToken();

        // SDK handles response validation automatically
        const result = yield* Effect.tryPromise({
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

        return result;
      }),

      searchCustomers: Effect.fn("searchCustomers")(function* (params) {
        yield* Effect.logDebug("DotyposApi.searchCustomers called", params);

        const token = yield* getToken();

        const result = yield* Effect.tryPromise({
          try: async () => {
            // Search for customers

            const response = await generatedApi.getCustomers(
              createApiOptions(token, config, client, {
                path: params.path,
                query: params.query,
              })
            );

            if (response.error) throw response.error satisfies ErrorResponse;

            // Extract customers from paginated response
            if (
              response.data &&
              typeof response.data === "object" &&
              "data" in response.data
            ) {
              const customers = response.data.data || [];
              // Extracted customers from paginated response
              return customers as Customer[];
            }
            return [] as Customer[];
          },
          catch: (error) =>
            transformErrorResponse(error, "Search customers", config.apiUrl),
        }).pipe(
          Effect.tap((customers) =>
            Effect.logDebug(`Found ${customers.length} customers`)
          ),
          Effect.tapError((error) =>
            Effect.logError("Customer search failed", error)
          )
        );

        return result;
      }),

      createCustomer: (params: {
        path: { cloudId: string };
        body: CreateCustomerRequest;
      }) =>
        Effect.gen(function* () {
          yield* Effect.logDebug("DotyposApi.createCustomer called", params);

          const token = yield* getToken();

          // The API expects an array of customers with all fields present (including nulls)
          const requestBody = [params.body];

          // Creating customer

          const result = yield* Effect.tryPromise({
            try: async () => {
              const response = await generatedApi.createCustomers(
                createApiOptions(token, config, client, {
                  path: params.path,
                  body: requestBody,
                })
              );

              // Process customer creation response

              if (response.error) throw response.error satisfies ErrorResponse;

              // The API returns an array, extract the first customer
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
            },
            catch: (error) =>
              transformErrorResponse(error, "Create customer", config.apiUrl),
          });

          return result;
        }).pipe(Effect.withSpan("dotyposApi.createCustomer")),

      getCustomer: (params: {
        path: { cloudId: string; customerId: string };
      }) =>
        Effect.gen(function* () {
          yield* Effect.logDebug("DotyposApi.getCustomer called", params);

          const token = yield* getToken();

          const result = yield* Effect.tryPromise({
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

          return result;
        }).pipe(Effect.withSpan("dotyposApi.getCustomer")),

      updateCustomer: (params: {
        path: { cloudId: string; customerId: string };
        body: UpdateCustomerRequest;
      }) =>
        Effect.gen(function* () {
          yield* Effect.logDebug("DotyposApi.updateCustomer called", params);

          const token = yield* getToken();

          // Remove null values from the body to prevent API validation errors
          const cleanBody = Object.fromEntries(
            Object.entries(params.body).filter(([_, value]) => value !== null)
          ) as typeof params.body;

          const result = yield* Effect.tryPromise({
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

          return result;
        }).pipe(Effect.withSpan("dotyposApi.updateCustomer")),

      getTables: Effect.fn("getTables")(function* (params) {
        yield* Effect.logDebug("DotyposApi.getTables called", params);

        const token = yield* getToken();

        const result = yield* Effect.tryPromise({
          try: async () => {
            const response = await generatedApi.getTables(
              createApiOptions(token, config, client, {
                path: params.path,
                query: { limit: 100 },
              })
            );

            if (response.error) throw response.error satisfies ErrorResponse;

            // Extract tables from paginated response
            if (
              response.data &&
              typeof response.data === "object" &&
              "data" in response.data
            ) {
              const tables = response.data.data || [];
              // Extracted tables from paginated response
              return tables as Table[];
            }
            return [] as Table[];
          },
          catch: (error) =>
            transformErrorResponse(error, "Get tables", config.apiUrl),
        }).pipe(
          Effect.tap((tables) =>
            Effect.logDebug(`Fetched ${tables.length} tables`)
          ),
          Effect.tapError((error) =>
            Effect.logError("Failed to fetch tables", error)
          )
        );

        return result;
      }),

      getProducts: Effect.fn("getProducts")(function* (params) {
        yield* Effect.logDebug("DotyposApi.getProducts called", params);

        const token = yield* getToken();

        const result = yield* Effect.tryPromise({
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
        }).pipe(
          Effect.tap((products) =>
            Effect.logDebug(`Fetched ${products.length} products`)
          ),
          Effect.tapError((error) =>
            Effect.logError("Failed to fetch products", error)
          )
        );

        return result;
      }),

      getCategories: Effect.fn("getCategories")(function* (params) {
        yield* Effect.logDebug("DotyposApi.getCategories called", params);

        const token = yield* getToken();

        const result = yield* Effect.tryPromise({
          try: async () => {
            const response = await generatedApi.getCategories(
              createApiOptions(token, config, client, {
                path: params.path,
                query: params.query || { limit: 100 },
              })
            );

            if (response.error) throw response.error satisfies ErrorResponse;

            // Extract categories from paginated response
            if (
              response.data &&
              typeof response.data === "object" &&
              "data" in response.data
            ) {
              const categories = response.data.data || [];
              // Extracted categories from paginated response
              return categories as Category[];
            }
            return [] as Category[];
          },
          catch: (error) =>
            transformErrorResponse(error, "Get categories", config.apiUrl),
        }).pipe(
          Effect.tap((categories) =>
            Effect.logDebug(`Fetched ${categories.length} categories`)
          ),
          Effect.tapError((error) =>
            Effect.logError("Failed to fetch categories", error)
          )
        );

        return result;
      }),
    };
  }),
}) {}

/**
 * Schema for errors with status codes
 */
const ErrorResponseSchema = Schema.Struct({
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
  code: Schema.optional(Schema.Int),
});

/**
 * Transform unknown errors to domain errors using Schema validation
 */
const transformErrorResponse = (
  error: unknown,
  operation: string,
  apiUrl: string
): ExternalAPIError | NetworkError => {
  // Check if it's a network/fetch error
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

  // Try to parse as structured error with status code
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

  // Default error
  return new ExternalAPIError({
    service: "Dotypos",
    operation,
    cause: error,
  });
};

/**
 * Helper to create API call options with auth and timeout
 */
type ApiCallOptions = {
  path?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
};

const createApiOptions = <T extends ApiCallOptions>(
  token: string,
  config: DotyposConfigObj,
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
