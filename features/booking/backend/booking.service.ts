import { Context, Effect, Layer, pipe } from "effect";
import { v4 as uuidv4 } from "uuid";
import type {
  ExternalAPIError,
  NetworkError,
  StorageError,
} from "@/shared/backend/errors";
import type { BookingData } from "../booking";
import { BookingStorage } from "./booking.storage";
import { DotyposService } from "./dotypos.service";
import { EmailService } from "./email.service";

export interface IBookingService {
  createBooking: (
    data: Omit<BookingData, "id" | "submittedAt">
  ) => Effect.Effect<string, StorageError | ExternalAPIError | NetworkError>;
  getBooking: (id: string) => Effect.Effect<BookingData | null, StorageError>;
  getAllBookings: () => Effect.Effect<BookingData[], StorageError>;
}

export class BookingService extends Context.Tag("BookingService")<
  BookingService,
  IBookingService
>() {}

export const BookingServiceLive = Layer.effect(
  BookingService,
  Effect.gen(function* () {
    const storage = yield* BookingStorage;
    const dotypos = yield* DotyposService;
    const email = yield* EmailService;

    return BookingService.of({
      createBooking: (data) =>
        pipe(
          Effect.sync(() => uuidv4()),
          Effect.flatMap((id) => {
            const bookingData: BookingData = {
              ...data,
              id,
              submittedAt: new Date(),
            };

            return pipe(
              // Store locally first
              storage.save(id, bookingData),
              // Then create reservation in Dotypos
              Effect.tap(() =>
                pipe(
                  dotypos.createReservation(bookingData),
                  Effect.flatMap((reservation) =>
                    // Send confirmation emails
                    Effect.all(
                      [
                        email.sendReservationConfirmation(
                          bookingData,
                          reservation
                        ),
                        email.sendReservationNotification(
                          bookingData,
                          reservation
                        ),
                      ],
                      { concurrency: "unbounded" }
                    )
                  ),
                  // Log but don't fail the booking if external services fail
                  Effect.catchAll((error) =>
                    Effect.sync(() => {
                      console.error(
                        "Failed to process booking externally:",
                        error
                      );
                      // Continue with local booking even if external services fail
                    })
                  )
                )
              ),
              Effect.tap(() => Effect.log(`Booking created: ${id}`))
            );
          })
        ),

      getBooking: (id) =>
        pipe(
          storage.get(id),
          Effect.tap((booking) =>
            booking
              ? Effect.log(`Booking found: ${id}`)
              : Effect.log(`Booking not found: ${id}`)
          )
        ),

      getAllBookings: () =>
        pipe(
          storage.getAll(),
          Effect.tap((bookings) =>
            Effect.log(`Retrieved ${bookings.length} bookings`)
          )
        ),
    });
  })
);
