import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Schema } from "effect";
import { reservationOrderSchema } from "@/features/reservation/reservation-order";

mock.module("server-only", () => ({}));

const decodeReservation = (input: unknown) =>
  Schema.decodeUnknownEffect(reservationOrderSchema)(input).pipe(
    Effect.runSync
  );

const contact = {
  name: "Synthetic Person",
  email: "synthetic@example.test",
  phone: "+420777777777",
  message: "Quiet desk, please.",
} as const;

const baseCoworkInput = {
  kind: "cowork",
  ...contact,
  date: "2099-06-10",
  entryTier: "basic",
  coffee: false,
} as const;

describe("checkout reservation identity keys", () => {
  test("changes the attempt HMAC for every complete cowork identity field", async () => {
    const { deriveCheckoutAttemptKey } = await import(
      "./checkout-session-key.server"
    );
    const deriveAttempt = (reservationInput: Record<string, unknown>) =>
      deriveCheckoutAttemptKey({
        checkoutSessionId: "session-id",
        checkoutAttemptId: "attempt-id",
        reservation: decodeReservation(reservationInput),
      });
    const base = deriveAttempt(baseCoworkInput);
    const fieldVariants = [
      { ...baseCoworkInput, name: "Different Synthetic Person" },
      { ...baseCoworkInput, email: "different@example.test" },
      { ...baseCoworkInput, phone: "+420777777778" },
      { ...baseCoworkInput, message: "Window desk, please." },
      { ...baseCoworkInput, date: "2099-06-11" },
      {
        ...baseCoworkInput,
        entryTier: "plus",
        coffee: true,
        monitorOption: undefined,
      },
      { ...baseCoworkInput, coffee: true },
      {
        ...baseCoworkInput,
        entryTier: "profi",
        coffee: true,
        monitorOption: "2x27-qhd",
      },
      {
        ...baseCoworkInput,
        entryTier: "profi",
        coffee: true,
        monitorOption: "2x32-qhd",
      },
    ];

    for (const variant of fieldVariants) {
      expect(deriveAttempt(variant)).not.toBe(base);
    }
  });

  test("rotates on a message-only edit while normalized equivalents reuse exactly", async () => {
    const { deriveCheckoutAttemptKey } = await import(
      "./checkout-session-key.server"
    );
    const deriveAttempt = (reservationInput: Record<string, unknown>) =>
      deriveCheckoutAttemptKey({
        checkoutSessionId: "session-id",
        checkoutAttemptId: "attempt-id",
        reservation: decodeReservation(reservationInput),
      });
    const firstMessage = deriveAttempt(baseCoworkInput);
    const changedMessage = deriveAttempt({
      ...baseCoworkInput,
      message: "A different synthetic note.",
    });
    const normalizedWhitespace = deriveAttempt({
      ...baseCoworkInput,
      name: "  Synthetic Person  ",
      email: " synthetic@example.test ",
      phone: " +420777777777 ",
      message: "  Quiet desk, please.  ",
    });
    const omittedMessage = deriveAttempt({
      ...baseCoworkInput,
      message: undefined,
    });
    const blankMessage = deriveAttempt({
      ...baseCoworkInput,
      message: "   ",
    });

    expect(changedMessage).not.toBe(firstMessage);
    expect(normalizedWhitespace).toBe(firstMessage);
    expect(blankMessage).toBe(omittedMessage);
  });

  test("keeps stable session identity distinct from every reservation family's attempt identity", async () => {
    const { deriveCheckoutAttemptKey, deriveCheckoutSessionKey } = await import(
      "./checkout-session-key.server"
    );
    const getKey = (reservation: ReturnType<typeof decodeReservation>) =>
      deriveCheckoutAttemptKey({
        checkoutSessionId: "session-id",
        checkoutAttemptId: "attempt-id",
        reservation,
      });
    const cowork = decodeReservation(baseCoworkInput);
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
    expect(deriveCheckoutSessionKey("session-id")).toBe(
      deriveCheckoutSessionKey("session-id")
    );
    expect(
      deriveCheckoutAttemptKey({
        checkoutSessionId: "session-id",
        checkoutAttemptId: "different-attempt-id",
        reservation: cowork,
      })
    ).not.toBe(getKey(cowork));
    for (const key of keys) {
      expect(key).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
