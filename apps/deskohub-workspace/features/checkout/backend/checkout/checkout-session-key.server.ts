import "server-only";

import { createHmac } from "node:crypto";
import { env } from "@/env";
import {
  getNormalizedCoworkReservationAttemptIdentity,
  type NormalizedCoworkReservationOrder,
} from "@/features/reservation/cowork-reservation";

const deriveCheckoutKey = (payload: object) =>
  createHmac("sha256", env.CHECKOUT_PAY_STATE_KEYS)
    .update(JSON.stringify(payload))
    .digest("hex");

export const deriveCheckoutSessionKey = (checkoutSessionId: string) =>
  deriveCheckoutKey({
    checkoutSessionId,
  });

export const deriveCheckoutAttemptKey = (input: {
  readonly checkoutSessionId: string;
  readonly checkoutAttemptId: string;
  readonly reservation: NormalizedCoworkReservationOrder;
}) =>
  deriveCheckoutKey({
    checkoutSessionId: input.checkoutSessionId,
    checkoutAttemptId: input.checkoutAttemptId,
    reservation: getNormalizedCoworkReservationAttemptIdentity(
      input.reservation
    ),
  });
