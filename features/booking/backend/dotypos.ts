import { Config, Effect, Schema } from "effect";
import {
  ExternalAPIError,
  NetworkError,
  ValidationError,
} from "@/shared/backend/errors";
import type { BookingData } from "../booking";

/**
 * Dotypos Configuration Schema
 */
const DotyposConfig = Config.all({
  clientId: Config.string("DOTYPOS_CLIENT_ID").pipe(
    Config.withDefault("")
  ),
  clientSecret: Config.string("DOTYPOS_CLIENT_SECRET").pipe(
    Config.withDefault("")
  ),
  refreshToken: Config.string("DOTYPOS_REFRESH_TOKEN").pipe(
    Config.withDefault("")
  ),
  cloudId: Config.string("DOTYPOS_CLOUD_ID").pipe(
    Config.withDefault("")
  ),
  apiUrl: Config.string("DOTYPOS_API_URL").pipe(
    Config.withDefault("https://api.dotykacka.cz/v2")
  ),
});

/**
 * Dotypos Reservation Schema
 */
const DotyposReservationSchema = Schema.Struct({
  id: Schema.optional(Schema.Number),
  _branchId: Schema.Number,
  _cloudId: Schema.Number,
  startDate: Schema.Number,
  endDate: Schema.Number,
  seats: Schema.Number,
  status: Schema.Literal("NEW", "CONFIRMED", "CANCELLED"),
  note: Schema.optional(Schema.String),
  created: Schema.optional(Schema.Number),
  versionDate: Schema.optional(Schema.Number),
});

/**
 * Simple reservation response for the app
 */
export interface ReservationResponse {
  id: string;
  status: "confirmed" | "pending" | "cancelled";
  createdAt: Date;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  datetime: Date;
  guestCount: number;
  specialRequests?: string;
}

/**
 * Create a Dotypos reservation from booking data
 * 
 * This is a simple, direct function that:
 * 1. Gets configuration from environment
 * 2. Obtains an access token if needed
 * 3. Creates the reservation
 * 4. Returns a simple response
 */
export const createDotyposReservation = (
  booking: BookingData
): Effect.Effect<
  ReservationResponse,
  ExternalAPIError | NetworkError | ValidationError
> =>
  Effect.gen(function* () {
    // Get configuration
    const config = yield* Config.unwrap(DotyposConfig);

    // Check if Dotypos is configured
    if (!config.clientId || !config.refreshToken || !config.cloudId) {
      // Dotypos not configured - this should fail as we need Dotypos
      return yield* Effect.fail(
        new ValidationError("Dotypos is not configured. Reservations cannot be created.")
      );
    }

    // Get access token
    const accessToken = yield* getAccessToken(config);

    // Build reservation request
    const reservationData = {
      _branchId: 1, // Default branch
      _cloudId: parseInt(config.cloudId),
      startDate: booking.datetime.getTime(),
      endDate: booking.datetime.getTime() + (booking.duration || 2) * 60 * 60 * 1000,
      seats: booking.guestCount,
      status: "CONFIRMED" as const,
      note: buildNote(booking),
    };

    // Create reservation
    const url = `${config.apiUrl}/clouds/${config.cloudId}/reservations`;
    
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(reservationData),
        }),
      catch: (error) =>
        new NetworkError(`Failed to connect to Dotypos: ${error}`, url),
    });

    if (!response.ok) {
      const errorText = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => new Error("Unknown error"),
      }).pipe(Effect.catchAll(() => Effect.succeed("Unknown error")));

      return yield* Effect.fail(
        new ExternalAPIError(
          "Dotypos",
          `Failed to create reservation: ${errorText}`,
          response.status
        )
      );
    }

    const data = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () =>
        new ValidationError("Failed to parse Dotypos response"),
    });

    const reservation = yield* Schema.decodeUnknown(DotyposReservationSchema)(data).pipe(
      Effect.mapError(
        (error) => new ValidationError(`Invalid reservation response: ${error}`)
      )
    );

    yield* Effect.log(
      `Dotypos reservation created with ID: ${reservation.id}`
    );

    return {
      id: String(reservation.id || "unknown"),
      status: "confirmed" as const,
      createdAt: new Date(),
      customerName: booking.name,
      customerEmail: booking.email,
      customerPhone: booking.phone,
      datetime: booking.datetime,
      guestCount: booking.guestCount,
      specialRequests: booking.specialRequests,
    };
  });

/**
 * Get access token (with caching)
 */
let cachedToken: { token: string; expiresAt: number } | null = null;

const getAccessToken = (config: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  apiUrl: string;
}): Effect.Effect<string, ExternalAPIError | NetworkError> =>
  Effect.gen(function* () {
    // Check cached token
    if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
      return cachedToken.token;
    }

    // Refresh token
    const tokenUrl = "https://api.dotykacka.cz/v2/auth/token";
    
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(tokenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            grant_type: "refresh_token",
            client_id: config.clientId,
            client_secret: config.clientSecret,
            refresh_token: config.refreshToken,
          }),
        }),
      catch: (error) =>
        new NetworkError(`Failed to refresh token: ${error}`, tokenUrl),
    });

    if (!response.ok) {
      const errorText = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => new Error("Unknown error"),
      }).pipe(Effect.catchAll(() => Effect.succeed("Unknown error")));

      return yield* Effect.fail(
        new ExternalAPIError(
          "Dotypos",
          `Authentication failed: ${errorText}`,
          response.status
        )
      );
    }

    const data = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () =>
        new ExternalAPIError("Dotypos", "Failed to parse auth response", 500),
    });

    // Cache the token
    const expiresIn = data.expires_in || 3600;
    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    };

    yield* Effect.log("Dotypos access token refreshed");
    
    return cachedToken.token;
  });

/**
 * Get a Dotypos reservation by ID
 */
export const getDotyposReservation = (
  reservationId: string
): Effect.Effect<
  ReservationResponse,
  ExternalAPIError | NetworkError | ValidationError
> =>
  Effect.gen(function* () {
    // Get configuration
    const config = yield* Config.unwrap(DotyposConfig);

    // Check if Dotypos is configured
    if (!config.clientId || !config.refreshToken || !config.cloudId) {
      return yield* Effect.fail(
        new ValidationError("Dotypos is not configured")
      );
    }

    // Get access token
    const accessToken = yield* getAccessToken(config);

    // Get reservation
    const url = `${config.apiUrl}/clouds/${config.cloudId}/reservations/${reservationId}`;
    
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }),
      catch: (error) =>
        new NetworkError(`Failed to connect to Dotypos: ${error}`, url),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return yield* Effect.fail(
          new ValidationError(`Reservation ${reservationId} not found`)
        );
      }

      const errorText = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => new Error("Unknown error"),
      }).pipe(Effect.catchAll(() => Effect.succeed("Unknown error")));

      return yield* Effect.fail(
        new ExternalAPIError(
          "Dotypos",
          `Failed to get reservation: ${errorText}`,
          response.status
        )
      );
    }

    const data = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () =>
        new ValidationError("Failed to parse Dotypos response"),
    });

    const reservation = yield* Schema.decodeUnknown(DotyposReservationSchema)(data).pipe(
      Effect.mapError(
        (error) => new ValidationError(`Invalid reservation response: ${error}`)
      )
    );

    // Parse customer info from note
    const note = reservation.note || "";
    const customerName = note.match(/Customer: ([^|]+)/)?.[1]?.trim() || "Unknown";
    const customerEmail = note.match(/Email: ([^|]+)/)?.[1]?.trim();
    const customerPhone = note.match(/Phone: ([^|]+)/)?.[1]?.trim();
    const specialRequests = note.split("|").pop()?.trim();

    return {
      id: String(reservation.id),
      status: reservation.status.toLowerCase() as "confirmed" | "pending" | "cancelled",
      createdAt: reservation.created ? new Date(reservation.created) : new Date(),
      customerName,
      customerEmail,
      customerPhone,
      datetime: new Date(reservation.startDate),
      guestCount: reservation.seats,
      specialRequests,
    };
  });

/**
 * Build note field with customer information
 */
const buildNote = (booking: BookingData): string => {
  const parts: string[] = [];

  if (booking.name) {
    parts.push(`Customer: ${booking.name}`);
  }
  if (booking.email) {
    parts.push(`Email: ${booking.email}`);
  }
  if (booking.phone) {
    parts.push(`Phone: ${booking.phone}`);
  }
  if (booking.tablePreference) {
    parts.push(`Table preference: ${booking.tablePreference}`);
  }
  if (booking.specialRequests) {
    parts.push(booking.specialRequests);
  }

  return parts.join(" | ");
};