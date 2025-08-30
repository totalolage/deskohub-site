"use server";

import { Effect, Layer } from "effect";
import { redirect } from "next/navigation";
import { StandaloneEmailServiceLive } from "@/features/email";
import {
  TrainingReservationService,
  TrainingReservationServiceLive,
} from "@/features/training/reservation/backend/training-reservation.service";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";
import { type ReservationFormData, reservationSchema } from "../schemas/reservation";

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
        // Include the input data for the redirect
        formData: input,
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

  // If successful, redirect to confirmation page with query parameters
  if (result?.data?.success && result.data.formData) {
    const input = result.data.formData;
    
    // Build query parameters from the form data
    const params = new URLSearchParams();

    // Add name fields (prefer company for display, fallback to full name)
    if (input.company) {
      params.append("company", input.company);
    }
    if (input.firstName) {
      params.append("firstName", input.firstName);
    }
    if (input.lastName) {
      params.append("lastName", input.lastName);
    }
    if (input.role) {
      params.append("role", input.role);
    }

    // Add contact and reservation details
    params.append("email", input.email);
    params.append("phone", input.phone);
    params.append("date", input.date.toISOString());
    params.append("time", input.time);
    params.append("duration", input.duration.toString());

    if (input.specialRequirements) {
      params.append("specialRequirements", input.specialRequirements);
    }

    // Redirect to confirmation page with query parameters
    redirect(`/training-room/reservation/confirmation?${params.toString()}`);
  }

  return result;
};
