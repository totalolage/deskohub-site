import { Effect, Layer } from "effect";
import {
  type PayStateSubmission,
  prepareWorkspacePayState,
  ReservationBooking,
} from "./reservation-booking.service";
import { ReservationHolds } from "./reservation-holds.service";

/**
 * Books one submission through `ReservationBooking` and `ReservationHolds`
 * built over the services the test provides, the way their `Live` layers
 * build them over live services.
 */
export const prepareOverProvidedServices = (submission: PayStateSubmission) =>
  prepareWorkspacePayState(submission).pipe(
    Effect.provide(
      ReservationBooking.Default.pipe(Layer.provide(ReservationHolds.Default))
    )
  );

/**
 * Books one submission through `ReservationBooking` built over the services
 * the test provides, `ReservationHolds` among them, for booking cases that
 * only need a hold outcome.
 */
export const prepareOverProvidedHolds = (submission: PayStateSubmission) =>
  prepareWorkspacePayState(submission).pipe(
    Effect.provide(ReservationBooking.Default)
  );
