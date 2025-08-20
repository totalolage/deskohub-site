/**
 * Dotypos Effect Service
 *
 * This service wraps the generated OpenAPI client with Effect patterns
 * for better error handling and composition.
 */

import { Context, Effect, Layer, Ref, Schedule, Schema } from "effect";
import type { BookingFormData } from "@/features/booking";
import {
  type DotyposConfig,
  DotyposConfigLayer,
  DotyposConfigTag,
} from "@/shared/backend/config/dotypos.config";
import {
  ExternalAPIError,
  NetworkError,
  ValidationError,
} from "@/shared/backend/errors";
import { createClient } from "../generated/client";
import * as generatedApi from "../generated/sdk.gen";
import type {
  CreateCustomerRequest,
  CreateReservationRequest,
  Customer,
  Reservation,
  Table,
  UpdateCustomerRequest,
} from "../generated/types.gen";
import { selectBestTable } from "../utils/table-selection";

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

// Response validation is handled by the generated SDK
// Removed DotyposReservation import - using API types directly

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
interface DotyposApi {
  readonly createReservation: (params: {
    path: { cloudId: string };
    body: CreateReservationRequest;
  }) => Effect.Effect<Reservation, ExternalAPIError | NetworkError>;

  readonly getReservation: (params: {
    path: { cloudId: string; reservationId: string };
  }) => Effect.Effect<Reservation, ExternalAPIError | NetworkError>;

  readonly searchCustomers: (params: {
    path: { cloudId: string };
    query?: { filter?: string; limit?: number; offset?: number };
  }) => Effect.Effect<Customer[], ExternalAPIError | NetworkError>;

  readonly createCustomer: (params: {
    path: { cloudId: string };
    body: CreateCustomerRequest;
  }) => Effect.Effect<Customer, ExternalAPIError | NetworkError>;

  readonly updateCustomer: (params: {
    path: { cloudId: string; customerId: string };
    body: UpdateCustomerRequest;
  }) => Effect.Effect<Customer, ExternalAPIError | NetworkError>;

  readonly getTables: (params: {
    path: { cloudId: string };
  }) => Effect.Effect<Table[], ExternalAPIError | NetworkError>;
}

class DotyposApiTag extends Context.Tag("DotyposApi")<
  DotyposApiTag,
  DotyposApi
>() {}

/**
 * Dotypos API Client Service
 */
class DotyposClient extends Context.Tag("DotyposClient")<
  DotyposClient,
  {
    readonly cloudId: string;
    readonly branchId: string;
    readonly employeeId: string;
    readonly createReservation: (
      request: CreateReservationRequest
    ) => Effect.Effect<
      Reservation,
      ExternalAPIError | NetworkError | ValidationError
    >;
    readonly getReservation: (
      id: string
    ) => Effect.Effect<
      Reservation,
      ExternalAPIError | NetworkError | ValidationError
    >;
    readonly findOrCreateCustomer: (customerData: {
      firstName: string;
      lastName: string;
      email?: string;
      phone?: string;
    }) => Effect.Effect<
      Customer,
      ExternalAPIError | NetworkError | ValidationError
    >;
    readonly getTables: () => Effect.Effect<
      Table[],
      ExternalAPIError | NetworkError | ValidationError
    >;
  }
>() {}

/**
 * Retry policy with exponential backoff and jitter
 * - Only retries on server errors (500+)
 * - Starts at 100ms, doubles each retry with jitter
 * - Maximum 3 retries
 * - Maximum total time: ~7 seconds
 */
const retryPolicy = Schedule.exponential("100 millis").pipe(
  Schedule.jittered,
  Schedule.either(Schedule.recurs(3)),
  Schedule.whileInput<ExternalAPIError | NetworkError>((error) => {
    // Only retry on server errors (500+) or network errors
    if (error._tag === "NetworkError") {
      return true;
    }
    if (error._tag === "ExternalAPIError" && error.statusCode >= 500) {
      return true;
    }
    return false;
  }),
  Schedule.map(() => void 0)
);

/**
 * Schema for errors with status codes
 */
const ErrorWithStatusCodeSchema = Schema.Struct({
  statusCode: Schema.Number,
  message: Schema.optional(Schema.String),
});

/**
 * Transform unknown errors to domain errors using Schema validation
 */
const transformHttpError = (
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
        message: `Failed to connect to Dotypos: ${error.message}`,
        url: apiUrl,
      });
    }
  }

  // Try to parse as structured error with status code
  const parseResult = Schema.decodeUnknownOption(ErrorWithStatusCodeSchema)(
    error
  );

  if (parseResult._tag === "Some") {
    const { statusCode, message } = parseResult.value;
    return new ExternalAPIError({
      service: "Dotypos",
      message: message || `${operation}: Request failed`,
      statusCode,
    });
  }

  // Default error
  return new ExternalAPIError({
    service: "Dotypos",
    message: `${operation} failed: ${String(error)}`,
    statusCode: 500,
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
  config: DotyposConfig,
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

/**
 * Create authenticated API layer
 */
const DotyposApiLayer = Layer.scoped(
  DotyposApiTag,
  Effect.gen(function* () {
    const config = yield* DotyposConfigTag;

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

            if (result.error) {
              throw {
                statusCode: result.response?.status || 401,
                message:
                  result.error.error_description ||
                  result.error.error ||
                  "Authentication failed",
              };
            }

            return result.data;
          },
          catch: (error) =>
            transformHttpError(error, "Authentication", config.apiUrl),
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

    // Create authenticated API using Effect patterns
    const api: DotyposApi = {
      createReservation: (params) =>
        Effect.gen(function* () {
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
              console.log(
                "Creating reservation with full URL:",
                `${config.apiUrl}/clouds/${params.path.cloudId}/reservations`
              );
              console.log(
                "Request body:",
                JSON.stringify(requestBody, null, 2)
              );

              const response = await generatedApi.createReservation(
                createApiOptions(token, config, client, {
                  path: params.path,
                  body: requestBody,
                })
              );

              console.log("Dotypos API response:", {
                status: response.response?.status,
                hasError: !!response.error,
                hasData: !!response.data,
                error: response.error,
                data: response.data,
              });

              if (response.error) {
                // Log validation violations if present
                if (
                  "violations" in response.error &&
                  response.error.violations
                ) {
                  console.error(
                    "Validation violations:",
                    JSON.stringify(response.error.violations, null, 2)
                  );
                }
                console.error("API error details", {
                  error: response.error,
                  status: response.response?.status,
                  responseBody: response.response?.body,
                  requestBody: requestBody,
                });

                // Extract error message from violations if available
                let errorMessage = "Failed to create reservation";
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
                } else if (response.error.error_description) {
                  errorMessage = response.error.error_description;
                } else if (response.error.error) {
                  errorMessage = response.error.error;
                }

                throw {
                  statusCode: response.response?.status || 400,
                  message: errorMessage,
                };
              }

              // The API returns an array, extract the first reservation
              const reservations = response.data;
              if (!Array.isArray(reservations) || reservations.length === 0) {
                throw {
                  statusCode: 500,
                  message: "Unexpected response format from reservation API",
                };
              }

              return reservations[0]!;
            },
            catch: (error) =>
              transformHttpError(error, "Create reservation", config.apiUrl),
          }).pipe(
            Effect.tap((data) => Effect.logInfo("API call successful", data)),
            Effect.tapError((error) =>
              Effect.logError("API call failed", error)
            )
          );

          return result;
        }).pipe(Effect.withSpan("dotyposApi.createReservation")),

      getReservation: (params) =>
        Effect.gen(function* () {
          const token = yield* getToken();

          // SDK handles response validation automatically
          const result = yield* Effect.tryPromise({
            try: async () => {
              const response = await generatedApi.getReservation(
                createApiOptions(token, config, client, params)
              );

              if (response.error) {
                // Create structured error object
                throw {
                  statusCode: response.response?.status || 400,
                  message:
                    response.error.error_description ||
                    response.error.error ||
                    "Failed to get reservation",
                };
              }

              return response.data;
            },
            catch: (error) =>
              transformHttpError(error, "Get reservation", config.apiUrl),
          });

          return result;
        }),

      searchCustomers: (params) =>
        Effect.gen(function* () {
          yield* Effect.logDebug("DotyposApi.searchCustomers called", params);

          const token = yield* getToken();

          const result = yield* Effect.tryPromise({
            try: async () => {
              console.log("Searching customers with params:", {
                path: params.path,
                query: params.query,
                url: `/clouds/${params.path.cloudId}/customers`,
              });

              const response = await generatedApi.getCustomers(
                createApiOptions(token, config, client, {
                  path: params.path,
                  query: params.query,
                })
              );

              console.log("Customer search response:", {
                hasError: !!response.error,
                hasData: !!response.data,
                dataLength:
                  response.data && "data" in response.data
                    ? response.data.data?.length
                    : 0,
                status: response.response?.status,
                error: response.error,
              });
              if (response.error && "violations" in response.error) {
                console.error(
                  "Filter violations:",
                  JSON.stringify(response.error.violations, null, 2)
                );
              }

              if (response.error) {
                throw {
                  statusCode: response.response?.status || 400,
                  message:
                    response.error.error_description ||
                    response.error.error ||
                    "Failed to search customers",
                };
              }

              // Extract customers from paginated response
              if (
                response.data &&
                typeof response.data === "object" &&
                "data" in response.data
              ) {
                const customers = response.data.data || [];
                console.log(
                  `Extracted ${customers.length} customers from paginated response`
                );
                return customers as Customer[];
              }
              return [] as Customer[];
            },
            catch: (error) =>
              transformHttpError(error, "Search customers", config.apiUrl),
          }).pipe(
            Effect.tap((customers) =>
              Effect.logDebug(`Found ${customers.length} customers`)
            ),
            Effect.tapError((error) =>
              Effect.logError("Customer search failed", error)
            )
          );

          return result;
        }).pipe(Effect.withSpan("dotyposApi.searchCustomers")),

      createCustomer: (params) =>
        Effect.gen(function* () {
          yield* Effect.logDebug("DotyposApi.createCustomer called", params);

          const token = yield* getToken();

          // The API expects an array of customers with all fields present (including nulls)
          const requestBody = [params.body];

          console.log(
            "Creating customer with body:",
            JSON.stringify(requestBody, null, 2)
          );

          const result = yield* Effect.tryPromise({
            try: async () => {
              const response = await generatedApi.createCustomers(
                createApiOptions(token, config, client, {
                  path: params.path,
                  body: requestBody,
                })
              );

              console.log("Create customer response:", {
                hasError: !!response.error,
                hasData: !!response.data,
                status: response.response?.status,
                error: response.error,
              });

              if (response.error) {
                console.error("Customer creation failed:", response.error);
                throw {
                  statusCode: response.response?.status || 400,
                  message:
                    response.error.error_description ||
                    response.error.error ||
                    "Failed to create customer",
                };
              }

              // The API returns an array, extract the first customer
              const customers = response.data;
              if (!Array.isArray(customers) || customers.length === 0) {
                throw {
                  statusCode: 500,
                  message: "Unexpected response format from customer API",
                };
              }

              return customers[0]!;
            },
            catch: (error) =>
              transformHttpError(error, "Create customer", config.apiUrl),
          });

          return result;
        }).pipe(Effect.withSpan("dotyposApi.createCustomer")),

      updateCustomer: (params) =>
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

              console.log("Update customer response:", {
                hasError: !!response.error,
                hasData: !!response.data,
                status: response.response?.status,
                error: response.error,
              });

              if (response.error) {
                console.error("Customer update failed:", response.error);
                throw {
                  statusCode: response.response?.status || 400,
                  message:
                    response.error.error_description ||
                    response.error.error ||
                    "Failed to update customer",
                };
              }

              return response.data;
            },
            catch: (error) =>
              transformHttpError(error, "Update customer", config.apiUrl),
          });

          return result;
        }).pipe(Effect.withSpan("dotyposApi.updateCustomer")),

      getTables: (params) =>
        Effect.gen(function* () {
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

              if (response.error) {
                throw {
                  statusCode: response.response?.status || 400,
                  message:
                    response.error.error_description ||
                    response.error.error ||
                    "Failed to get tables",
                };
              }

              // Extract tables from paginated response
              if (
                response.data &&
                typeof response.data === "object" &&
                "data" in response.data
              ) {
                const tables = response.data.data || [];
                console.log(
                  `Extracted ${tables.length} tables from paginated response`
                );
                return tables as Table[];
              }
              return [] as Table[];
            },
            catch: (error) =>
              transformHttpError(error, "Get tables", config.apiUrl),
          }).pipe(
            Effect.tap((tables) =>
              Effect.logDebug(`Fetched ${tables.length} tables`)
            ),
            Effect.tapError((error) =>
              Effect.logError("Failed to fetch tables", error)
            )
          );

          return result;
        }).pipe(Effect.withSpan("dotyposApi.getTables")),
    };

    return api;
  })
);

const DotyposClientLive = Layer.effect(
  DotyposClient,
  Effect.gen(function* () {
    const config = yield* DotyposConfigTag;
    const api = yield* DotyposApiTag;

    return {
      cloudId: config.cloudId,
      branchId: config.branchId,
      employeeId: config.employeeId,
      createReservation: (request: CreateReservationRequest) =>
        api
          .createReservation({
            path: { cloudId: config.cloudId },
            body: request,
          })
          .pipe(
            Effect.tap((res) => Effect.logDebug("API call successful", res)),
            Effect.tapError((error) =>
              Effect.logError("API call failed", error)
            ),
            Effect.retry(retryPolicy),
            Effect.withSpan("dotyposClient.createReservation")
          ),

      getReservation: (id: string) =>
        api
          .getReservation({
            path: {
              cloudId: config.cloudId,
              reservationId: id,
            },
          })
          .pipe(
            Effect.retry(retryPolicy),
            Effect.mapError((error) => {
              // Add special handling for 404
              if (
                error instanceof ExternalAPIError &&
                error.statusCode === 404
              ) {
                return new ValidationError({
                  message: `Reservation ${id} not found`,
                });
              }
              return error;
            })
          ),

      findOrCreateCustomer: (customerData) =>
        Effect.gen(function* () {
          yield* Effect.logInfo("Finding or creating customer", customerData);

          // Helper function to search customers by a specific field
          const searchByField = (fieldName: "email" | "phone", value: string) =>
            Effect.gen(function* () {
              const valueSanitized = value.replace(
                "|",
                encodeURIComponent("|")
              );
              const filter = `${fieldName}|like|${valueSanitized}`;
              yield* Effect.logDebug(
                `Searching by ${fieldName} with filter`,
                filter
              );

              return yield* api
                .searchCustomers({
                  path: { cloudId: config.cloudId },
                  query: {
                    limit: 100,
                    filter,
                  },
                })
                .pipe(
                  // Handle 404 as empty result (no customers found)
                  Effect.catchIf(
                    (error) =>
                      error instanceof ExternalAPIError &&
                      error.statusCode === 404,
                    () => Effect.succeed([] as Customer[])
                  ),
                  // Only retry if not a 404
                  Effect.retry(
                    Schedule.exponential("100 millis").pipe(
                      Schedule.jittered,
                      Schedule.either(Schedule.recurs(2)),
                      Schedule.whileInput(
                        (error) =>
                          !(
                            error instanceof ExternalAPIError &&
                            error.statusCode === 404
                          )
                      )
                    )
                  )
                );
            });

          let existingCustomer: Customer | undefined;
          const matchingCustomers: Customer[] = [];

          // Search by email if provided
          if (customerData.email) {
            const customersByEmail = yield* searchByField(
              "email",
              customerData.email
            );
            const emailMatch = customersByEmail.find(
              (c) => c.email === customerData.email
            );
            if (emailMatch) {
              matchingCustomers.push(emailMatch);
            }
          }

          // Search by phone if provided (independent of email search)
          if (customerData.phone) {
            const customersByPhone = yield* searchByField(
              "phone",
              customerData.phone
            );
            const phoneMatch = customersByPhone.find(
              (c) => c.phone === customerData.phone
            );
            if (phoneMatch) {
              // Only add if not already found by email (avoid duplicates)
              if (!matchingCustomers.find((c) => c.id === phoneMatch.id)) {
                matchingCustomers.push(phoneMatch);
              }
            }
          }

          // If we found any matching customers, use the first one
          if (matchingCustomers.length > 0) {
            existingCustomer = matchingCustomers[0]!;

            const matchedBy: string[] = [];
            if (existingCustomer.email === customerData.email)
              matchedBy.push("email");
            if (existingCustomer.phone === customerData.phone)
              matchedBy.push("phone");

            yield* Effect.logInfo("Found existing customer", {
              customerId: existingCustomer.id,
              matchedBy: matchedBy.join(" and "),
              totalMatchesFound: matchingCustomers.length,
            });

            if (matchingCustomers.length > 1) {
              yield* Effect.logWarning(
                "Multiple customers found matching criteria",
                {
                  customerIds: matchingCustomers.map((c) => c.id),
                  usingCustomerId: existingCustomer.id,
                }
              );
            }
          }

          // If customer exists, check if it needs updating
          if (existingCustomer) {
            // Check if any fields are missing that we now have
            const needsUpdate =
              (customerData.email && !existingCustomer.email) ||
              (customerData.phone && !existingCustomer.phone) ||
              (customerData.firstName && !existingCustomer.firstName) ||
              (customerData.lastName && !existingCustomer.lastName);

            if (needsUpdate) {
              yield* Effect.logInfo(
                "Updating existing customer with new information",
                {
                  customerId: existingCustomer.id,
                  existingEmail: existingCustomer.email,
                  newEmail: customerData.email,
                  existingPhone: existingCustomer.phone,
                  newPhone: customerData.phone,
                }
              );

              // Build update request with only new/missing fields
              const updateRequest: UpdateCustomerRequest = {};

              if (customerData.email && !existingCustomer.email) {
                updateRequest.email = customerData.email;
              }
              if (customerData.phone && !existingCustomer.phone) {
                updateRequest.phone = customerData.phone;
              }
              if (customerData.firstName && !existingCustomer.firstName) {
                updateRequest.firstName = customerData.firstName;
              }
              if (customerData.lastName && !existingCustomer.lastName) {
                updateRequest.lastName = customerData.lastName;
              }

              const updatedCustomer = yield* api
                .updateCustomer({
                  path: {
                    cloudId: config.cloudId,
                    customerId: existingCustomer.id!,
                  },
                  body: updateRequest,
                })
                .pipe(
                  Effect.tap((customer) =>
                    Effect.logInfo("Customer updated successfully", {
                      customerId: customer.id,
                      updatedFields: Object.keys(updateRequest),
                    })
                  ),
                  Effect.retry(retryPolicy),
                  // If update fails, return the existing customer anyway
                  Effect.orElse(() =>
                    Effect.gen(function* () {
                      yield* Effect.logWarning(
                        "Failed to update customer, using existing data",
                        {
                          customerId: existingCustomer!.id,
                        }
                      );
                      return existingCustomer!;
                    })
                  )
                );

              return updatedCustomer;
            }

            return existingCustomer;
          }

          // Create new customer
          yield* Effect.logInfo("Creating new customer", customerData);

          const newCustomer = yield* api
            .createCustomer({
              path: { cloudId: config.cloudId },
              body: {
                _cloudId: config.cloudId,
                firstName: customerData.firstName,
                lastName: customerData.lastName,
                email: customerData.email || null,
                phone: customerData.phone || null,
                addressLine1: "",
                addressLine2: null,
                city: null,
                zip: "",
                country: null,
                companyName: "",
                vatId: "",
                note: null,
                display: true,
                deleted: false,
                points: 0,
                internalNote: "",
                companyId: "",
                hexColor: "#2196F3",
                headerPrint: "",
                tags: [],
                barcode: "",
                flags: 0,
              },
            })
            .pipe(
              Effect.tap((customer) =>
                Effect.logInfo("Customer created successfully", {
                  customerId: customer.id,
                  name: `${customer.firstName} ${customer.lastName}`,
                })
              ),
              Effect.retry(retryPolicy)
            );

          return newCustomer;
        }).pipe(Effect.withSpan("dotyposClient.findOrCreateCustomer")),

      getTables: () =>
        api
          .getTables({
            path: { cloudId: config.cloudId },
          })
          .pipe(Effect.retry(retryPolicy)),
    };
  })
);

/**
 * Complete Dotypos service layer
 */
export const DotyposServiceLive = DotyposClientLive.pipe(
  Layer.provide(DotyposApiLayer),
  Layer.provide(DotyposConfigLayer)
);

// Export for use in service functions
export { DotyposClient, DotyposConfigTag };

/**
 * High-level service functions
 */

/**
 * Build note field with customer information and metadata
 */
const buildNote = (input: BookingFormData): string => {
  const parts = [
    input.name && `Customer: ${input.name}`,
    input.email && `Email: ${input.email}`,
    input.phone && `Phone: ${input.phone}`,
    input.duration && `Duration: ${input.duration}h`,
    input.needsLargerTable && `Needs larger table: Yes`,
    input.needsPrivateSpace && `Needs private space: Yes`,
    input.specialRequests,
  ].filter(Boolean);

  return parts.join(" | ");
};

/**
 * Parsed note data type
 */
interface ParsedNote {
  customerName: string | null;
  customerEmail?: string;
  customerPhone?: string;
  duration?: number;
  tablePreference?: string;
  specialRequests?: string;
}

/**
 * Note field parser using regex patterns
 */
const NOTE_PATTERNS = {
  customer: /Customer: ([^|]+)/,
  email: /Email: ([^|]+)/,
  phone: /Phone: ([^|]+)/,
  duration: /Duration: (\d+)h/,
  tablePreference: /Table preference: ([^|]+)/,
} as const;

/**
 * Parse customer info and metadata from note field
 */
const parseNote = (note: string | undefined): ParsedNote => {
  if (!note) {
    return {
      customerName: null,
      customerEmail: undefined,
      customerPhone: undefined,
      duration: undefined,
      tablePreference: undefined,
      specialRequests: undefined,
    };
  }

  // Extract structured fields
  const extract = (pattern: RegExp) => note.match(pattern)?.[1]?.trim();

  const customerName = extract(NOTE_PATTERNS.customer) || null;
  const customerEmail = extract(NOTE_PATTERNS.email);
  const customerPhone = extract(NOTE_PATTERNS.phone);
  const durationMatch = extract(NOTE_PATTERNS.duration);
  const tablePreference = extract(NOTE_PATTERNS.tablePreference);

  // Special requests is everything after the last structured field
  const parts = note.split("|");
  const lastPart = parts[parts.length - 1]?.trim();
  const isStructuredField =
    lastPart &&
    Object.values(NOTE_PATTERNS).some((pattern) => pattern.test(lastPart));
  const specialRequests = !isStructuredField ? lastPart : undefined;

  return {
    customerName,
    customerEmail,
    customerPhone,
    duration: durationMatch ? parseInt(durationMatch) : undefined,
    tablePreference,
    specialRequests,
  };
};

/**
 * Create a reservation
 */
export const createReservation = (
  input: BookingFormData
): Effect.Effect<
  Reservation,
  ExternalAPIError | NetworkError | ValidationError,
  DotyposClient
> =>
  Effect.gen(function* () {
    yield* Effect.logInfo("Creating reservation", input);

    const client = yield* DotyposClient;

    // Simple name splitting - just first and rest
    const [firstName = "", ...lastNameParts] = input.name.trim().split(/\s+/);
    const lastName = lastNameParts.join(" ") || firstName;

    // Find or create customer (required for reservation)
    const customer = yield* client.findOrCreateCustomer({
      firstName,
      lastName,
      email: input.email,
      phone: input.phone,
    });

    if (!customer.id) {
      return yield* Effect.fail(
        new ValidationError({
          message: "Failed to create or find customer",
        })
      );
    }

    yield* Effect.logInfo("Customer resolved", { customerId: customer.id });

    // Build note once
    const note = buildNote(input);

    // Auto-select table based on preferences
    const tables = yield* client.getTables();
    const selection = selectBestTable({
      guestCount: input.guestCount,
      needsLargerTable: input.needsLargerTable,
      needsPrivateSpace: input.needsPrivateSpace,
      availableTables: tables,
    });

    const tableId = selection?.selectedTableId;
    if (selection) {
      yield* Effect.logInfo("Table selected", {
        tableId,
        tableName: selection.selectedTableName,
        seats: selection.seats,
      });
    }

    // Build request with required customer ID
    const request: CreateReservationRequest = {
      _branchId: client.branchId,
      _cloudId: client.cloudId,
      _customerId: customer.id,
      startDate: input.datetime.getTime(),
      endDate: input.datetime.getTime() + input.duration * 60 * 60 * 1000,
      seats: input.guestCount,
      status: "NEW",
      note,
      flags: 0,
      ...(tableId && { _tableId: tableId }),
      ...(client.employeeId && { _employeeId: client.employeeId }),
    };

    const reservation = yield* client.createReservation(request);
    yield* Effect.logInfo("Reservation created", { id: reservation.id });

    return reservation;
  }).pipe(
    Effect.withSpan("createReservation", {
      attributes: {
        "reservation.customerName": input.name,
        "reservation.guestCount": input.guestCount,
      },
    })
  );

/**
 * Table option for UI
 */
export interface TableOption {
  label: string;
  value: string; // Table ID
  seats: number;
  tableNumbers: string[]; // List of table names/numbers
}

/**
 * Get available tables organized by capacity
 */
export const getAvailableTables = (): Effect.Effect<
  TableOption[],
  ExternalAPIError | NetworkError | ValidationError,
  DotyposClient
> =>
  Effect.gen(function* () {
    const client = yield* DotyposClient;
    const tables = yield* client.getTables();

    // Filter to only enabled and displayed tables
    const availableTables = tables.filter((t) => t.enabled && t.display);

    // Group tables by seat count
    const tablesBySeats = new Map<number, Set<Table>>();

    for (const table of availableTables) {
      if (table.seats == null) continue;
      const seats =
        typeof table.seats === "number"
          ? table.seats
          : parseInt(String(table.seats));
      const tablesSet = tablesBySeats.get(seats) ?? new Set<Table>();
      tablesSet.add(table);
      tablesBySeats.set(seats, tablesSet);
    }

    // Create options
    const options: TableOption[] = [];

    // Add regular capacity groups
    for (const [seats, tablesGroup] of tablesBySeats.entries()) {
      // Skip DnD table from regular groups
      const regularTables = Array.from(tablesGroup).filter(
        (t) => t.name.toLowerCase() !== "dnd"
      );

      if (regularTables.length > 0) {
        // Sort tables by name for consistent ordering
        regularTables.sort((a, b) => {
          const aNum = parseInt(a.name) || 999;
          const bNum = parseInt(b.name) || 999;
          return aNum - bNum;
        });

        options.push({
          label: `Table for ${seats} players`,
          value: regularTables[0]?.id ?? "", // Use first table as default
          seats,
          tableNumbers: regularTables.map((t) => t.name),
        });
      }
    }

    // Add DnD table as special option if it exists
    const dndTable = availableTables.find(
      (t) => t.name.toLowerCase() === "dnd"
    );
    if (dndTable?.id && dndTable?.seats) {
      const dndSeats =
        typeof dndTable.seats === "number"
          ? dndTable.seats
          : parseInt(String(dndTable.seats));
      options.push({
        label: `DnD (${dndSeats} players)`,
        value: dndTable.id,
        seats: dndSeats,
        tableNumbers: [dndTable.name],
      });
    }

    // Sort options by seat count (except DnD which goes last)
    options.sort((a, b) => {
      if (a.label.includes("DnD")) return 1;
      if (b.label.includes("DnD")) return -1;
      return a.seats - b.seats;
    });

    yield* Effect.logInfo("Available table options", {
      count: options.length,
      options: options.map((o) => ({
        label: o.label,
        seats: o.seats,
        tables: o.tableNumbers,
      })),
    });

    return options;
  }).pipe(Effect.withSpan("getAvailableTables"));

/**
 * Get a reservation by ID
 */
export const getReservation = (
  id: string
): Effect.Effect<
  Reservation,
  ExternalAPIError | NetworkError | ValidationError,
  DotyposClient
> =>
  Effect.gen(function* () {
    const client = yield* DotyposClient;
    const reservation = yield* client.getReservation(id);

    // Just validate that we have customer info in the note
    const parsedNote = parseNote(reservation.note ?? undefined);
    if (!parsedNote.customerName) {
      return yield* Effect.fail(
        new ValidationError({
          message: `Reservation ${id} has no customer information`,
        })
      );
    }

    // Return the raw reservation - parsing will happen at display time
    return reservation;
  });
