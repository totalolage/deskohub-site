import { createHmac } from "node:crypto";
import { Match } from "effect";
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
import type { CheckoutLookupKeys } from "./checkout-lookup-keys.server";

// Frozen copy of the derivation every worker used before keyed lookup keys
// (`checkout-session-key.server.ts`). Earlier workers still write it during a
// deployment overlap, so keep it unchanged rather than sharing production code.
const signWithKeyRing = <Payload>(keyRing: string, payload: Payload) =>
  createHmac("sha256", keyRing).update(JSON.stringify(payload)).digest("hex");

/** Ring-keyed session key, as an earlier worker stores it. */
export const deriveRingKeyedCheckoutSessionKey = (
  keyRing: string,
  checkoutSessionId: CheckoutSessionId
): CheckoutSessionKey =>
  checkoutSessionKeySchema.make(
    signWithKeyRing(keyRing, { checkoutSessionId })
  );

/** Ring-keyed attempt key, as an earlier worker stores it. */
export const deriveRingKeyedCheckoutAttemptKey = (
  keyRing: string,
  input: {
    readonly checkoutSessionId: CheckoutSessionId;
    readonly checkoutAttemptId: CheckoutAttemptId;
    readonly reservation: ReservationOrderData;
  }
): CheckoutAttemptKey => {
  const reservationDetails = Match.value(input.reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: getCoworkCheckoutAttemptDetails,
      "meeting-room": getMeetingRoomReservationDetails,
      office: getOfficeReservationDetails,
    })
  );

  return checkoutAttemptKeySchema.make(
    signWithKeyRing(keyRing, {
      checkoutSessionId: input.checkoutSessionId,
      checkoutAttemptId: input.checkoutAttemptId,
      reservation: {
        name: input.reservation.name,
        email: input.reservation.email,
        phone: input.reservation.phone,
        billing: input.reservation.billing,
        ...reservationDetails,
      },
    })
  );
};

/** The accepted lookup key derived with the configured key `kid`. */
export const findKeyIdPrefixedLookupKey = <Key extends string>(
  keys: CheckoutLookupKeys<Key>,
  kid: string
): Key => {
  const key = keys.accepted.find((accepted) => accepted.startsWith(`${kid}:`));
  if (key === undefined) {
    throw new Error(`No accepted lookup key is prefixed with ${kid}.`);
  }
  return key;
};
