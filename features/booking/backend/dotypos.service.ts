import { Schema } from "@effect/schema";
import { Config, Context, Effect, Layer, pipe } from "effect";
import {
  type DotyposConfig,
  DotyposConfigLive,
} from "@/shared/backend/config/dotypos.config";
import {
  ExternalAPIError,
  NetworkError,
  ValidationError,
} from "@/shared/backend/errors";
import type { BookingData } from "../booking";

// Dotypos API request/response schemas
const DotyposCustomer = Schema.Struct({
  name: Schema.String,
  email: Schema.optional(Schema.String),
  phone: Schema.optional(Schema.String),
});

const DotyposReservationRequest = Schema.Struct({
  customer: DotyposCustomer,
  dateTime: Schema.String, // ISO 8601 format
  persons: Schema.Number,
  note: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Literal("confirmed", "pending", "cancelled")),
});

const DotyposReservationResponse = Schema.Struct({
  id: Schema.String,
  customer: DotyposCustomer,
  dateTime: Schema.String,
  persons: Schema.Number,
  note: Schema.optional(Schema.String),
  status: Schema.String,
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
});

export interface DotyposReservation {
  id: string;
  customer: {
    name: string;
    email?: string;
    phone?: string;
  };
  dateTime: string;
  persons: number;
  note?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

// Service interface
export interface DotyposService {
  readonly createReservation: (
    booking: BookingData
  ) => Effect.Effect<
    DotyposReservation,
    ExternalAPIError | NetworkError | ValidationError
  >;

  readonly getReservation: (
    reservationId: string
  ) => Effect.Effect<
    DotyposReservation,
    ExternalAPIError | NetworkError | ValidationError
  >;

  readonly updateReservation: (
    reservationId: string,
    booking: Partial<BookingData>
  ) => Effect.Effect<
    DotyposReservation,
    ExternalAPIError | NetworkError | ValidationError
  >;

  readonly cancelReservation: (
    reservationId: string
  ) => Effect.Effect<void, ExternalAPIError | NetworkError | ValidationError>;
}

export const DotyposService =
  Context.GenericTag<DotyposService>("DotyposService");

// Helper function to make API requests
const makeRequest = <A, I>(
  config: DotyposConfig,
  endpoint: string,
  options: RequestInit,
  responseSchema: Schema.Schema<A, I>
) =>
  Effect.gen(function* () {
    const url = `${config.baseUrl}/cloud/${config.cloudId}${endpoint}`;

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          ...options,
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            ...options.headers,
          },
        }),
      catch: (error) =>
        new NetworkError(`Failed to connect to Dotypos API: ${error}`, url),
    });

    if (!response.ok) {
      const errorBody = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => new Error("Unknown error"),
      }).pipe(Effect.catchAll(() => Effect.succeed("Unknown error")));

      return yield* Effect.fail(
        new ExternalAPIError(
          "Dotypos",
          `API request failed: ${errorBody}`,
          response.status
        )
      );
    }

    const data = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () =>
        new ExternalAPIError(
          "Dotypos",
          "Failed to parse API response",
          response.status
        ),
    });

    return yield* Schema.decodeUnknown(responseSchema)(data).pipe(
      Effect.mapError(
        (error) => new ValidationError(`Invalid API response: ${error.message}`)
      )
    );
  });

// Implementation
export const DotyposServiceLive = Layer.effect(
  DotyposService,
  Effect.gen(function* () {
    const config = yield* Config.unwrap(DotyposConfigLive);

    return DotyposService.of({
      createReservation: (booking) =>
        pipe(
          Effect.succeed({
            customer: {
              name: booking.name,
              email: booking.email,
              phone: booking.phone,
            },
            dateTime: booking.datetime.toISOString(),
            persons: booking.guestCount,
            note: [
              booking.tablePreference &&
                `Table preference: ${booking.tablePreference}`,
              booking.specialRequests,
            ]
              .filter(Boolean)
              .join(". "),
            status: "confirmed" as const,
          }),
          Effect.flatMap((data) =>
            Schema.encode(DotyposReservationRequest)(data)
          ),
          Effect.mapError(
            (error) =>
              new ValidationError(`Invalid booking data: ${error.message}`)
          ),
          Effect.flatMap((requestData) =>
            makeRequest(
              config,
              "/reservations",
              {
                method: "POST",
                body: JSON.stringify(requestData),
              },
              DotyposReservationResponse
            )
          )
        ),

      getReservation: (reservationId) =>
        makeRequest(
          config,
          `/reservations/${reservationId}`,
          { method: "GET" },
          DotyposReservationResponse
        ),

      updateReservation: (reservationId, booking) =>
        pipe(
          Effect.succeed({
            customer: {
              name: booking.name!,
              email: booking.email,
              phone: booking.phone,
            },
            dateTime:
              booking.datetime?.toISOString() || new Date().toISOString(),
            persons: booking.guestCount || 1,
            note: booking.specialRequests,
            status: "confirmed" as const,
          }),
          Effect.flatMap((data) =>
            Schema.encode(DotyposReservationRequest)(data)
          ),
          Effect.mapError(
            (error) =>
              new ValidationError(`Invalid booking data: ${error.message}`)
          ),
          Effect.flatMap((requestData) =>
            makeRequest(
              config,
              `/reservations/${reservationId}`,
              {
                method: "PATCH",
                body: JSON.stringify(requestData),
              },
              DotyposReservationResponse
            )
          )
        ),

      cancelReservation: (reservationId) =>
        makeRequest(
          config,
          `/reservations/${reservationId}`,
          { method: "DELETE" },
          Schema.Void
        ),
    });
  })
);
