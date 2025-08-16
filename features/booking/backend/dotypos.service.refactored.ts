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
import {
  dotyposAPI,
  DotyposAPIClient,
  type DotyposReservation,
  type CreateReservationRequest,
  type DotyposCustomer,
} from "@/src/services/dotypos/dotypos-api.client";

// Service interface matching existing structure
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

/**
 * Helper function to find or create a customer
 */
const findOrCreateCustomer = (
  booking: BookingData
): Effect.Effect<
  number | undefined,
  ExternalAPIError | NetworkError | ValidationError
> =>
  Effect.gen(function* () {
    // If no email or phone, skip customer creation
    if (!booking.email && !booking.phone) {
      return undefined;
    }

    // Try to find existing customer
    const existingCustomers = yield* dotyposAPI.searchCustomers({
      email: booking.email,
      phone: booking.phone,
    });

    if (existingCustomers.length > 0) {
      return existingCustomers[0].id;
    }

    // Create new customer
    const nameParts = booking.name.split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ");

    const newCustomer = yield* dotyposAPI.createCustomer({
      firstName,
      lastName: lastName || undefined,
      email: booking.email,
      phone: booking.phone,
    });

    return newCustomer.id;
  });

/**
 * Convert BookingData to CreateReservationRequest
 */
const bookingToReservationRequest = (
  booking: BookingData,
  customerId?: number,
  branchId: number = 1 // Default branch, should be configurable
): CreateReservationRequest => {
  const startDate = DotyposAPIClient.dateToTimestamp(booking.datetime);
  const durationHours = 2; // Default 2 hours, should be configurable
  const endDate = startDate + durationHours * 60 * 60 * 1000;

  return {
    _branchId: branchId,
    _customerId: customerId,
    startDate,
    endDate,
    seats: booking.guestCount,
    status: "CONFIRMED",
    note: [
      booking.tablePreference &&
        `Table preference: ${booking.tablePreference}`,
      booking.specialRequests,
    ]
      .filter(Boolean)
      .join(". "),
  };
};

// Implementation using the new API client
export const DotyposServiceLive = Layer.effect(
  DotyposService,
  Effect.gen(function* () {
    const config = yield* Config.unwrap(DotyposConfigLive);

    return DotyposService.of({
      createReservation: (booking) =>
        pipe(
          // Find or create customer
          findOrCreateCustomer(booking),
          Effect.flatMap((customerId) => {
            // Create reservation request
            const request = bookingToReservationRequest(
              booking,
              customerId,
              config.branchId || 1
            );
            
            // Create reservation via API
            return dotyposAPI.createReservation(request);
          }),
          Effect.catchTag("NetworkError", (error) =>
            Effect.fail(
              new NetworkError(
                `Failed to create reservation: ${error.message}`,
                error.url
              )
            )
          ),
          Effect.catchTag("ExternalAPIError", (error) =>
            Effect.fail(
              new ExternalAPIError(
                "Dotypos",
                `Failed to create reservation: ${error.message}`,
                error.status
              )
            )
          )
        ),

      getReservation: (reservationId) =>
        pipe(
          Effect.try(() => parseInt(reservationId)),
          Effect.flatMap((id) =>
            Number.isNaN(id)
              ? Effect.fail(
                  new ValidationError(`Invalid reservation ID: ${reservationId}`)
                )
              : Effect.succeed(id)
          ),
          Effect.flatMap((id) => dotyposAPI.getReservation(id)),
          Effect.catchTag("NetworkError", (error) =>
            Effect.fail(
              new NetworkError(
                `Failed to get reservation: ${error.message}`,
                error.url
              )
            )
          )
        ),

      updateReservation: (reservationId, booking) =>
        pipe(
          Effect.all({
            id: Effect.try(() => parseInt(reservationId)),
            customerId: booking.email || booking.phone
              ? findOrCreateCustomer(booking as BookingData)
              : Effect.succeed(undefined),
          }),
          Effect.flatMap(({ id, customerId }) => {
            if (Number.isNaN(id)) {
              return Effect.fail(
                new ValidationError(`Invalid reservation ID: ${reservationId}`)
              );
            }

            const updates: any = {};
            
            if (booking.datetime) {
              updates.startDate = DotyposAPIClient.dateToTimestamp(booking.datetime);
              // Assume 2-hour duration for updates
              updates.endDate = updates.startDate + 2 * 60 * 60 * 1000;
            }
            
            if (booking.guestCount !== undefined) {
              updates.seats = booking.guestCount;
            }
            
            if (customerId !== undefined) {
              updates._customerId = customerId;
            }
            
            if (booking.specialRequests !== undefined || 
                booking.tablePreference !== undefined) {
              updates.note = [
                booking.tablePreference &&
                  `Table preference: ${booking.tablePreference}`,
                booking.specialRequests,
              ]
                .filter(Boolean)
                .join(". ");
            }

            return dotyposAPI.updateReservation(id, updates);
          }),
          Effect.catchTag("NetworkError", (error) =>
            Effect.fail(
              new NetworkError(
                `Failed to update reservation: ${error.message}`,
                error.url
              )
            )
          )
        ),

      cancelReservation: (reservationId) =>
        pipe(
          Effect.try(() => parseInt(reservationId)),
          Effect.flatMap((id) =>
            Number.isNaN(id)
              ? Effect.fail(
                  new ValidationError(`Invalid reservation ID: ${reservationId}`)
                )
              : Effect.succeed(id)
          ),
          Effect.flatMap((id) => dotyposAPI.cancelReservation(id)),
          Effect.catchTag("NetworkError", (error) =>
            Effect.fail(
              new NetworkError(
                `Failed to cancel reservation: ${error.message}`,
                error.url
              )
            )
          )
        ),
    });
  })
);

// Additional helper service for table management
export interface DotyposTableService {
  readonly getAvailableTables: (
    datetime: Date,
    guestCount: number,
    branchId?: number
  ) => Effect.Effect<
    Array<{ id: number; name: string; seats: number }>,
    ExternalAPIError | NetworkError | ValidationError
  >;

  readonly checkTableAvailability: (
    tableId: number,
    startDate: Date,
    endDate: Date
  ) => Effect.Effect<
    boolean,
    ExternalAPIError | NetworkError | ValidationError
  >;
}

export const DotyposTableService =
  Context.GenericTag<DotyposTableService>("DotyposTableService");

export const DotyposTableServiceLive = Layer.effect(
  DotyposTableService,
  Effect.gen(function* () {
    const config = yield* Config.unwrap(DotyposConfigLive);

    return DotyposTableService.of({
      getAvailableTables: (datetime, guestCount, branchId) =>
        pipe(
          dotyposAPI.getTables(branchId || config.branchId || 1),
          Effect.map((tables) =>
            tables
              .filter((table) => {
                // Filter by enabled and visible
                if (!table.enabled || !table.display) return false;
                // Filter by guest count
                if (table.seats && table.seats < guestCount) return false;
                return true;
              })
              .map((table) => ({
                id: table.id,
                name: table.name,
                seats: table.seats || 0,
              }))
          ),
          Effect.flatMap((tables) =>
            // Check availability for each table
            Effect.all(
              tables.map((table) =>
                pipe(
                  dotyposAPI.checkTableAvailability(
                    table.id,
                    datetime,
                    new Date(datetime.getTime() + 2 * 60 * 60 * 1000) // 2 hours
                  ),
                  Effect.map((isAvailable) =>
                    isAvailable ? table : null
                  ),
                  Effect.catchAll(() => Effect.succeed(null))
                )
              )
            )
          ),
          Effect.map((tables) =>
            tables.filter((table): table is NonNullable<typeof table> =>
              table !== null
            )
          )
        ),

      checkTableAvailability: (tableId, startDate, endDate) =>
        dotyposAPI.checkTableAvailability(tableId, startDate, endDate),
    });
  })
);