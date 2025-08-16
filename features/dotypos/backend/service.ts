/**
 * Dotypos Effect Service
 * 
 * This service wraps the generated OpenAPI client with Effect patterns
 * for better error handling and composition.
 */

import { Config, Context, Effect, Layer, Schema } from "effect";
import { createClient } from "../generated";
import * as api from "../generated/sdk.gen";
import type {
  CreateReservationRequest,
  Reservation,
  TokenResponse,
} from "../generated/types.gen";
import {
  ExternalAPIError,
  NetworkError,
  ValidationError,
} from "@/shared/backend/errors";
import type { DotyposReservation } from "../types";

/**
 * Dotypos Configuration
 */
const DotyposConfigSchema = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.String,
  refreshToken: Schema.String,
  cloudId: Schema.String,
  apiUrl: Schema.String,
});

type DotyposConfig = Schema.Schema.Type<typeof DotyposConfigSchema>;

const ConfigLayer = Layer.effect(
  Context.GenericTag<DotyposConfig>("DotyposConfig"),
  Effect.gen(function* () {
    const config = yield* Config.all({
      clientId: Config.string("DOTYPOS_CLIENT_ID"),
      clientSecret: Config.string("DOTYPOS_CLIENT_SECRET"),
      refreshToken: Config.string("DOTYPOS_REFRESH_TOKEN"),
      cloudId: Config.string("DOTYPOS_CLOUD_ID"),
      apiUrl: Config.string("DOTYPOS_API_URL").pipe(
        Config.withDefault("https://api.dotykacka.cz/v2")
      ),
    });
    
    return config;
  })
);

/**
 * Dotypos API Client Service
 */
class DotyposClient extends Context.Tag("DotyposClient")<
  DotyposClient,
  {
    readonly getToken: () => Effect.Effect<string, ExternalAPIError | NetworkError>;
    readonly createReservation: (
      request: CreateReservationRequest
    ) => Effect.Effect<Reservation, ExternalAPIError | NetworkError | ValidationError>;
    readonly getReservation: (
      id: string
    ) => Effect.Effect<Reservation, ExternalAPIError | NetworkError | ValidationError>;
  }
>() {}

/**
 * Token cache
 */
let tokenCache: { token: string; expiresAt: number } | null = null;

const DotyposClientLive = Layer.effect(
  DotyposClient,
  Effect.gen(function* () {
    const config = yield* Context.get(Context.GenericTag<DotyposConfig>("DotyposConfig"));
    
    // Create the API client with the base URL
    const client = createClient({
      baseUrl: config.apiUrl,
    });

    return {
      getToken: () =>
        Effect.gen(function* () {
          // Check cache
          if (tokenCache && Date.now() < tokenCache.expiresAt - 60000) {
            return tokenCache.token;
          }

          // Get new token
          const response = yield* Effect.tryPromise({
            try: async () => {
              const result = await api.getAccessToken({
                client,
                body: {
                  grant_type: "refresh_token" as const,
                  client_id: config.clientId,
                  client_secret: config.clientSecret,
                  refresh_token: config.refreshToken,
                },
              });

              if (result.error) {
                throw new Error(
                  result.error.error_description || result.error.error || "Authentication failed"
                );
              }

              return result.data as TokenResponse;
            },
            catch: (error) =>
              error instanceof Error && error.message.includes("fetch")
                ? new NetworkError(`Failed to connect to Dotypos: ${error.message}`, config.apiUrl)
                : new ExternalAPIError("Dotypos", `Authentication failed: ${error}`, 401),
          });

          if (!response.access_token || !response.expires_in) {
            return yield* Effect.fail(
              new ExternalAPIError(
                "Dotypos",
                "Invalid auth response: missing access_token or expires_in",
                500
              )
            );
          }

          // Cache the token
          tokenCache = {
            token: response.access_token,
            expiresAt: Date.now() + response.expires_in * 1000,
          };

          yield* Effect.log("Dotypos access token refreshed");
          return response.access_token;
        }),

      createReservation: (request: CreateReservationRequest) =>
        Effect.gen(function* () {
          const token = yield* Effect.retry(
            Effect.gen(function* () {
              return yield* this.getToken();
            }),
            { times: 2 }
          );

          const response = yield* Effect.tryPromise({
            try: async () => {
              const result = await api.createReservation({
                client: createClient({
                  baseUrl: config.apiUrl,
                  headers: {
                    Authorization: `Bearer ${token}`,
                  },
                }),
                path: {
                  cloudId: config.cloudId,
                },
                body: request,
              });

              if (result.error) {
                throw new Error(
                  result.error.error_description || result.error.error || "Failed to create reservation"
                );
              }

              return result.data as Reservation;
            },
            catch: (error) =>
              error instanceof Error && error.message.includes("fetch")
                ? new NetworkError(`Failed to connect to Dotypos: ${error.message}`, config.apiUrl)
                : new ExternalAPIError("Dotypos", `Failed to create reservation: ${error}`, 400),
          });

          yield* Effect.log(`Created Dotypos reservation: ${response.id}`);
          return response;
        }),

      getReservation: (id: string) =>
        Effect.gen(function* () {
          const token = yield* Effect.retry(
            Effect.gen(function* () {
              return yield* this.getToken();
            }),
            { times: 2 }
          );

          const response = yield* Effect.tryPromise({
            try: async () => {
              const result = await api.getReservation({
                client: createClient({
                  baseUrl: config.apiUrl,
                  headers: {
                    Authorization: `Bearer ${token}`,
                  },
                }),
                path: {
                  cloudId: config.cloudId,
                  reservationId: id,
                },
              });

              if (result.error) {
                if (result.response?.status === 404) {
                  throw new ValidationError(`Reservation ${id} not found`);
                }
                throw new Error(
                  result.error.error_description || result.error.error || "Failed to get reservation"
                );
              }

              return result.data as Reservation;
            },
            catch: (error) => {
              if (error instanceof ValidationError) {
                return error;
              }
              return error instanceof Error && error.message.includes("fetch")
                ? new NetworkError(`Failed to connect to Dotypos: ${error.message}`, config.apiUrl)
                : new ExternalAPIError("Dotypos", `Failed to get reservation: ${error}`, 400);
            },
          });

          if (response instanceof Error) {
            return yield* Effect.fail(response);
          }

          return response;
        }),
    };
  })
);

/**
 * Complete Dotypos service layer
 */
export const DotyposServiceLive = Layer.provide(DotyposClientLive, ConfigLayer);

/**
 * High-level service functions
 */

/**
 * Input for creating a reservation
 */
export interface ReservationInput {
  datetime: Date;
  duration: number; // hours
  guestCount: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  tablePreference?: string;
  specialRequests?: string;
}

/**
 * Build note field with customer information
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
  if (input.tablePreference) {
    parts.push(`Table preference: ${input.tablePreference}`);
  }
  if (input.specialRequests) {
    parts.push(input.specialRequests);
  }

  return parts.join(" | ");
};

/**
 * Parse customer info from note field
 */
const parseNote = (note: string | undefined) => {
  if (!note) {
    return {
      customerName: null,
      customerEmail: undefined,
      customerPhone: undefined,
      specialRequests: undefined,
    };
  }

  const customerNameMatch = note.match(/Customer: ([^|]+)/)?.[1]?.trim();
  const customerEmail = note.match(/Email: ([^|]+)/)?.[1]?.trim();
  const customerPhone = note.match(/Phone: ([^|]+)/)?.[1]?.trim();
  const specialRequests = note.split("|").pop()?.trim();

  return {
    customerName: customerNameMatch,
    customerEmail,
    customerPhone,
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
    const client = yield* DotyposClient;
    const config = yield* Context.get(Context.GenericTag<DotyposConfig>("DotyposConfig"));

    const request: CreateReservationRequest = {
      _branchId: 1, // Default branch
      _cloudId: parseInt(config.cloudId),
      startDate: input.datetime.getTime(),
      endDate: input.datetime.getTime() + input.duration * 60 * 60 * 1000,
      seats: input.guestCount,
      status: "CONFIRMED",
      note: buildNote(input),
    };

    const reservation = yield* client.createReservation(request);

    return {
      id: String(reservation.id),
      status: "confirmed" as const,
      createdAt: reservation.created ? new Date(reservation.created) : new Date(),
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      datetime: input.datetime,
      guestCount: input.guestCount,
      specialRequests: input.specialRequests,
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

    const { customerName, customerEmail, customerPhone, specialRequests } = parseNote(
      reservation.note
    );

    if (!customerName) {
      return yield* Effect.fail(
        new ValidationError(`Reservation ${id} has no customer information`)
      );
    }

    return {
      id: String(reservation.id),
      status: (reservation.status?.toLowerCase() || "pending") as
        | "confirmed"
        | "pending"
        | "cancelled",
      createdAt: reservation.created ? new Date(reservation.created) : new Date(),
      customerName,
      customerEmail,
      customerPhone,
      datetime: new Date(reservation.startDate!),
      guestCount: reservation.seats!,
      specialRequests,
    };
  });