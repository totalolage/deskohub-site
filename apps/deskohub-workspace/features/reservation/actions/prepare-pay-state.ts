"use server";

import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { z } from "zod/v4";
import { buildCheckoutPayPath } from "@/features/checkout/backend/checkout-pay-url";
import {
  buildSignedPayState,
  sealPayStateForUrl,
} from "@/features/checkout/backend/pay-state.server";
import {
  buildAuthoritativeWorkspaceCheckoutQuoteEffect,
  WorkspaceCheckoutQuoteLive,
} from "@/features/checkout/backend/workspace-checkout-quote.server";
import { locales, m } from "@/features/i18n";
import { getReservationOrderSchema } from "@/features/reservation/schemas/reservation";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";

const getPreparePayStateSchema = () =>
  z.object({
    locale: z.enum(locales),
    reservation: getReservationOrderSchema(),
  });

const generateOrderId = () =>
  `D${BigInt(`0x${randomUUID().replaceAll("-", "")}`)
    .toString(36)
    .toUpperCase()}`;

const preparePayStateAction = createEffectSafeAction(
  getPreparePayStateSchema(),
  Effect.fn("prepareWorkspacePayState")(
    function* (input) {
      yield* Effect.annotateLogsScoped({ locale: input.locale });
      yield* Effect.logInfo("Preparing workspace checkout quote");

      const quote = yield* buildAuthoritativeWorkspaceCheckoutQuoteEffect(
        input.reservation
      );

      yield* Effect.logInfo("Workspace checkout quote prepared");

      const state = buildSignedPayState({
        locale: input.locale,
        reservation: input.reservation,
        quote,
        orderId: generateOrderId(),
      });
      const sealedState = sealPayStateForUrl(state);
      const payUrl = buildCheckoutPayPath(input.locale, sealedState);

      if (payUrl.type !== "payPath") {
        return {
          status: "error" as const,
          message: m.checkoutPayStateTooLarge({}, { locale: input.locale }),
        };
      }

      return {
        status: "ready" as const,
        redirectUrl: payUrl.path,
      };
    },
    (effect, input) =>
      effect.pipe(
        Effect.scoped,
        Effect.annotateLogs(input),
        Effect.mapError(
          (error) =>
            new PublicSafeActionError(
              m.reservationErrorMessage({}, { locale: input.locale }),
              { cause: error }
            )
        )
      )
  ),
  WorkspaceCheckoutQuoteLive
);

export const preparePayState: typeof preparePayStateAction = async (
  ...args: Parameters<typeof preparePayStateAction>
) => {
  "use server";
  return await preparePayStateAction(...args);
};
