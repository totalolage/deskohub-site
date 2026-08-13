import "server-only";

import { createHmac } from "node:crypto";
import { Match } from "effect";
import { env } from "@/env";
import {
  type CheckoutAttemptId,
  type CheckoutAttemptKey,
  type CheckoutSessionId,
  type CheckoutSessionKey,
  checkoutAttemptKeySchema,
  checkoutSessionKeySchema,
} from "@/features/checkout/checkout-identifiers";
import { getCoworkCheckoutAttemptDetails } from "@/features/reservation/cowork-reservation";
import { getMeetingRoomReservationDetails } from "@/features/reservation/meeting-room-reservation";
import { getOfficeReservationDetails } from "@/features/reservation/office-reservation";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";

const deriveCheckoutKey = <Payload>(payload: Payload) =>
  createHmac("sha256", env.CHECKOUT_PAY_STATE_KEYS)
    .update(JSON.stringify(payload))
    .digest("hex");

const decodeCheckoutSessionKey = checkoutSessionKeySchema.make;
const decodeCheckoutAttemptKey = checkoutAttemptKeySchema.make;

export const deriveCheckoutSessionKey = (
  checkoutSessionId: CheckoutSessionId
): CheckoutSessionKey =>
  decodeCheckoutSessionKey(deriveCheckoutKey({ checkoutSessionId }));

export const deriveCheckoutAttemptKey = (input: {
  readonly checkoutSessionId: CheckoutSessionId;
  readonly checkoutAttemptId: CheckoutAttemptId;
  readonly reservation: ReservationOrderData;
}): CheckoutAttemptKey => {
  const reservationDetails = Match.value(input.reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: getCoworkCheckoutAttemptDetails,
      "meeting-room": getMeetingRoomReservationDetails,
      office: getOfficeReservationDetails,
    })
  );

  return decodeCheckoutAttemptKey(
    deriveCheckoutKey({
      checkoutSessionId: input.checkoutSessionId,
      checkoutAttemptId: input.checkoutAttemptId,
      reservation: {
        name: input.reservation.name,
        email: input.reservation.email,
        phone: input.reservation.phone,
        ...reservationDetails,
      },
    })
  );
};
