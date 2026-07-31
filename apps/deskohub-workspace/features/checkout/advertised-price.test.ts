import "@/shared/polyfills/temporal";
import { describe, expect, test } from "bun:test";
import { Option, Schema } from "effect";
import {
  coworkAdvertisedPriceReservationEquals,
  getCoworkAdvertisedPriceReservation,
} from "@/features/reservation/cowork-reservation";
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

  test("rejects rolling whole-day meeting-room advertisements", () => {
    const decoded = decodeRequest({
      locale: "en-US",
      reservation: {
        kind: "meeting-room",
        details: {
          kind: "meeting-room",
          startsAt: "2099-06-10T08:00:00Z",
          endsAt: "2099-06-11T08:00:00Z",
        },
      },
    });

    expect(Option.isNone(decoded)).toBe(true);
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

  test("compares every price-affecting reservation input", () => {
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

  test("accepts only price-affecting cowork inputs", () => {
    const profiReservation = {
      kind: "cowork" as const,
      details: {
        kind: "cowork" as const,
        entryTier: "profi" as const,
        coffee: true as const,
        date: "2026-07-20",
      },
    };

    expect(
      Option.isSome(
        decodeRequest({
          locale: "en-US",
          reservation: profiReservation,
        })
      )
    ).toBe(true);
    expect(
      Option.isNone(
        decodeRequest({
          locale: "en-US",
          reservation: {
            ...profiReservation,
            details: {
              ...profiReservation.details,
              monitorOption: "2x27-qhd",
            },
          },
        })
      )
    ).toBe(true);
  });

  test("uses the same advertised-price snapshot for every Profi monitor", () => {
    const reservation = {
      entryTier: "profi" as const,
      coffee: true,
      date: "2026-07-20",
    };

    expect(
      getCoworkAdvertisedPriceReservation({
        ...reservation,
        monitorOption: "2x27-qhd",
      })
    ).toEqual(
      getCoworkAdvertisedPriceReservation({
        ...reservation,
        monitorOption: "2x32-4k",
      })
    );
  });
});
