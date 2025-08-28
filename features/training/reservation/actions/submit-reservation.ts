"use server";

import { Effect, Layer } from "effect";
import { redirect } from "next/navigation";
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

      return {
        success: true,
        message:
          locale === "cs-CZ"
            ? "Rezervace byla úspěšně odeslána"
            : "Reservation submitted successfully",
        submissionId: submission.submittedAt,
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

  // If successful, redirect to confirmation page
  if (result?.data?.success) {
    // Redirect to static confirmation page (no ID needed)
    redirect(`/training-room/reservation/confirmation`);
  }

  return result;
};