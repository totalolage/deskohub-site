import "server-only";

import { createHmac } from "node:crypto";
import { Match } from "effect";
import { env } from "@/env";
import { getCoworkCheckoutAttemptDetails } from "@/features/reservation/cowork-reservation";
import { getMeetingRoomReservationDetails } from "@/features/reservation/meeting-room-reservation";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";

type CheckoutKeyDerivationOptions = {
  readonly rawPayStateKeys?: string;
  readonly dedicatedSecret?: string;
  readonly cutoverAt?: string;
  readonly legacyReadUntil?: string;
  readonly now?: () => Date;
};

export type CheckoutKeySet = {
  readonly current: string;
  readonly identity: string;
  readonly candidates: readonly [string, ...string[]];
};

const deriveCheckoutKey = (secret: string, payload: object) =>
  createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");

const getCheckoutKeySecretSet = (
  options: CheckoutKeyDerivationOptions
): {
  readonly current: string;
  readonly identity: string;
  readonly candidates: readonly [string, ...string[]];
} => {
  const rawPayStateKeys =
    options.rawPayStateKeys ?? env.CHECKOUT_PAY_STATE_KEYS;
  const cutoverAt =
    options.cutoverAt ?? env.CHECKOUT_RESERVATION_HMAC_CUTOVER_AT;
  const legacyReadUntil =
    options.legacyReadUntil ?? env.CHECKOUT_RESERVATION_HMAC_LEGACY_READ_UNTIL;
  if (cutoverAt === undefined || legacyReadUntil === undefined) {
    return {
      current: rawPayStateKeys,
      identity: rawPayStateKeys,
      candidates: [rawPayStateKeys],
    };
  }

  const dedicatedSecret =
    options.dedicatedSecret ?? env.CHECKOUT_RESERVATION_HMAC_SECRET;
  if (dedicatedSecret === undefined) {
    throw new Error(
      "Checkout reservation HMAC cutover is missing dedicated material."
    );
  }

  const now = (options.now?.() ?? new Date()).getTime();
  if (now < Date.parse(cutoverAt)) {
    return {
      current: rawPayStateKeys,
      identity: rawPayStateKeys,
      candidates: [rawPayStateKeys],
    };
  }
  if (now >= Date.parse(legacyReadUntil)) {
    return {
      current: dedicatedSecret,
      identity: dedicatedSecret,
      candidates: [dedicatedSecret],
    };
  }
  return {
    current: dedicatedSecret,
    identity: rawPayStateKeys,
    candidates: [dedicatedSecret, rawPayStateKeys],
  };
};

const deriveCheckoutKeySet = (
  payload: object,
  options: CheckoutKeyDerivationOptions
) => {
  const secrets = getCheckoutKeySecretSet(options);
  const candidates = [
    ...new Set(
      secrets.candidates.map((secret) => deriveCheckoutKey(secret, payload))
    ),
  ] as [string, ...string[]];

  return {
    current: deriveCheckoutKey(secrets.current, payload),
    identity: deriveCheckoutKey(secrets.identity, payload),
    candidates,
  } satisfies CheckoutKeySet;
};

export const deriveCheckoutSessionKeys = (
  checkoutSessionId: string,
  options: CheckoutKeyDerivationOptions = {}
) =>
  deriveCheckoutKeySet(
    {
      checkoutSessionId,
    },
    options
  );

export const deriveCheckoutSessionKeyCandidates = (
  checkoutSessionId: string,
  options: CheckoutKeyDerivationOptions = {}
) => deriveCheckoutSessionKeys(checkoutSessionId, options).candidates;

export const deriveCheckoutSessionKey = (
  checkoutSessionId: string,
  options: CheckoutKeyDerivationOptions = {}
) => deriveCheckoutSessionKeys(checkoutSessionId, options).current;

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

export const deriveCheckoutAttemptKeys = (
  input: CheckoutAttemptKeyInput,
  options: CheckoutKeyDerivationOptions = {}
) => deriveCheckoutKeySet(getCheckoutAttemptKeyPayload(input), options);

export const deriveCheckoutAttemptKeyCandidates = (
  input: CheckoutAttemptKeyInput,
  options: CheckoutKeyDerivationOptions = {}
) => deriveCheckoutAttemptKeys(input, options).candidates;

export const deriveCheckoutAttemptKey = (
  input: CheckoutAttemptKeyInput,
  options: CheckoutKeyDerivationOptions = {}
) => deriveCheckoutAttemptKeys(input, options).current;
