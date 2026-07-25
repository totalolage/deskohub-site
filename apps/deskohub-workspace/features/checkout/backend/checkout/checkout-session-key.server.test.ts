import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Schema } from "effect";
import { reservationOrderSchema } from "@/features/reservation/reservation-order";
import { generateSyntheticSecretValues } from "@/shared/testing/synthetic-secrets";

mock.module("server-only", () => ({}));

const decodeReservation = (input: unknown) =>
  Schema.decodeUnknownEffect(reservationOrderSchema)(input).pipe(
    Effect.runSync
  );

const contact = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420 777 777 777",
};

describe("checkout attempt key", () => {
  test("includes each reservation family's canonical details", async () => {
    const { deriveCheckoutAttemptKey } = await import(
      "./checkout-session-key.server"
    );
    const getKey = (reservation: ReturnType<typeof decodeReservation>) =>
      deriveCheckoutAttemptKey({
        checkoutSessionId: "session-id",
        checkoutAttemptId: "attempt-id",
        reservation,
      });
    const cowork = decodeReservation({
      kind: "cowork",
      ...contact,
      date: "2099-06-10",
      entryTier: "basic",
      coffee: false,
    });
    const meetingRoom = decodeReservation({
      kind: "meeting-room",
      ...contact,
      startsAt: "2099-06-10T08:00:00Z",
      endsAt: "2099-06-10T12:00:00Z",
    });
    const laterMeetingRoom = decodeReservation({
      kind: "meeting-room",
      ...contact,
      startsAt: "2099-06-10T09:00:00Z",
      endsAt: "2099-06-10T13:00:00Z",
    });

    const keys = [
      getKey(cowork),
      getKey(meetingRoom),
      getKey(laterMeetingRoom),
    ];
    expect(new Set(keys).size).toBe(3);
    for (const key of keys) {
      expect(key).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  test("writes with stable material and retains a distinct legacy read candidate", async () => {
    const {
      deriveCheckoutAttemptKey,
      deriveCheckoutAttemptKeyCandidates,
      deriveCheckoutSessionKey,
      deriveCheckoutSessionKeyCandidates,
    } = await import("./checkout-session-key.server");
    const [secret, legacySecret, replacementLegacySecret] =
      generateSyntheticSecretValues();
    const reservation = decodeReservation({
      kind: "cowork",
      ...contact,
      date: "2099-06-10",
      entryTier: "basic",
      coffee: false,
    });
    const attemptInput = {
      checkoutSessionId: "migration-session-id",
      checkoutAttemptId: "migration-attempt-id",
      reservation,
    };
    const options = { secret, legacySecret };
    const sessionCandidates = deriveCheckoutSessionKeyCandidates(
      attemptInput.checkoutSessionId,
      options
    );
    const attemptCandidates = deriveCheckoutAttemptKeyCandidates(
      attemptInput,
      options
    );

    expect(sessionCandidates).toHaveLength(2);
    expect(attemptCandidates).toHaveLength(2);
    expect(sessionCandidates[0]).toBe(
      deriveCheckoutSessionKey(attemptInput.checkoutSessionId, options)
    );
    expect(attemptCandidates[0]).toBe(
      deriveCheckoutAttemptKey(attemptInput, options)
    );
    expect(
      deriveCheckoutSessionKeyCandidates(attemptInput.checkoutSessionId, {
        secret,
        legacySecret: replacementLegacySecret,
      })[0]
    ).toBe(sessionCandidates[0]);
    expect(
      deriveCheckoutAttemptKeyCandidates(attemptInput, {
        secret,
        legacySecret: replacementLegacySecret,
      })[0]
    ).toBe(attemptCandidates[0]);
  });

  test("deduplicates matching current and legacy material", async () => {
    const { deriveCheckoutSessionKeyCandidates } = await import(
      "./checkout-session-key.server"
    );
    const [secret] = generateSyntheticSecretValues();

    expect(
      deriveCheckoutSessionKeyCandidates("deduplicated-session-id", {
        secret,
        legacySecret: secret,
      })
    ).toHaveLength(1);
  });
});
