"use server";

import { Effect, Layer } from "effect";
import { m } from "@/features/i18n/paraglide/messages";
import { TrainingReservationService } from "@/features/training/reservation/backend/training-reservation.service";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";
import { reservationSchema } from "../schemas/reservation";
import { trainingReservationConfirmationUrl } from "./confirmation-url";

// Create the internal action using the service layer
const _submitTrainingRoomReservation = createEffectSafeAction(
  reservationSchema,
  (input, { locale }) =>
    Effect.gen(function* () {
      yield* Effect.annotateLogsScoped({ input, locale });
      yield* Effect.logInfo("Training room reservation action started");

      const service = yield* TrainingReservationService;
      const submission = yield* service.submit(input, locale).pipe(
        Effect.tapError((error) =>
          Effect.logError(
            "Training room reservation action service submit failed",
            {
              error,
              input,
              locale,
            }
          )
        )
      );
      yield* Effect.annotateLogsScoped({ submission });

      yield* Effect.logInfo(
        `Training room reservation submitted: ${submission.submittedAt} for locale: ${locale}`
      );

      const redirectUrl = trainingReservationConfirmationUrl(input);

      const result = {
        success: true,
        message: m["trainingReservation.successMessage"](undefined, { locale }),
        submissionId: submission.submittedAt,
        redirectUrl,
      };
      yield* Effect.annotateLogsScoped({ result });
      yield* Effect.logDebug("Training room reservation action completed");

      return result;
    }).pipe(
      Effect.scoped,
      Effect.tapError((error) =>
        Effect.logError("Training room reservation action failed", {
          error,
          input,
          locale,
        })
      ),
      Effect.withSpan("submitTrainingRoomReservation", {
        attributes: {
          locale,
          input,
        },
      })
    ),
  TrainingReservationService.Live.pipe(Layer.orDie)
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
