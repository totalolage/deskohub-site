import "@/shared/polyfills/temporal";
import { describe, expect, test } from "bun:test";
import { Option, Schema } from "effect";
import {
  coworkAdvertisedPriceReservationEquals,
  getCoworkAdvertisedPriceReservation,
} from "@/features/reservation/cowork-reservation";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import {
  advertisedPriceRequestBatchSize,
  advertisedPriceRequestSchema,
  advertisedPriceRequestsSchema,
} from "./advertised-price";

const decodeRequest = Schema.decodeUnknownOption(advertisedPriceRequestSchema, {
  onExcessProperty: "error",
});
const decodeRequests = Schema.decodeUnknownOption(
  advertisedPriceRequestsSchema,
  { onExcessProperty: "error" }
);

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
  test("bounds action batches to a non-empty provider-safe size", () => {
    const request = { locale: "en-US", reservation } as const;

    expect(Option.isNone(decodeRequests([]))).toBe(true);
    expect(
      Option.isSome(
        decodeRequests(
          Array.from({ length: advertisedPriceRequestBatchSize }, () => request)
        )
      )
    ).toBe(true);
    expect(
      Option.isNone(
        decodeRequests(
          Array.from(
            { length: advertisedPriceRequestBatchSize + 1 },
            () => request
          )
        )
      )
    ).toBe(true);
  });

  test("accepts meeting-room reservations at the family-neutral boundary", () => {
    const decoded = decodeRequest({
      locale: "en-US",
      reservation: {
        kind: "meeting-room",
        details: {
          kind: "meeting-room",
          duration: { unit: "hour", amount: 4 },
          reservationDate: "2099-06-10",
        },
      },
    });

    expect(Option.isSome(decoded)).toBe(true);
  });

  test("rejects office price requests beyond the one-month booking horizon", () => {
    const startsOn = getCurrentWorkspaceDate();
    const decoded = decodeRequest({
      locale: "en-US",
      reservation: {
        kind: "office",
        details: {
          kind: "office",
          startsOn: startsOn.toString(),
          endsOn: startsOn.add({ months: 1, days: 1 }).toString(),
          seats: 1,
        },
      },
    });

    expect(Option.isNone(decoded)).toBe(true);
  });

  test("rejects interval data outside meeting-room pricing inputs", () => {
    const decoded = decodeRequest({
      locale: "en-US",
      reservation: {
        kind: "meeting-room",
        details: {
          kind: "meeting-room",
          duration: { unit: "day", amount: 1 },
          reservationDate: "2099-06-10",
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
