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
import {
  ExternalAPIError,
  NetworkError,
  ValidationError,
} from "@/shared/backend/errors";
import { createClient } from "../generated/client";
import * as generatedApi from "../generated/sdk.gen";
import type {
  CreateReservationRequest,
  Reservation,
  Customer,
  CreateCustomerRequest,
} from "../generated/types.gen";
// Response validation is handled by the generated SDK
import type { DotyposReservation } from "../types";

/**
 * Dotypos Configuration Schema with validation
 */
const DotyposConfigSchema = Schema.Struct({
  clientId: Schema.NonEmptyString,
  clientSecret: Schema.NonEmptyString,
  refreshToken: Schema.NonEmptyString,
  cloudId: Schema.NonEmptyString,
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
    readonly findOrCreateCustomer: (
      customerData: {
        firstName: string;
        lastName: string;
        email?: string;
        phone?: string;
      }
    ) => Effect.Effect<
      Customer,
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
            path: params.path,
            body: requestBody,
            bodyStringified: JSON.stringify(requestBody),
          });

          const result = yield* Effect.tryPromise({
            try: async () => {
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
                if (response.error.violations) {
                  console.error("Validation violations:", JSON.stringify(response.error.violations, null, 2));
                }
                console.error("API error details", {
                  error: response.error,
                  status: response.response?.status,
                  responseBody: response.response?.body,
                });
                throw {
                  statusCode: response.response?.status || 400,
                  message:
                    response.error.error_description ||
                    response.error.error ||
                    "Failed to create reservation",
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
              
              return reservations[0];
            },
            catch: (error) =>
              transformHttpError(error, "Create reservation", config.apiUrl),
          }).pipe(
            Effect.tap((data) => 
              Effect.logInfo("API call successful", data)
            ),
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
                dataLength: response.data?.length,
                status: response.response?.status,
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

              return response.data || [];
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
              
              if (response.error) {
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
              
              return customers[0];
            },
            catch: (error) =>
              transformHttpError(error, "Create customer", config.apiUrl),
          });

          return result;
        }).pipe(Effect.withSpan("dotyposApi.createCustomer")),
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
      employeeId: config.employeeId,
      createReservation: (request: CreateReservationRequest) =>
        api
          .createReservation({
            path: { cloudId: config.cloudId },
            body: request,
          })
          .pipe(
            Effect.tap((res) =>
              Effect.logDebug("API call successful", res)
            ),
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
            yield* Effect.logDebug("Searching customer by email", { email: customerData.email });
            const customers = yield* api.searchCustomers({
              path: { cloudId: config.cloudId },
              query: { filter: customerData.email, limit: 10 }
            }).pipe(
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
            existingCustomer = customers.find(c => c.email === customerData.email);
            if (existingCustomer) {
              yield* Effect.logInfo("Found existing customer by email", { 
                customerId: existingCustomer.id,
                email: existingCustomer.email 
              });
            }
          }
          
          // If not found by email, try phone
          if (!existingCustomer && customerData.phone) {
            yield* Effect.logDebug("Searching customer by phone", { phone: customerData.phone });
            const customers = yield* api.searchCustomers({
              path: { cloudId: config.cloudId },
              query: { filter: customerData.phone, limit: 10 }
            }).pipe(
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
            existingCustomer = customers.find(c => c.phone === customerData.phone);
            if (existingCustomer) {
              yield* Effect.logInfo("Found existing customer by phone", { 
                customerId: existingCustomer.id,
                phone: existingCustomer.phone 
              });
            }
          }
          
          // If customer exists, return it
          if (existingCustomer) {
            return existingCustomer;
          }
          
          // Create new customer
          yield* Effect.logInfo("Creating new customer", customerData);
          
          const newCustomerRequest: CreateCustomerRequest = {
            _cloudId: parseInt(config.cloudId),
            firstName: customerData.firstName,
            lastName: customerData.lastName,
            email: customerData.email,
            phone: customerData.phone,
            display: true,
            deleted: false,
            points: 0,
            flags: 0, // Required field according to BC1 changes
          };
          
          const newCustomer = yield* api.createCustomer({
            path: { cloudId: config.cloudId },
            body: newCustomerRequest
          }).pipe(
            Effect.tap((customer) =>
              Effect.logInfo("Customer created successfully", { 
                customerId: customer.id,
                name: `${customer.firstName} ${customer.lastName}`
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

// Simple type without Effect Schema validation (validation happens in Zod schema)
export interface ReservationInput {
  datetime: Date;
  duration: number;
  guestCount: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  tablePreference?: string;
  specialRequests?: string;
}

/**
 * Build note field with customer information and metadata
 */
const buildNote = (input: ReservationInput): string => {
  const parts: string[] = [];

  if (input.customerName) {
    parts.push(`Customer: ${input.customerName}`);
  }
  if (input.customerEmail) {
    parts.push(`Email: ${input.customerEmail}`);
  }
  if (input.customerPhone) {
    parts.push(`Phone: ${input.customerPhone}`);
  }
  if (input.duration) {
    parts.push(`Duration: ${input.duration}h`);
  }
  if (input.tablePreference) {
    parts.push(`Table preference: ${input.tablePreference}`);
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
  input: ReservationInput
): Effect.Effect<
  DotyposReservation,
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
      employeeId: client.employeeId
    });
    
    // TODO: Customer integration disabled temporarily due to API issues
    // The customer endpoints return 400 errors - need to investigate with Dotypos
    /*
    // Split customer name into first and last name
    const nameParts = input.customerName.trim().split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || nameParts[0] || "";
    
    const customer = yield* client.findOrCreateCustomer({
      firstName,
      lastName,
      email: input.customerEmail,
      phone: input.customerPhone,
    });
    
    yield* Effect.logInfo("Got customer for reservation", {
      customerId: customer.id,
      customerName: `${customer.firstName} ${customer.lastName}`,
    });
    */
    
    const note = buildNote(input);
    yield* Effect.logDebug("Built note", { note });

    // Build request with only required fields
    // Omit _customerId, _employeeId, _tableId if they're not available
    const request: CreateReservationRequest = {
      _branchId: 1, // Default branch
      _cloudId: parseInt(client.cloudId),
      startDate: input.datetime.getTime(),
      endDate: input.datetime.getTime() + input.duration * 60 * 60 * 1000,
      seats: input.guestCount,
      status: "CONFIRMED",
      note: note,
      flags: 0, // Default flags value (required, cannot be null)
      // TODO: Add these when we have valid IDs:
      // _customerId: customerId,
      // _employeeId: parseInt(client.employeeId),
      // _tableId: tableId,
    } as CreateReservationRequest;
    
    yield* Effect.logDebug("Prepared CreateReservationRequest", request);

    const reservation = yield* client.createReservation(request);
    
    yield* Effect.logInfo("Received reservation response", reservation);

    const result = {
      id: String(reservation.id),
      status: "confirmed" as const,
      createdAt: reservation.created
        ? new Date(reservation.created)
        : new Date(),
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      datetime: input.datetime,
      guestCount: input.guestCount,
      specialRequests: input.specialRequests,
    };
    
    yield* Effect.logDebug("Returning DotyposReservation", result);
    return result;
  }).pipe(
    Effect.withSpan("createReservation", {
      attributes: {
        "reservation.customerName": input.customerName,
        "reservation.guestCount": input.guestCount,
      },
    })
  );

/**
 * Get a reservation by ID
 */
export const getReservation = (
  id: string
): Effect.Effect<
  DotyposReservation,
  ExternalAPIError | NetworkError | ValidationError,
  DotyposClient
> =>
  Effect.gen(function* () {
    const client = yield* DotyposClient;
    const reservation = yield* client.getReservation(id);

    const parsedNote = parseNote(reservation.note);

    if (!parsedNote.customerName) {
      return yield* Effect.fail(
        new ValidationError({
          message: `Reservation ${id} has no customer information`,
        })
      );
    }

    // Calculate duration from startDate and endDate if not in note
    let calculatedDuration = parsedNote.duration;
    if (!calculatedDuration && reservation.startDate && reservation.endDate) {
      const durationMs = reservation.endDate - reservation.startDate;
      calculatedDuration = Math.round(durationMs / (1000 * 60 * 60)); // Convert to hours
    }

    return {
      id: String(reservation.id),
      status: (reservation.status?.toLowerCase() || "pending") as
        | "confirmed"
        | "pending"
        | "cancelled",
      createdAt: reservation.created
        ? new Date(reservation.created)
        : new Date(),
      customerName: parsedNote.customerName,
      customerEmail: parsedNote.customerEmail,
      customerPhone: parsedNote.customerPhone,
      datetime: new Date(reservation.startDate || Date.now()),
      duration: calculatedDuration,
      guestCount: reservation.seats || 1,
      specialRequests: parsedNote.specialRequests,
    };
  });
