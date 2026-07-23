import "@/shared/polyfills/temporal";
import { describe, expect, test } from "bun:test";
import { Option, Schema } from "effect";
import { coworkAdvertisedPriceReservationEquals } from "@/features/reservation/cowork-reservation";
import { advertisedPriceRequestSchema } from "./advertised-price";

const decodeRequest = Schema.decodeUnknownOption(advertisedPriceRequestSchema, {
  onExcessProperty: "error",
});

const reservation = {
  kind: "cowork" as const,
  details: {
    kind: "cowork" as const,
    entryTier: "basic" as const,
    coffee: true,
    date: "2026-07-20",
  },
};

describe("advertised price contract", () => {
  test("accepts meeting-room reservations at the family-neutral boundary", () => {
    const decoded = decodeRequest({
      locale: "en-US",
      reservation: {
        kind: "meeting-room",
        details: {
          kind: "meeting-room",
          startsAt: "2099-06-10T08:00:00Z",
          endsAt: "2099-06-10T12:00:00Z",
        },
      },
    });

    expect(Option.isSome(decoded)).toBe(true);
  });

  test("strictly rejects contact details at the anonymous request boundary", () => {
    const decoded = decodeRequest({
      locale: "en-US",
      reservation: {
        ...reservation,
        customerEmail: "ada@example.test",
      },
    });

    expect(Option.isNone(decoded)).toBe(true);
  });

  test("compares the full normalized PII-free reservation", () => {
    expect(
      coworkAdvertisedPriceReservationEquals(reservation, reservation)
    ).toBe(true);
    expect(
      coworkAdvertisedPriceReservationEquals(reservation, {
        ...reservation,
        details: { ...reservation.details, coffee: false },
      })
    ).toBe(false);
  });
});
