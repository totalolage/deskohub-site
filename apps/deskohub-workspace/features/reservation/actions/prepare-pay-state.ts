"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { buildCheckoutPayPath } from "@/features/checkout/backend/checkout-pay-url";
import {
  buildSignedPayState,
  sealPayStateForUrl,
} from "@/features/checkout/backend/pay-state.server";
import { buildAuthoritativeWorkspaceCheckoutQuote } from "@/features/checkout/backend/workspace-checkout-quote.server";
import { locales, m } from "@/features/i18n";
import { getReservationOrderSchema } from "@/features/reservation/schemas/reservation";
import {
  actionClient,
  PublicSafeActionError,
} from "@/shared/utils/safe-action-client";

const getPreparePayStateSchema = () =>
  z.object({
    locale: z.enum(locales),
    reservation: getReservationOrderSchema(),
  });

const generateOrderId = () =>
  `D${BigInt(`0x${randomUUID().replaceAll("-", "")}`)
    .toString(36)
    .toUpperCase()}`;

const preparePayStateAction = actionClient
  .inputSchema(getPreparePayStateSchema())
  .action(async ({ parsedInput }) => {
    const quote = await buildAuthoritativeWorkspaceCheckoutQuote(
      parsedInput.reservation
    );
    const state = buildSignedPayState({
      locale: parsedInput.locale,
      reservation: parsedInput.reservation,
      quote,
      orderId: generateOrderId(),
    });
    const sealedState = sealPayStateForUrl(state);
    const payUrl = buildCheckoutPayPath(parsedInput.locale, sealedState);

    if (payUrl.type !== "payPath") {
      return {
        status: "error" as const,
        message: m.checkoutPayStateTooLarge({}, { locale: parsedInput.locale }),
      };
    }

    return {
      status: "ready" as const,
      redirectUrl: payUrl.path,
    };
  });

export const preparePayState: typeof preparePayStateAction = async (
  ...args: Parameters<typeof preparePayStateAction>
) => {
  "use server";
  try {
    return await preparePayStateAction(...args);
  } catch (error) {
    if (error instanceof PublicSafeActionError) throw error;
    throw new PublicSafeActionError(m.reservationErrorMessage());
  }
};
