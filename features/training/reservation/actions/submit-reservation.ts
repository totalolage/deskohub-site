"use server";

import { Effect, Layer } from "effect";
import { StandaloneEmailServiceLive } from "@/features/email";
import {
  TrainingReservationService,
  TrainingReservationServiceLive,
} from "@/features/training/reservation/backend/training-reservation.service";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";
import { reservationSchema } from "../schemas/reservation";

// Create the internal action using the service layer
const _submitTrainingRoomReservation = createEffectSafeAction(
  reservationSchema,
  (input, { locale }) =>
    Effect.gen(function* () {
      const service = yield* TrainingReservationService;
      const submission = yield* service.submit(input, locale);

      yield* Effect.logInfo(
        `Training room reservation submitted: ${submission.submittedAt} for locale: ${locale}`
      );

      // Build query parameters from the form data
      const params = new URLSearchParams();

      // Add name fields (prefer company for display, fallback to full name)
      if (input.company) {
        params.set("company", input.company);
      }
      if (input.firstName) {
        params.set("firstName", input.firstName);
      }
      if (input.lastName) {
        params.set("lastName", input.lastName);
      }
      if (input.role) {
        params.set("role", input.role);
      }

      // Add contact and reservation details
      params.set("email", input.email);
      params.set("phone", input.phone);
      params.set("date", input.date.toISOString());
      params.set("time", input.time);
      params.set("duration", input.duration.toString());

      if (input.specialRequirements) {
        params.set("specialRequirements", input.specialRequirements);
      }

      // Build the full URL with query parameters
      const queryString = params.toString();
      const redirectUrl = `/training-room/reservation/confirmation?${queryString}`;

      return {
        success: true,
        message:
          locale === "cs-CZ"
            ? "Rezervace byla úspěšně odeslána"
            : "Reservation submitted successfully",
        submissionId: submission.submittedAt,
        redirectUrl,
      };
    }).pipe(
      Effect.withSpan("submitTrainingRoomReservation", {
        attributes: {
          locale,
          input,
        },
      })
    ),
  // Provide TrainingReservationServiceLive with its email service dependency
  TrainingReservationServiceLive.pipe(
    Layer.provide(StandaloneEmailServiceLive),
    Layer.orDie
  )
);

// Export an explicitly async wrapper that Next.js will recognize
export const submitTrainingRoomReservation = async (
  ...args: Parameters<typeof _submitTrainingRoomReservation>
) => {
  "use server";
  const result = await _submitTrainingRoomReservation(...args);

  // Just return the result - client will handle the redirect
  return result;
};
