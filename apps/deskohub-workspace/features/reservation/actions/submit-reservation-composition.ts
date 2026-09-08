import { Effect, Layer } from "effect";
import { CheckoutService } from "@/features/checkout/backend/checkout";
import { m } from "@/features/i18n";
import type { SubmitReservationInput } from "@/features/reservation/actions/submit-reservation-input";
import { ReservationAccessCookieError } from "@/features/reservation/backend/reservation-access-cookie";
import { ReservationAccessCookieWriter } from "@/features/reservation/backend/reservation-access-cookie.server";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { submitWorkspaceReservation } from "./submit-workspace-reservation";

const liveLayers = Layer.mergeAll(
  CheckoutService.Live,
  ReservationAccessCookieWriter.Live
);

export const submitReservationEffect = (
  input: SubmitReservationInput,
  layers = liveLayers
) =>
  submitWorkspaceReservation(input).pipe(
    Effect.provide(layers),
    Effect.mapError((error) =>
      error instanceof ReservationAccessCookieError
        ? new PublicSafeActionError({
            message: m.reservationErrorMessage({}, { locale: input.locale }),
            cause: error,
          })
        : error
    )
  );
