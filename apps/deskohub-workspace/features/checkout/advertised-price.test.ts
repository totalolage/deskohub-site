import { describe, expect, test } from "bun:test";
import { Option, Schema } from "effect";
import {
  workspaceAdvertisedPriceRequestSchema,
  workspaceAdvertisedPriceReservationEquals,
} from "./advertised-price";

const decodeRequest = Schema.decodeUnknownOption(
  workspaceAdvertisedPriceRequestSchema,
  { onExcessProperty: "error" }
);

const reservation = {
  kind: "cowork" as const,
  details: {
    entryTier: "basic" as const,
    coffee: true,
    date: "2026-07-20",
  },
};

describe("Workspace advertised price contract", () => {
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
      workspaceAdvertisedPriceReservationEquals(reservation, reservation)
    ).toBe(true);
    expect(
      workspaceAdvertisedPriceReservationEquals(reservation, {
        ...reservation,
        details: { ...reservation.details, coffee: false },
      })
    ).toBe(false);
  });
});
