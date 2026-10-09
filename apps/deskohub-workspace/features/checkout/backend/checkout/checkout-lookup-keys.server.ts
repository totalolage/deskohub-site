import "server-only";

import { createHmac, hkdfSync } from "node:crypto";
import { Config, Effect, Match } from "effect";
import {
  type CheckoutAttemptId,
  type CheckoutSessionId,
  checkoutAttemptKeySchema,
  checkoutSessionKeySchema,
} from "@/features/checkout/checkout-identifiers";
import { getCoworkCheckoutAttemptDetails } from "@/features/reservation/cowork-reservation";
import { getMeetingRoomReservationDetails } from "@/features/reservation/meeting-room-reservation";
import { getOfficeReservationDetails } from "@/features/reservation/office-reservation";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";
import {
  type CheckoutStateKey,
  CheckoutStateTokenError,
  parseCheckoutStateKeys,
} from "./checkout-state-token";

/**
 * Persisted one-way lookup keys for one checkout identifier.
 *
 * New rows store `current`, derived with the active Pay-state key and prefixed
 * with its key ID. Lookups accept every configured key's derivation, so adding
 * a new active key or retiring an unused one never orphans a checkout in
 * flight. `accepted` also contains the derivation used before keyed lookup
 * keys existed, which was keyed by the whole configured key ring; it only
 * matches while that ring is unchanged since the row was written.
 */
export interface CheckoutLookupKeys<Key extends string> {
  readonly current: Key;
  readonly accepted: readonly [Key, ...Key[]];
}

export const deriveCheckoutSessionKeys = Effect.fn(
  "checkoutLookupKeys.deriveSessionKeys"
)((checkoutSessionId: CheckoutSessionId) =>
  deriveCheckoutLookupKeys({ checkoutSessionId }, checkoutSessionKeySchema.make)
);

export const deriveCheckoutAttemptKeys = Effect.fn(
  "checkoutLookupKeys.deriveAttemptKeys"
)(function* (input: {
  readonly checkoutSessionId: CheckoutSessionId;
  readonly checkoutAttemptId: CheckoutAttemptId;
  readonly reservation: ReservationOrderData;
}) {
  const reservationDetails = Match.value(input.reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: getCoworkCheckoutAttemptDetails,
      "meeting-room": getMeetingRoomReservationDetails,
      office: getOfficeReservationDetails,
    })
  );

  return yield* deriveCheckoutLookupKeys(
    {
      checkoutSessionId: input.checkoutSessionId,
      checkoutAttemptId: input.checkoutAttemptId,
      reservation: {
        name: input.reservation.name,
        email: input.reservation.email,
        phone: input.reservation.phone,
        billing: input.reservation.billing,
        ...reservationDetails,
      },
    },
    checkoutAttemptKeySchema.make
  );
});

const lookupKeyDerivationInfo = "deskohub-workspace/checkout-lookup-key";
const lookupKeyByteLength = 32;

const deriveCheckoutLookupKeys = <Payload, Key extends string>(
  payload: Payload,
  toKey: (value: string) => Key
) =>
  loadCheckoutLookupKeyRing.pipe(
    Effect.map(({ configuredKeyRing, keys: [activeKey, ...otherKeys] }) => {
      const deriveKeyed = (key: CheckoutStateKey) =>
        toKey(`${key.kid}:${signLookupKey(deriveLookupSecret(key), payload)}`);
      const current = deriveKeyed(activeKey);
      const lookupKeys: CheckoutLookupKeys<Key> = {
        current,
        accepted: [
          current,
          ...otherKeys.map(deriveKeyed),
          toKey(signLookupKey(configuredKeyRing, payload)),
        ],
      };
      return lookupKeys;
    })
  );

const loadCheckoutLookupKeyRing = Effect.gen(function* () {
  const configuredKeyRing = yield* Config.string(
    "CHECKOUT_PAY_STATE_KEYS"
  ).pipe(
    Effect.mapError(
      (cause) =>
        new CheckoutStateTokenError({
          code: "invalid-secret",
          message: "Workspace checkout state configuration is invalid.",
          cause,
        })
    )
  );
  const keys = yield* parseCheckoutStateKeys(configuredKeyRing);

  return { configuredKeyRing, keys };
});

// Separates lookup-key HMACs from the same key's Pay-state encryption use.
const deriveLookupSecret = (key: CheckoutStateKey) =>
  Buffer.from(
    hkdfSync(
      "sha256",
      key.key,
      Buffer.alloc(0),
      lookupKeyDerivationInfo,
      lookupKeyByteLength
    )
  );

const signLookupKey = <Payload>(secret: Buffer | string, payload: Payload) =>
  createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");
