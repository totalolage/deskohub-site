import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Schema } from "effect";
import { reservationOrderSchema } from "@/features/reservation/reservation-order";

mock.module("server-only", () => ({}));

const decodeReservation = <T>(input: T) =>
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
      getKey(cowork),
      getKey(meetingRoom),
      getKey(laterMeetingRoom),
    ];
    expect(new Set(keys).size).toBe(3);
    for (const key of keys) {
      expect(key).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  test("changes when reservation purpose or billing identity changes", async () => {
    const { deriveCheckoutAttemptKey } = await import(
      "./checkout-session-key.server"
    );
    const base = {
      kind: "cowork",
      ...contact,
      date: "2099-06-10",
      entryTier: "basic",
      coffee: false,
    };
    const getKey = (billing: unknown) =>
      deriveCheckoutAttemptKey({
        checkoutSessionId: "session-id",
        checkoutAttemptId: "attempt-id",
        reservation: decodeReservation({ ...base, billing }),
      });
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
