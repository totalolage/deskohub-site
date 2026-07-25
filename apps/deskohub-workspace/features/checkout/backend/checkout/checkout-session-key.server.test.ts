import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { createHmac } from "node:crypto";
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

  test("matches old raw pay-state-key writes throughout the bridge phase", async () => {
    const {
      deriveCheckoutAttemptKey,
      deriveCheckoutAttemptKeyCandidates,
      deriveCheckoutSessionKey,
      deriveCheckoutSessionKeyCandidates,
    } = await import("./checkout-session-key.server");
    const [rawPayStateKeys, dedicatedSecret, replacementDedicatedSecret] =
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
    const bridgeOptions = {
      rawPayStateKeys,
      dedicatedSecret,
      cutoverAt: "2026-06-01T11:00:00.000Z",
      legacyReadUntil: "2026-06-01T11:30:00.000Z",
      now: () => new Date("2026-06-01T10:00:00.000Z"),
    };
    const sessionCandidates = deriveCheckoutSessionKeyCandidates(
      attemptInput.checkoutSessionId,
      bridgeOptions
    );
    const attemptCandidates = deriveCheckoutAttemptKeyCandidates(
      attemptInput,
      bridgeOptions
    );
    const oldSessionKey = createHmac("sha256", rawPayStateKeys)
      .update(
        JSON.stringify({
          checkoutSessionId: attemptInput.checkoutSessionId,
        })
      )
      .digest("hex");

    expect(sessionCandidates).toEqual([oldSessionKey]);
    expect(attemptCandidates).toHaveLength(1);
    expect(
      deriveCheckoutSessionKey(attemptInput.checkoutSessionId, bridgeOptions)
    ).toBe(oldSessionKey);
    expect(deriveCheckoutAttemptKey(attemptInput, bridgeOptions)).toBe(
      attemptCandidates[0]
    );
    expect(
      deriveCheckoutSessionKey(attemptInput.checkoutSessionId, {
        ...bridgeOptions,
        dedicatedSecret: replacementDedicatedSecret,
      })
    ).toBe(oldSessionKey);
    expect(
      deriveCheckoutAttemptKey(attemptInput, {
        ...bridgeOptions,
        dedicatedSecret: replacementDedicatedSecret,
      })
    ).toBe(attemptCandidates[0]);
  });

  test("switches writes at cutover and removes raw reads at the exact deadline", async () => {
    const { deriveCheckoutSessionKey, deriveCheckoutSessionKeyCandidates } =
      await import("./checkout-session-key.server");
    const [rawPayStateKeys, dedicatedSecret] = generateSyntheticSecretValues();
    const checkoutSessionId = "scheduled-cutover-session";
    const cutoverAt = "2026-06-01T10:00:00.000Z";
    const legacyReadUntil = "2026-06-01T10:30:00.000Z";
    const getOptions = (now: string) => ({
      rawPayStateKeys,
      dedicatedSecret,
      cutoverAt,
      legacyReadUntil,
      now: () => new Date(now),
    });
    const legacyKey = deriveCheckoutSessionKey(
      checkoutSessionId,
      getOptions("2026-06-01T09:59:59.999Z")
    );
    const cutoverCandidates = deriveCheckoutSessionKeyCandidates(
      checkoutSessionId,
      getOptions(cutoverAt)
    );

    expect(cutoverCandidates).toHaveLength(2);
    expect(cutoverCandidates[0]).not.toBe(legacyKey);
    expect(cutoverCandidates[1]).toBe(legacyKey);
    expect(
      deriveCheckoutSessionKeyCandidates(
        checkoutSessionId,
        getOptions("2026-06-01T10:29:59.999Z")
      )
    ).toEqual(cutoverCandidates);
    expect(
      deriveCheckoutSessionKeyCandidates(
        checkoutSessionId,
        getOptions(legacyReadUntil)
      )
    ).toEqual([cutoverCandidates[0]]);
  });

  test("deduplicates matching current and legacy material", async () => {
    const { deriveCheckoutSessionKeyCandidates } = await import(
      "./checkout-session-key.server"
    );
    const [secret] = generateSyntheticSecretValues();

    expect(
      deriveCheckoutSessionKeyCandidates("deduplicated-session-id", {
        rawPayStateKeys: secret,
        dedicatedSecret: secret,
        cutoverAt: "2026-06-01T10:00:00.000Z",
        legacyReadUntil: "2026-06-01T10:30:00.000Z",
        now: () => new Date("2026-06-01T10:15:00.000Z"),
      })
    ).toHaveLength(1);
  });
});
