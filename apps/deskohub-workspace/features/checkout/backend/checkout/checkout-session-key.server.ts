import "server-only";

import { createHmac } from "node:crypto";
import { Match } from "effect";
import { env } from "@/env";
import { getCoworkCheckoutAttemptDetails } from "@/features/reservation/cowork-reservation";
import { getMeetingRoomReservationDetails } from "@/features/reservation/meeting-room-reservation";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";

type CheckoutKeyDerivationOptions = {
  readonly secret?: string;
  readonly legacySecret?: string;
};

const deriveCheckoutKey = (secret: string, payload: object) =>
  createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");

const getCheckoutKeySecrets = (
  options: CheckoutKeyDerivationOptions
): readonly [string, ...string[]] => {
  const current = options.secret ?? env.CHECKOUT_RESERVATION_HMAC_SECRET;
  const legacy =
    options.legacySecret ?? env.CHECKOUT_RESERVATION_HMAC_LEGACY_SECRET;
  return legacy === undefined ? [current] : [current, legacy];
};

const deriveCheckoutKeyCandidates = (
  payload: object,
  options: CheckoutKeyDerivationOptions
) =>
  [
    ...new Set(
      getCheckoutKeySecrets(options).map((secret) =>
        deriveCheckoutKey(secret, payload)
      )
    ),
  ] as [string, ...string[]];

export const deriveCheckoutSessionKeyCandidates = (
  checkoutSessionId: string,
  options: CheckoutKeyDerivationOptions = {}
) =>
  deriveCheckoutKeyCandidates(
    {
      checkoutSessionId,
    },
    options
  );

export const deriveCheckoutSessionKey = (
  checkoutSessionId: string,
  options: CheckoutKeyDerivationOptions = {}
) => deriveCheckoutSessionKeyCandidates(checkoutSessionId, options)[0];

type CheckoutAttemptKeyInput = {
  readonly checkoutSessionId: string;
  readonly checkoutAttemptId: string;
  readonly reservation: ReservationOrderData;
};

const getCheckoutAttemptKeyPayload = (input: CheckoutAttemptKeyInput) => {
  const reservationDetails = Match.value(input.reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: getCoworkCheckoutAttemptDetails,
      "meeting-room": getMeetingRoomReservationDetails,
    })
  );

  return {
    checkoutSessionId: input.checkoutSessionId,
    checkoutAttemptId: input.checkoutAttemptId,
    reservation: {
      name: input.reservation.name,
      email: input.reservation.email,
      phone: input.reservation.phone,
      ...reservationDetails,
    },
  };
};

export const deriveCheckoutAttemptKeyCandidates = (
  input: CheckoutAttemptKeyInput,
  options: CheckoutKeyDerivationOptions = {}
) => deriveCheckoutKeyCandidates(getCheckoutAttemptKeyPayload(input), options);

export const deriveCheckoutAttemptKey = (
  input: CheckoutAttemptKeyInput,
  options: CheckoutKeyDerivationOptions = {}
) => deriveCheckoutAttemptKeyCandidates(input, options)[0];
