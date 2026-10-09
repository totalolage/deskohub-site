import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { ConfigProvider, Effect, Schema } from "effect";
import {
  type CheckoutSessionId,
  checkoutAttemptIdSchema,
  checkoutSessionIdSchema,
} from "@/features/checkout/checkout-identifiers";
import type { ReservationBillingSelectionInput } from "@/features/reservation/reservation-billing";
import { reservationOrderSchema } from "@/features/reservation/reservation-order";
import {
  deriveRingKeyedCheckoutAttemptKey,
  deriveRingKeyedCheckoutSessionKey,
  findKeyIdPrefixedLookupKey,
} from "./checkout-lookup-keys.test-utils";

mock.module("server-only", () => ({}));

const {
  deriveCheckoutAttemptKeys,
  deriveCheckoutSessionKeys,
  deriveCheckoutSessionLockKey,
} = await import("./checkout-lookup-keys.server");

const decodeReservation = <T>(input: T) =>
  Schema.decodeUnknownEffect(reservationOrderSchema)(input).pipe(
    Effect.runSync
  );

const contact = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420 777 777 777",
};

const syntheticKey = (fill: number) =>
  Buffer.alloc(32, fill).toString("base64url");
const originalKey = `original:${syntheticKey(1)}`;
const rotatedKey = `rotated:${syntheticKey(2)}`;

const withKeyRing =
  (keyRing: string) =>
  <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown({ CHECKOUT_PAY_STATE_KEYS: keyRing })
      ),
      Effect.runSync
    );

const checkoutSessionId = checkoutSessionIdSchema.make("session-id");
const checkoutAttemptId = checkoutAttemptIdSchema.make("attempt-id");
const coworkReservation = decodeReservation({
  kind: "cowork",
  ...contact,
  date: "2099-06-10",
  entryTier: "basic",
  coffee: false,
});

const sessionKeysUnder = (
  keyRing: string,
  sessionId: CheckoutSessionId = checkoutSessionId
) => withKeyRing(keyRing)(deriveCheckoutSessionKeys(sessionId));

const attemptKeysUnder = (keyRing: string) =>
  withKeyRing(keyRing)(
    deriveCheckoutAttemptKeys({
      checkoutSessionId,
      checkoutAttemptId,
      reservation: coworkReservation,
    })
  );

describe("checkout lookup key write format", () => {
  test("stores the active key's key-ID-prefixed key", () => {
    for (const [keyRing, activeKid] of [
      [originalKey, "original"],
      [`${originalKey},${rotatedKey}`, "original"],
      [`${rotatedKey},${originalKey}`, "rotated"],
    ] as const) {
      const session = sessionKeysUnder(keyRing);
      const attempt = attemptKeysUnder(keyRing);

      expect(session.current).toBe(
        findKeyIdPrefixedLookupKey(session, activeKid)
      );
      expect(attempt.current).toBe(
        findKeyIdPrefixedLookupKey(attempt, activeKid)
      );
      expect(session.current).toMatch(
        new RegExp(`^${activeKid}:[a-f0-9]{64}$`)
      );
    }
  });

  test("still accepts the ring-keyed key that earlier workers stored", () => {
    for (const keyRing of [originalKey, `${originalKey},${rotatedKey}`]) {
      expect(sessionKeysUnder(keyRing).accepted).toContain(
        deriveRingKeyedCheckoutSessionKey(keyRing, checkoutSessionId)
      );
      expect(attemptKeysUnder(keyRing).accepted).toContain(
        deriveRingKeyedCheckoutAttemptKey(keyRing, {
          checkoutSessionId,
          checkoutAttemptId,
          reservation: coworkReservation,
        })
      );
    }
    // Known answer from the pre-keyed `deriveCheckoutSessionKey`, so the
    // frozen reference cannot drift together with the production derivation.
    expect(sessionKeysUnder(originalKey).accepted).toContain(
      "ee6351f8b63fa03fc29e75e70810c05b7b3389186445a460d9b1b0252e191259"
    );
  });

  test("accepts the stored key and every configured key's prefixed key once", () => {
    const keys = sessionKeysUnder(`${rotatedKey},${originalKey}`);

    expect(keys.accepted[0]).toBe(keys.current);
    expect(new Set(keys.accepted).size).toBe(keys.accepted.length);
    expect(findKeyIdPrefixedLookupKey(keys, "rotated")).toMatch(
      /^rotated:[a-f0-9]{64}$/
    );
    expect(findKeyIdPrefixedLookupKey(keys, "original")).toMatch(
      /^original:[a-f0-9]{64}$/
    );
  });
});

describe("checkout lookup key rotation", () => {
  const prefixedSessionKeyUnder = (keyRing: string, kid: string) =>
    findKeyIdPrefixedLookupKey(sessionKeysUnder(keyRing), kid);
  const prefixedAttemptKeyUnder = (keyRing: string, kid: string) =>
    findKeyIdPrefixedLookupKey(attemptKeysUnder(keyRing), kid);

  test("derives each key's prefixed key independently of the key ring", () => {
    expect(prefixedSessionKeyUnder(originalKey, "original")).toBe(
      prefixedSessionKeyUnder(`${rotatedKey},${originalKey}`, "original")
    );
    expect(prefixedSessionKeyUnder(originalKey, "original")).not.toBe(
      prefixedSessionKeyUnder(rotatedKey, "rotated")
    );
  });

  test("keeps an in-flight checkout when a new active key is added", () => {
    const storedSession = prefixedSessionKeyUnder(originalKey, "original");
    const storedAttempt = prefixedAttemptKeyUnder(originalKey, "original");

    const rotatedRing = `${rotatedKey},${originalKey}`;

    expect(sessionKeysUnder(rotatedRing).accepted).toContain(storedSession);
    expect(attemptKeysUnder(rotatedRing).accepted).toContain(storedAttempt);
  });

  test("keeps an in-flight checkout when an unused old key is retired", () => {
    const rotatedRing = `${rotatedKey},${originalKey}`;
    const storedSession = prefixedSessionKeyUnder(rotatedRing, "rotated");
    const storedAttempt = prefixedAttemptKeyUnder(rotatedRing, "rotated");

    expect(sessionKeysUnder(rotatedKey).accepted).toContain(storedSession);
    expect(attemptKeysUnder(rotatedKey).accepted).toContain(storedAttempt);
  });

  test("stops matching a checkout only once its own key is retired", () => {
    const storedSession = prefixedSessionKeyUnder(originalKey, "original");

    expect(sessionKeysUnder(rotatedKey).accepted).not.toContain(storedSession);
  });

  test("matches a ring-keyed checkout only while the key ring is unchanged", () => {
    const ringKeyedSession = deriveRingKeyedCheckoutSessionKey(
      originalKey,
      checkoutSessionId
    );

    expect(sessionKeysUnder(originalKey).accepted).toContain(ringKeyedSession);
    expect(
      sessionKeysUnder(`${originalKey},${rotatedKey}`).accepted
    ).not.toContain(ringKeyedSession);
  });

  test("stages a non-first key for lookup without making it active", () => {
    const stagedRing = `${originalKey},${rotatedKey}`;
    const activatedRing = `${rotatedKey},${originalKey}`;

    expect(sessionKeysUnder(stagedRing).accepted).toContain(
      prefixedSessionKeyUnder(activatedRing, "rotated")
    );
    expect(sessionKeysUnder(activatedRing).accepted).toContain(
      prefixedSessionKeyUnder(stagedRing, "original")
    );
  });

  test("locks a session under one identity whatever the key ring", () => {
    const lockKey = deriveCheckoutSessionLockKey(checkoutSessionId);

    expect(deriveCheckoutSessionLockKey(checkoutSessionId)).toBe(lockKey);
    expect(
      deriveCheckoutSessionLockKey(
        checkoutSessionIdSchema.make("other-session-id")
      )
    ).not.toBe(lockKey);
  });

  test("does not accept another session's keys", () => {
    const otherSession = sessionKeysUnder(
      originalKey,
      checkoutSessionIdSchema.make("other-session-id")
    );

    for (const key of otherSession.accepted) {
      expect(sessionKeysUnder(originalKey).accepted).not.toContain(key);
    }
  });
});

describe("checkout attempt key", () => {
  const deriveAttemptKey = (
    reservation: ReturnType<typeof decodeReservation>
  ) =>
    withKeyRing(originalKey)(
      deriveCheckoutAttemptKeys({
        checkoutSessionId,
        checkoutAttemptId,
        reservation,
      })
    ).current;

  test("includes each reservation family's canonical details", () => {
    const meetingRoom = decodeReservation({
      kind: "meeting-room",
      ...contact,
      duration: { unit: "hour", amount: 4 },
      reservationDate: "2099-06-10",
      startsAt: "2099-06-10T08:00:00Z",
      endsAt: "2099-06-10T12:00:00Z",
    });
    const laterMeetingRoom = decodeReservation({
      kind: "meeting-room",
      ...contact,
      duration: { unit: "hour", amount: 4 },
      reservationDate: "2099-06-10",
      startsAt: "2099-06-10T09:00:00Z",
      endsAt: "2099-06-10T13:00:00Z",
    });

    const keys = [
      deriveAttemptKey(coworkReservation),
      deriveAttemptKey(meetingRoom),
      deriveAttemptKey(laterMeetingRoom),
    ];
    expect(new Set(keys).size).toBe(3);
  });

  test("changes when reservation purpose or billing identity changes", () => {
    const base = {
      kind: "cowork",
      ...contact,
      date: "2099-06-10",
      entryTier: "basic",
      coffee: false,
    };
    const getKey = (billing: ReservationBillingSelectionInput) =>
      deriveAttemptKey(decodeReservation({ ...base, billing }));
    const address = {
      line1: "Synthetic street 1",
      city: "Prague",
      postalCode: "100 00",
      country: "CZ",
    };

    const keys = [
      getKey({ purpose: "personal", invoice: "none" }),
      getKey({ purpose: "personal", invoice: "requested", address }),
      getKey({
        purpose: "personal",
        invoice: "requested",
        address: { ...address, postalCode: "100 01" },
      }),
      getKey({
        purpose: "business",
        invoice: "required",
        buyer: {
          kind: "business",
          legalName: "Synthetic Company s.r.o.",
          companyId: "12345678",
          address,
        },
      }),
    ];

    expect(new Set(keys).size).toBe(keys.length);
  });
});
