/**
 * Dotypos Effect Service
 *
 * This service wraps the generated OpenAPI client with Effect patterns
 * for better error handling and composition.
 */

import {
  Config,
  Context,
  Duration,
  Effect,
  Layer,
  Ref,
  Schedule,
  Schema,
} from "effect";
import type { BookingFormData } from "@/features/booking";
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

// Response validation is handled by the generated SDK
// Removed DotyposReservation import - using API types directly

/**
 * Dotypos Configuration Schema with validation
 */
const DotyposConfigSchema = Schema.Struct({
  clientId: Schema.NonEmptyString,
  clientSecret: Schema.NonEmptyString,
  refreshToken: Schema.NonEmptyString,
  cloudId: Schema.NonEmptyString,
  branchId: Schema.NonEmptyString,
  employeeId: Schema.NonEmptyString,
  apiUrl: Schema.NonEmptyString,
  apiTimeout: Schema.Number.pipe(
    Schema.positive(),
    Schema.annotations({ description: "API timeout in milliseconds" })
  ),
});

type DotyposConfig = Schema.Schema.Type<typeof DotyposConfigSchema>;

/**
 * Token cache type
 */
interface TokenCache {
  token: string;
  expiresAt: number;
}

class DotyposConfigTag extends Context.Tag("DotyposConfig")<
  DotyposConfigTag,
  DotyposConfig
>() {}

const ConfigLayer = Layer.effect(
  DotyposConfigTag,
  Effect.gen(function* () {
    yield* Effect.logDebug("Loading Dotypos configuration");
    const rawConfig = yield* Config.all({
      clientId: Config.string("DOTYPOS_CLIENT_ID"),
      clientSecret: Config.string("DOTYPOS_CLIENT_SECRET"),
      refreshToken: Config.string("DOTYPOS_REFRESH_TOKEN"),
      cloudId: Config.string("DOTYPOS_CLOUD_ID"),
      branchId: Config.string("DOTYPOS_BRANCH_ID").pipe(
        Config.withDefault("128665136") // Default to "Pokladna" branch
      ),
      employeeId: Config.string("DOTYPOS_EMPLOYEE_ID"),
      apiUrl: Config.string("DOTYPOS_API_URL").pipe(
        Config.withDefault("https://api.dotykacka.cz/v2")
      ),
      apiTimeout: Config.number("DOTYPOS_API_TIMEOUT").pipe(
        Config.withDefault(30000)
      ),
    });

    yield* Effect.logDebug("Raw config loaded", {
      clientId: rawConfig.clientId,
      hasClientSecret: !!rawConfig.clientSecret,
      hasRefreshToken: !!rawConfig.refreshToken,
      cloudId: rawConfig.cloudId,
      branchId: rawConfig.branchId,
      employeeId: rawConfig.employeeId,
      apiUrl: rawConfig.apiUrl,
      apiTimeout: rawConfig.apiTimeout,
    });

    // Validate config using Schema
    const config = yield* Schema.decodeUnknown(DotyposConfigSchema)(
      rawConfig
    ).pipe(
      Effect.tapError((error) =>
        Effect.logError("Configuration validation failed", error)
      ),
      Effect.mapError(
        (error) =>
          new ValidationError({
            message: `Invalid Dotypos configuration: ${error.message}`,
          })
      )
    );
    yield* Effect.logInfo("Dotypos configuration loaded successfully");
    return config;
  })
);

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
 * - Starts at 100ms, doubles each retry with jitter
 * - Maximum 3 retries
 * - Maximum total time: ~7 seconds
 */
const retryPolicy = Schedule.exponential("100 millis").pipe(
  Schedule.jittered,
  Schedule.either(Schedule.recurs(3)),
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
          yield* Effect.logDebug("Got access token");

          // The API expects an array of reservations
          const requestBody = [params.body]; // Wrap single reservation in array

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

              const response = await generatedApi.createReservation({
                client,
                path: params.path,
                body: requestBody,
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              });

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
                const errorWithViolations = response.error as any;
                if (
                  errorWithViolations.violations &&
                  Array.isArray(errorWithViolations.violations)
                ) {
                  const violationMessages = errorWithViolations.violations
                    .map((v: any) => `${v.path?.join(".")}: ${v.message}`)
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
          // Get token (retry is handled at the service level)
          const token = yield* getToken();

          // SDK handles response validation automatically
          const result = yield* Effect.tryPromise({
            try: async () => {
              const response = await generatedApi.getReservation({
                client,
                ...params,
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              });

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

              const response = await generatedApi.getCustomers({
                client,
                path: params.path,
                query: params.query,
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              });

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

          // The API expects an array of customers
          const requestBody = [params.body];

          console.log(
            "Creating customer with body:",
            JSON.stringify(requestBody, null, 2)
          );

          const result = yield* Effect.tryPromise({
            try: async () => {
              const response = await generatedApi.createCustomers({
                client,
                path: params.path,
                body: requestBody,
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              });

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

          const result = yield* Effect.tryPromise({
            try: async () => {
              const response = await generatedApi.updateCustomer({
                client,
                path: params.path,
                body: params.body,
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              });

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
              const response = await generatedApi.getTables({
                client,
                path: params.path,
                query: { limit: 100 },
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              });

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
            Effect.timeout(Duration.millis(config.apiTimeout)),
            Effect.retry(retryPolicy),
            // Map timeout error to NetworkError
            Effect.catchTag("TimeoutException", () =>
              Effect.gen(function* () {
                yield* Effect.logError("Request timed out", {
                  timeout: config.apiTimeout,
                });
                return yield* Effect.fail(
                  new NetworkError({
                    message: `Request timed out after ${config.apiTimeout}ms`,
                    url: config.apiUrl,
                  })
                );
              })
            ),
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
            Effect.timeout(Duration.millis(config.apiTimeout)),
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
            }),
            // Map timeout error to NetworkError
            Effect.catchTag("TimeoutException", () =>
              Effect.fail(
                new NetworkError({
                  message: `Request timed out after ${config.apiTimeout}ms`,
                  url: config.apiUrl,
                })
              )
            )
          ),

      findOrCreateCustomer: (customerData) =>
        Effect.gen(function* () {
          yield* Effect.logInfo("Finding or creating customer", customerData);

          // First, try to find existing customer by email or phone
          let existingCustomer: Customer | undefined;

          // Search by email if provided
          if (customerData.email) {
            yield* Effect.logDebug("Searching customer by email", {
              email: customerData.email,
            });
            // Try first without filter to get all customers, then filter locally
            const customers = yield* api
              .searchCustomers({
                path: { cloudId: config.cloudId },
                query: { limit: 100 }, // Get more customers to search through
              })
              .pipe(
                Effect.timeout(Duration.millis(config.apiTimeout)),
                Effect.retry(retryPolicy),
                Effect.catchTag("TimeoutException", () =>
                  Effect.fail(
                    new NetworkError({
                      message: `Request timed out after ${config.apiTimeout}ms`,
                      url: config.apiUrl,
                    })
                  )
                )
              );

            // Find exact email match
            existingCustomer = customers.find(
              (c) => c.email === customerData.email
            );
            if (existingCustomer) {
              yield* Effect.logInfo("Found existing customer by email", {
                customerId: existingCustomer.id,
                email: existingCustomer.email,
              });
            }
          }

          // If not found by email, try phone
          if (!existingCustomer && customerData.phone) {
            yield* Effect.logDebug("Searching customer by phone", {
              phone: customerData.phone,
            });
            const customers = yield* api
              .searchCustomers({
                path: { cloudId: config.cloudId },
                query: { limit: 100 },
              })
              .pipe(
                Effect.timeout(Duration.millis(config.apiTimeout)),
                Effect.retry(retryPolicy),
                Effect.catchTag("TimeoutException", () =>
                  Effect.fail(
                    new NetworkError({
                      message: `Request timed out after ${config.apiTimeout}ms`,
                      url: config.apiUrl,
                    })
                  )
                )
              );

            // Find exact phone match
            existingCustomer = customers.find(
              (c) => c.phone === customerData.phone
            );
            if (existingCustomer) {
              yield* Effect.logInfo("Found existing customer by phone", {
                customerId: existingCustomer.id,
                phone: existingCustomer.phone,
              });
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
                  Effect.timeout(Duration.millis(config.apiTimeout)),
                  Effect.retry(retryPolicy),
                  Effect.catchTag("TimeoutException", () =>
                    Effect.fail(
                      new NetworkError({
                        message: `Request timed out after ${config.apiTimeout}ms`,
                        url: config.apiUrl,
                      })
                    )
                  ),
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

          const newCustomerRequest: CreateCustomerRequest = {
            _cloudId: config.cloudId,
            firstName: customerData.firstName,
            lastName: customerData.lastName,
            email: customerData.email || "",
            phone: customerData.phone || "",
            addressLine1: "",
            addressLine2: "",
            city: "",
            zip: "",
            country: "",
            companyName: "",
            companyId: "",
            vatId: "",
            barcode: "",
            note: "",
            internalNote: "",
            hexColor: "#2196F3", // Default blue color
            headerPrint: "",
            tags: [],
            display: true,
            deleted: false,
            points: 0,
            flags: 0, // Required field according to BC1 changes
          };

          const newCustomer = yield* api
            .createCustomer({
              path: { cloudId: config.cloudId },
              body: newCustomerRequest,
            })
            .pipe(
              Effect.tap((customer) =>
                Effect.logInfo("Customer created successfully", {
                  customerId: customer.id,
                  name: `${customer.firstName} ${customer.lastName}`,
                })
              ),
              Effect.timeout(Duration.millis(config.apiTimeout)),
              Effect.retry(retryPolicy),
              Effect.catchTag("TimeoutException", () =>
                Effect.fail(
                  new NetworkError({
                    message: `Request timed out after ${config.apiTimeout}ms`,
                    url: config.apiUrl,
                  })
                )
              )
            );

          return newCustomer;
        }).pipe(Effect.withSpan("dotyposClient.findOrCreateCustomer")),

      getTables: () =>
        api
          .getTables({
            path: { cloudId: config.cloudId },
          })
          .pipe(
            Effect.timeout(Duration.millis(config.apiTimeout)),
            Effect.retry(retryPolicy),
            Effect.catchTag("TimeoutException", () =>
              Effect.fail(
                new NetworkError({
                  message: `Request timed out after ${config.apiTimeout}ms`,
                  url: config.apiUrl,
                })
              )
            )
          ),
    };
  })
);

/**
 * Complete Dotypos service layer
 */
export const DotyposServiceLive = DotyposClientLive.pipe(
  Layer.provide(DotyposApiLayer),
  Layer.provide(ConfigLayer)
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
  const parts: string[] = [];

  if (input.name) {
    parts.push(`Customer: ${input.name}`);
  }
  if (input.email) {
    parts.push(`Email: ${input.email}`);
  }
  if (input.phone) {
    parts.push(`Phone: ${input.phone}`);
  }
  if (input.duration) {
    parts.push(`Duration: ${input.duration}h`);
  }
  if (input.needsLargerTable) {
    parts.push(`Needs larger table: Yes`);
  }
  if (input.needsPrivateSpace) {
    parts.push(`Needs private space: Yes`);
  }
  if (input.specialRequests) {
    parts.push(input.specialRequests);
  }

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
    yield* Effect.logInfo("Creating reservation", {
      input,
      datetimeType: typeof input.datetime,
      isDate: input.datetime instanceof Date,
    });

    const client = yield* DotyposClient;
    yield* Effect.logDebug("Got DotyposClient", {
      cloudId: client.cloudId,
      branchId: client.branchId,
      employeeId: client.employeeId,
    });

    // Split customer name into first and last name
    const nameParts = input.name.trim().split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || nameParts[0] || "";

    // Try to find or create customer
    let customerId: string | null = null;
    try {
      const customer = yield* client.findOrCreateCustomer({
        firstName,
        lastName,
        email: input.email,
        phone: input.phone,
      });

      yield* Effect.logInfo("Got customer for reservation", {
        customerId: customer.id,
        customerName: `${customer.firstName} ${customer.lastName}`,
      });

      customerId = customer.id || null;
    } catch (error) {
      yield* Effect.logWarning(
        "Failed to find/create customer, proceeding without customer ID",
        error
      );
    }

    const note = buildNote(input);
    yield* Effect.logDebug("Built note", { note });

    // Select the best table based on preferences if not already selected
    let tableId: string | undefined;

    // Auto-select table based on preferences
    const tables = yield* client.getTables();
    const selection = selectBestTable({
      guestCount: input.guestCount,
      needsLargerTable: input.needsLargerTable,
      needsPrivateSpace: input.needsPrivateSpace,
      availableTables: tables,
    });

    if (selection) {
      tableId = selection.selectedTableId;
      yield* Effect.logInfo("Auto-selected table", {
        tableId,
        tableName: selection.selectedTableName,
        seats: selection.seats,
        reason: selection.reason,
      });
    } else {
      yield* Effect.logWarning("No suitable table found, using default");
      tableId = undefined;
    }

    // Build request with customer ID if available
    const request: CreateReservationRequest = {
      _branchId: parseInt(client.branchId),
      _cloudId: parseInt(client.cloudId),
      startDate: input.datetime.getTime(),
      endDate: input.datetime.getTime() + input.duration * 60 * 60 * 1000,
      seats: input.guestCount,
      status: "CONFIRMED",
      note: note,
      flags: 0, // Default flags value (required, cannot be null)
      ...(tableId && { _tableId: tableId }),
      // Only include these if we have valid values
      ...(customerId && { _customerId: customerId }),
      ...(client.employeeId && { _employeeId: client.employeeId }),
    } as CreateReservationRequest;

    yield* Effect.logDebug("Prepared CreateReservationRequest", request);

    const reservation = yield* client.createReservation(request);

    yield* Effect.logInfo("Received reservation response", reservation);

    // Store customer info in the note field for retrieval
    const enrichedReservation: Reservation = {
      ...reservation,
      note: buildNote(input), // Keep the full note with customer info
    };

    yield* Effect.logDebug("Returning Reservation", enrichedReservation);
    return enrichedReservation;
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
