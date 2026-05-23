"use server";

import { StandaloneEmailServiceLayer } from "@deskohub/email/backend/standalone-email-service";
import { Effect, Layer } from "effect";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import {
  ReservationService,
  ReservationServiceLive,
} from "@/features/reservation/backend/reservation.service";
import { getReservationSchema } from "@/features/reservation/schemas/reservation";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";

const submitReservationAction = createEffectSafeAction(
  getReservationSchema(),
  (input, { locale }) =>
    Effect.gen(function* () {
      const service = yield* ReservationService;
      const submission = yield* service.submit(input, locale);
      const reservationSearchParams = new URLSearchParams({
        tier: input.entryTier,
        date: input.date,
        coffee: input.coffee ? "1" : "0",
      });

      const product = getWorkspaceProductByTier(input.entryTier);

      if (
        input.monitorOption &&
        product.allowedMonitorOptions.includes(input.monitorOption)
      ) {
        reservationSearchParams.set("monitor", input.monitorOption);
      }

      yield* Effect.logInfo("Workspace reservation submitted", {
        locale,
        submittedAt: submission.submittedAt,
        entryTier: submission.entryTier,
      });

      return {
        message: "Reservation submitted successfully",
        redirectUrl: `/${locale}/reservation/confirmation?${reservationSearchParams.toString()}`,
        submissionId: submission.submittedAt,
      };
    }).pipe(
      Effect.withSpan("submitWorkspaceReservation", {
        attributes: {
          locale,
          entryTier: input.entryTier,
        },
      })
    ),
  ReservationServiceLive.pipe(
    Layer.provide(
      Layer.provideMerge(StandaloneEmailServiceLayer, EmailConfigLayer)
    ),
    Layer.orDie
  )
);

export const submitReservation = async (
  ...args: Parameters<typeof submitReservationAction>
) => {
  "use server";
  return await submitReservationAction(...args);
};
