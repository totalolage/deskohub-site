import "server-only";

import { createHash, createHmac, hkdfSync } from "node:crypto";
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
 * New rows store `current`, in the format selected by
 * {@link storedLookupKeyFormat}. `accepted` starts with `current` and contains
 * both formats: every configured key's key-ID-prefixed derivation, so adding a
 * new active key or retiring an unused one never orphans a checkout in flight,
 * and the ring-keyed derivation, which only matches while the configured key
 * ring is unchanged since the row was written.
 */
export interface CheckoutLookupKeys<Key extends string> {
  readonly current: Key;
  readonly accepted: readonly [Key, ...Key[]];
}

/**
 * Advisory-lock identity of one raw checkout session. It must not depend on
 * the configured key ring, so workers with different active keys serialize
 * on the same lock. The unkeyed domain-separated digest keeps the raw
 * browser ID out of database parameters and query logs.
 */
export const deriveCheckoutSessionLockKey = (
  checkoutSessionId: CheckoutSessionId
): bigint =>
  createHash("sha256")
    .update(checkoutSessionLockDomain)
    .update(checkoutSessionId)
    .digest()
    .readBigInt64BE(0);

const checkoutSessionLockDomain = "deskohub-workspace/checkout-session-lock\0";

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

/**
 * Lookup-key formats a row can store.
 *
 * - `ring-keyed`: unprefixed hex HMAC keyed by the whole configured
 *   `CHECKOUT_PAY_STATE_KEYS` string. Every worker before keyed lookup keys
 *   writes and reads only this format, without the draft-creation lock.
 * - `key-id-prefixed`: `<kid>:<hex HMAC>` keyed by an HKDF subkey of the active
 *   Pay-state key. It survives key-ring rotation.
 */
type LookupKeyFormat = "ring-keyed" | "key-id-prefixed";

/**
 * Format stored on new rows. Lookups always accept both formats.
 *
 * The write format changes in two separate deployments because Vercel keeps
 * serving in-flight requests on the previous deployment:
 *
 * 1. `ring-keyed`: earlier workers neither read prefixed keys nor take the
 *    draft-creation lock, so new rows kept their format and the two versions
 *    still collided on the stored-key unique indexes.
 * 2. `key-id-prefixed` (this value): only after step 1 is the sole deployment
 *    serving traffic. Both versions then take the lock and read both formats.
 *
 * Rotate `CHECKOUT_PAY_STATE_KEYS` only after step 2 is the sole deployment
 * serving traffic and no `held` row or row with `pending` payment still
 * stores a ring-keyed key.
 */
const storedLookupKeyFormat: LookupKeyFormat = "key-id-prefixed";

const lookupKeyDerivationInfo = "deskohub-workspace/checkout-lookup-key";
const lookupKeyByteLength = 32;

const deriveCheckoutLookupKeys = <Payload, Key extends string>(
  payload: Payload,
  toKey: (value: string) => Key
) =>
  loadCheckoutLookupKeyRing.pipe(
    Effect.map(({ configuredKeyRing, keys: [activeKey, ...otherKeys] }) => {
      const deriveKeyIdPrefixed = (key: CheckoutStateKey) =>
        toKey(`${key.kid}:${signLookupKey(deriveLookupSecret(key), payload)}`);
      const activeKeyIdPrefixed = deriveKeyIdPrefixed(activeKey);
      const ringKeyed = toKey(signLookupKey(configuredKeyRing, payload));
      const current = {
        "ring-keyed": ringKeyed,
        "key-id-prefixed": activeKeyIdPrefixed,
      }[storedLookupKeyFormat];
      const lookupKeys: CheckoutLookupKeys<Key> = {
        current,
        accepted: [
          current,
          ...[
            activeKeyIdPrefixed,
            ...otherKeys.map(deriveKeyIdPrefixed),
            ringKeyed,
          ].filter((key) => key !== current),
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
