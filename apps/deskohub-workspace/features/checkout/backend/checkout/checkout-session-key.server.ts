import "server-only";

import { createHmac } from "node:crypto";
import { Match } from "effect";
import { env } from "@/env";
import { getCoworkCheckoutAttemptDetails } from "@/features/reservation/cowork-reservation";
import { getMeetingRoomCheckoutAttemptDetails } from "@/features/reservation/meeting-room-reservation";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";

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
  readonly reservation: ReservationOrderData;
}) => {
  const reservationDetails = Match.value(input.reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: getCoworkCheckoutAttemptDetails,
      "meeting-room": getMeetingRoomCheckoutAttemptDetails,
    })
  );

  return deriveCheckoutKey({
    checkoutSessionId: input.checkoutSessionId,
    checkoutAttemptId: input.checkoutAttemptId,
    reservation: {
      name: input.reservation.name,
      email: input.reservation.email,
      phone: input.reservation.phone,
      ...reservationDetails,
    },
  });
};
