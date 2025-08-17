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
} from "../generated/types.gen";
import type { DotyposReservation } from "../types";

/**
 * Dotypos Configuration Schema with validation
 */
const DotyposConfigSchema = Schema.Struct({
  clientId: Schema.NonEmptyString,
  clientSecret: Schema.NonEmptyString,
  refreshToken: Schema.NonEmptyString,
  cloudId: Schema.NonEmptyString,
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

/**
 * Token Response Schema for validation
 */
const TokenResponseSchema = Schema.Struct({
  access_token: Schema.NonEmptyString,
  expires_in: Schema.Number.pipe(Schema.positive()),
  token_type: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.String),
});

/**
 * Reservation Status Schema - matches generated API types
 */
const ReservationStatusSchema = Schema.Literal("NEW", "CONFIRMED", "CANCELLED");

/**
 * Reservation Schema for API responses
 */
const ReservationResponseSchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.positive()),
  status: Schema.optional(ReservationStatusSchema),
  created: Schema.optional(Schema.Number.pipe(Schema.positive())),
  startDate: Schema.optional(Schema.Number.pipe(Schema.positive())),
  endDate: Schema.optional(Schema.Number.pipe(Schema.positive())),
  seats: Schema.optional(Schema.Number.pipe(Schema.positive())),
  note: Schema.optional(Schema.String),
  _branchId: Schema.optional(Schema.Number.pipe(Schema.positive())),
  _cloudId: Schema.optional(Schema.Number.pipe(Schema.positive())),
});

class DotyposConfigTag extends Context.Tag("DotyposConfig")<
  DotyposConfigTag,
  DotyposConfig
>() {}

const ConfigLayer = Layer.effect(
  DotyposConfigTag,
  Effect.gen(function* () {
    const rawConfig = yield* Config.all({
      clientId: Config.string("DOTYPOS_CLIENT_ID"),
      clientSecret: Config.string("DOTYPOS_CLIENT_SECRET"),
      refreshToken: Config.string("DOTYPOS_REFRESH_TOKEN"),
      cloudId: Config.string("DOTYPOS_CLOUD_ID"),
      apiUrl: Config.string("DOTYPOS_API_URL").pipe(
        Config.withDefault("https://api.dotykacka.cz/v2")
      ),
      apiTimeout: Config.number("DOTYPOS_API_TIMEOUT").pipe(
        Config.withDefault(30000)
      ),
    });

    // Validate config using Schema
    const config = yield* Schema.decodeUnknown(DotyposConfigSchema)(
      rawConfig
    ).pipe(
      Effect.mapError(
        (error) =>
          new ValidationError({
            message: `Invalid Dotypos configuration: ${error.message}`,
          })
      )
    );

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
  }) => Effect.Effect<
    Schema.Schema.Type<typeof ReservationResponseSchema>,
    ExternalAPIError | NetworkError
  >;

  readonly getReservation: (params: {
    path: { cloudId: string; reservationId: string };
  }) => Effect.Effect<
    Schema.Schema.Type<typeof ReservationResponseSchema>,
    ExternalAPIError | NetworkError
  >;
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
          return cached.token;
        }

        // Get new token using the client
        const result = yield* Effect.tryPromise({
          try: async () => {
            const result = await generatedApi.getAccessToken({
              client,
              body: {
                grant_type: "refresh_token" as const,
                client_id: config.clientId,
                client_secret: config.clientSecret,
                refresh_token: config.refreshToken,
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
        });

        // Validate response using Schema
        const response = yield* Schema.decodeUnknown(TokenResponseSchema)(
          result
        ).pipe(
          Effect.mapError(
            (error) =>
              new ExternalAPIError({
                service: "Dotypos",
                message: `Invalid token response: ${error.message}`,
                statusCode: 500,
              })
          )
        );

        // Update cache atomically
        yield* Ref.set(tokenCacheRef, {
          token: response.access_token,
          expiresAt: Date.now() + response.expires_in * 1000,
        });

        yield* Effect.log("Dotypos access token refreshed");
        return response.access_token;
      });

    // Create authenticated API using Effect patterns
    const api: DotyposApi = {
      createReservation: (params) =>
        Effect.gen(function* () {
          // Get token (retry is handled at the service level)
          const token = yield* getToken();

          const rawResult = yield* Effect.tryPromise({
            try: async () => {
              const response = await generatedApi.createReservation({
                client,
                ...params,
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
                    "Failed to create reservation",
                };
              }

              return response.data;
            },
            catch: (error) =>
              transformHttpError(error, "Create reservation", config.apiUrl),
          });

          // Validate and transform response
          const result = yield* Schema.decodeUnknown(ReservationResponseSchema)(
            rawResult
          ).pipe(
            Effect.mapError(
              (error) =>
                new ExternalAPIError({
                  service: "Dotypos",
                  message: `Invalid reservation response: ${error.message}`,
                  statusCode: 500,
                })
            )
          );

          return result;
        }),

      getReservation: (params) =>
        Effect.gen(function* () {
          // Get token (retry is handled at the service level)
          const token = yield* getToken();

          const rawResult = yield* Effect.tryPromise({
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

          // Validate and transform response
          const result = yield* Schema.decodeUnknown(ReservationResponseSchema)(
            rawResult
          ).pipe(
            Effect.mapError(
              (error) =>
                new ExternalAPIError({
                  service: "Dotypos",
                  message: `Invalid reservation response: ${error.message}`,
                  statusCode: 500,
                })
            )
          );

          return result;
        }),
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
      createReservation: (request: CreateReservationRequest) =>
        api
          .createReservation({
            path: {
              cloudId: config.cloudId,
            },
            body: request,
          })
          .pipe(
            Effect.timeout(Duration.millis(config.apiTimeout)),
            Effect.retry(retryPolicy),
            Effect.tap((response) =>
              Effect.log(`Created Dotypos reservation: ${response.id}`)
            ),
            // Map to Reservation type
            Effect.map(
              (response): Reservation => ({
                id: response.id,
                status: response.status,
                created: response.created,
                startDate: response.startDate,
                endDate: response.endDate,
                seats: response.seats,
                note: response.note,
                _branchId: response._branchId,
                _cloudId: response._cloudId,
              })
            ),
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
            // Map to Reservation type
            Effect.map(
              (response): Reservation => ({
                id: response.id,
                status: response.status,
                created: response.created,
                startDate: response.startDate,
                endDate: response.endDate,
                seats: response.seats,
                note: response.note,
                _branchId: response._branchId,
                _cloudId: response._cloudId,
              })
            ),
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
 * Reservation Input Schema with validation
 */
const ReservationInputSchema = Schema.Struct({
  datetime: Schema.instanceOf(Date),
  duration: Schema.Number.pipe(
    Schema.positive(),
    Schema.lessThanOrEqualTo(8), // Max 8 hour reservation
    Schema.annotations({ description: "Duration in hours" })
  ),
  guestCount: Schema.Number.pipe(
    Schema.positive(),
    Schema.int(),
    Schema.lessThanOrEqualTo(50), // Max 50 guests
    Schema.annotations({ description: "Number of guests" })
  ),
  customerName: Schema.NonEmptyString,
  customerEmail: Schema.String.pipe(
    Schema.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
    Schema.annotations({ description: "Must be a valid email address" })
  ),
  customerPhone: Schema.String.pipe(
    Schema.pattern(/^\+?[0-9\s\-()]+$/),
    Schema.annotations({ description: "Must be a valid phone number" })
  ),
  tablePreference: Schema.optional(Schema.String),
  specialRequests: Schema.optional(Schema.String),
});

export type ReservationInput = Schema.Schema.Type<
  typeof ReservationInputSchema
>;

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
 * Schema for parsed note data
 */
const ParsedNoteSchema = Schema.Struct({
  customerName: Schema.Union(Schema.String, Schema.Null),
  customerEmail: Schema.optional(Schema.String),
  customerPhone: Schema.optional(Schema.String),
  duration: Schema.optional(Schema.Number),
  tablePreference: Schema.optional(Schema.String),
  specialRequests: Schema.optional(Schema.String),
});

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
const parseNote = (
  note: string | undefined
): Schema.Schema.Type<typeof ParsedNoteSchema> => {
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
  input: unknown
): Effect.Effect<
  DotyposReservation,
  ExternalAPIError | NetworkError | ValidationError,
  DotyposClient
> =>
  Effect.gen(function* () {
    // Validate input
    const validatedInput = yield* Schema.decodeUnknown(ReservationInputSchema)(
      input
    ).pipe(
      Effect.mapError(
        (error) =>
          new ValidationError({
            message: `Invalid reservation input: ${error.message}`,
          })
      )
    );

    const client = yield* DotyposClient;

    const request: CreateReservationRequest = {
      _branchId: 1, // Default branch
      _cloudId: parseInt(client.cloudId),
      startDate: validatedInput.datetime.getTime(),
      endDate:
        validatedInput.datetime.getTime() +
        validatedInput.duration * 60 * 60 * 1000,
      seats: validatedInput.guestCount,
      status: "CONFIRMED",
      note: buildNote(validatedInput),
    };

    const reservation = yield* client.createReservation(request);

    return {
      id: String(reservation.id),
      status: "confirmed" as const,
      createdAt: reservation.created
        ? new Date(reservation.created)
        : new Date(),
      customerName: validatedInput.customerName,
      customerEmail: validatedInput.customerEmail,
      customerPhone: validatedInput.customerPhone,
      datetime: validatedInput.datetime,
      guestCount: validatedInput.guestCount,
      specialRequests: validatedInput.specialRequests,
    };
  });

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
