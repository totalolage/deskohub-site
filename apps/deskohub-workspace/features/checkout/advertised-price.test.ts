import { describe, expect, test } from "bun:test";
import { Option, Schema } from "effect";
import { coworkAdvertisedPriceReservationEquals } from "@/features/reservation/cowork-reservation";
import {
  parseWorkspaceAdvertisedPrice,
  workspaceAdvertisedPriceRequestSchema,
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
      coworkAdvertisedPriceReservationEquals(reservation, reservation)
    ).toBe(true);
    expect(
      coworkAdvertisedPriceReservationEquals(reservation, {
        ...reservation,
        details: { ...reservation.details, coffee: false },
      })
    ).toBe(false);
  });

  test("rejects an invalid response asynchronously", async () => {
    const parsed = parseWorkspaceAdvertisedPrice({ quote: null });

    await expect(parsed).rejects.toBeDefined();
  });
});
