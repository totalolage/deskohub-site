import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { createHmac } from "node:crypto";
import { ConfigProvider, Effect, Schema } from "effect";
import {
  type CheckoutSessionId,
  checkoutAttemptIdSchema,
  checkoutSessionIdSchema,
} from "@/features/checkout/checkout-identifiers";
import type { ReservationBillingSelectionInput } from "@/features/reservation/reservation-billing";
import { reservationOrderSchema } from "@/features/reservation/reservation-order";

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

describe("checkout lookup key rotation", () => {
  test("stores keys derived with the active key and labelled with its key ID", () => {
    const session = sessionKeysUnder(`${rotatedKey},${originalKey}`);
    const attempt = attemptKeysUnder(`${rotatedKey},${originalKey}`);

    expect(session.current).toMatch(/^rotated:[a-f0-9]{64}$/);
    expect(attempt.current).toMatch(/^rotated:[a-f0-9]{64}$/);
    expect(session.current).not.toBe(sessionKeysUnder(originalKey).current);
  });

  test("keeps an in-flight checkout when a new active key is added", () => {
    const storedSession = sessionKeysUnder(originalKey).current;
    const storedAttempt = attemptKeysUnder(originalKey).current;

    const rotatedRing = `${rotatedKey},${originalKey}`;

    expect(sessionKeysUnder(rotatedRing).accepted).toContain(storedSession);
    expect(attemptKeysUnder(rotatedRing).accepted).toContain(storedAttempt);
  });

  test("keeps an in-flight checkout when an unused old key is retired", () => {
    const rotatedRing = `${rotatedKey},${originalKey}`;
    const storedSession = sessionKeysUnder(rotatedRing).current;
    const storedAttempt = attemptKeysUnder(rotatedRing).current;

    expect(sessionKeysUnder(rotatedKey).accepted).toContain(storedSession);
    expect(attemptKeysUnder(rotatedKey).accepted).toContain(storedAttempt);
  });

  test("stops matching a checkout only once its own key is retired", () => {
    const storedSession = sessionKeysUnder(originalKey).current;

    expect(sessionKeysUnder(rotatedKey).accepted).not.toContain(storedSession);
  });

  test("keeps checkouts stored before keyed lookup keys until the key ring changes", () => {
    const preKeyedSession = createHmac("sha256", originalKey)
      .update(JSON.stringify({ checkoutSessionId }))
      .digest("hex");

    expect(sessionKeysUnder(originalKey).accepted).toContain(preKeyedSession);
  });

  test("stages a non-first key for lookup without making it active", () => {
    const staged = sessionKeysUnder(`${originalKey},${rotatedKey}`);
    const activated = sessionKeysUnder(`${rotatedKey},${originalKey}`);

    expect(staged.current).toMatch(/^original:/);
    expect(staged.accepted).toContain(activated.current);
    expect(activated.accepted).toContain(staged.current);
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
    for (const key of keys) {
      expect(key).toMatch(/^original:[a-f0-9]{64}$/);
    }
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
