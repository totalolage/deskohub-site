import { describe, expect, test } from "bun:test";
import { Result, Schema } from "effect";
import "@/shared/polyfills/temporal";
import {
  coworkCurrentReservationOrderSchema,
  coworkReservationSchema,
  getCoworkReservationDetails,
  getCoworkReservationIntervalInput,
  getCoworkReservationOrder,
  isCoworkOpenSpaceDayCutoffReached,
  normalizedCoworkReservationOrderSchema,
} from "./cowork-reservation";
import {
  coworkReservationIntervalSchema,
  reservationIntervalSchema,
} from "./reservation-interval";

const safeParseCoworkReservation = Schema.decodeUnknownResult(
  coworkReservationSchema
);
const safeParseCoworkReservationOrder = Schema.decodeUnknownResult(
  coworkCurrentReservationOrderSchema
);

describe("cowork reservation schema", () => {
  test("owns the tier-aware cowork interval policy", () => {
    expect(
      getCoworkReservationIntervalInput("open-space", "2099-06-10")
    ).toEqual({
      startsAt: "2099-06-10T00:00",
      endsAt: "2099-06-10T17:00",
    });
    expect(
      getCoworkReservationIntervalInput("reserved-desk", "2099-06-10")
    ).toEqual({
      startsAt: "2099-06-10T00:00",
      endsAt: "2099-06-11T00:00",
    });
  });

  test("accepts the Open Space interval through cowork interval validation", () => {
    const interval = Schema.decodeSync(coworkReservationIntervalSchema)(
      getCoworkReservationIntervalInput("open-space", "2099-06-10")
    );

    expect(interval).toEqual({
      startsAt: "2099-06-09T22:00:00Z",
      endsAt: "2099-06-10T15:00:00Z",
    });
  });

  test("represents cowork reservations by date without an interval", () => {
    const result = safeParseCoworkReservation({
      entryTier: "reserved-desk",
      date: "2099-06-10",
      coffee: false,
      monitorOption: undefined,
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
      marketingConsent: false,
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toMatchObject({
        kind: "cowork",
        entryTier: "reserved-desk",
        date: "2099-06-10",
        coffee: true,
      });
      expect(result.success).not.toHaveProperty("startsAt");
      expect(result.success).not.toHaveProperty("endsAt");
      expect(getCoworkReservationOrder(result.success)).not.toHaveProperty(
        "marketingConsent"
      );
      expect(
        getCoworkReservationDetails(getCoworkReservationOrder(result.success))
      ).toEqual({
        kind: "cowork",
        entryTier: "reserved-desk",
        date: "2099-06-10",
        coffee: true,
      });
    }
  });

  test("decodes cowork orders with the domain discriminator", () => {
    const result = safeParseCoworkReservationOrder({
      kind: "cowork",
      entryTier: "open-space",
      date: "2099-06-10",
      coffee: false,
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toMatchObject({
        kind: "cowork",
        entryTier: "open-space",
      });
      expect(result.success).not.toHaveProperty("_tag");
    }
  });

  test("rejects monitor setup for Open Space reservations", () => {
    const result = safeParseCoworkReservation({
      entryTier: "open-space",
      date: "2099-06-10",
      coffee: false,
      monitorOption: "2x27-qhd",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
      marketingConsent: false,
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(String(result.failure)).toContain('at ["monitorOption"]');
    }
  });

  test("rejects historical tiers on the public issuance boundary", () => {
    for (const entryTier of ["basic", "plus", "profi"] as const) {
      expect(
        Result.isFailure(
          safeParseCoworkReservationOrder({
            kind: "cowork",
            entryTier,
            date: "2099-06-10",
            coffee: true,
            monitorOption: entryTier === "profi" ? "2x27-4k" : undefined,
            name: "Ada Lovelace",
            email: "ada@example.com",
            phone: "+420777777777",
          })
        )
      ).toBe(true);
    }
  });

  test("rejects historical tiers on the public form issuance boundary", () => {
    for (const entryTier of ["basic", "plus", "profi"] as const) {
      expect(
        Result.isFailure(
          safeParseCoworkReservation({
            entryTier,
            date: "2099-06-10",
            coffee: true,
            monitorOption: entryTier === "profi" ? "2x27-4k" : undefined,
            name: "Ada Lovelace",
            email: "ada@example.com",
            phone: "+420777777777",
            marketingConsent: false,
          })
        )
      ).toBe(true);
    }
  });

  test("applies the Open Space same-day 17:00 cutoff only to today", () => {
    const now = Temporal.PlainDate.from("2099-06-10")
      .toZonedDateTime("Europe/Prague")
      .with({ hour: 17, minute: 0 })
      .toInstant();

    expect(
      isCoworkOpenSpaceDayCutoffReached({
        entryTier: "open-space",
        date: "2099-06-10",
        now,
      })
    ).toBe(true);
    expect(
      isCoworkOpenSpaceDayCutoffReached({
        entryTier: "open-space",
        date: "2099-06-10",
        now: now.subtract({ minutes: 1 }),
      })
    ).toBe(false);
    expect(
      isCoworkOpenSpaceDayCutoffReached({
        entryTier: "open-space",
        date: "2099-06-11",
        now,
      })
    ).toBe(false);
    expect(
      isCoworkOpenSpaceDayCutoffReached({
        entryTier: "reserved-desk",
        date: "2099-06-10",
        now,
      })
    ).toBe(false);
  });
});

describe("cowork offer intervals across daylight-saving changes", () => {
  test("keeps whole Prague calendar days for reserved-desk across DST", () => {
    // Fall 2026-10-25 is a 25-hour day; spring 2027-03-28 is a 23-hour day.
    const normalize = Schema.decodeSync(reservationIntervalSchema);
    const fall = normalize(
      getCoworkReservationIntervalInput("reserved-desk", "2026-10-25")
    );
    expect(fall.endsAt).toBe("2026-10-25T23:00:00Z");
    const spring = normalize(
      getCoworkReservationIntervalInput("reserved-desk", "2027-03-28")
    );
    expect(spring.endsAt).toBe("2027-03-28T22:00:00Z");
  });

  test("keeps Open Space at 00:00-17:00 Prague-local across DST", () => {
    const normalize = Schema.decodeSync(reservationIntervalSchema);
    const fall = normalize(
      getCoworkReservationIntervalInput("open-space", "2026-10-25")
    );
    expect(fall.startsAt).toBe("2026-10-24T22:00:00Z");
    expect(fall.endsAt).toBe("2026-10-25T16:00:00Z");
    const spring = normalize(
      getCoworkReservationIntervalInput("open-space", "2027-03-28")
    );
    expect(spring.startsAt).toBe("2027-03-27T23:00:00Z");
    expect(spring.endsAt).toBe("2027-03-28T15:00:00Z");
  });
});

describe("retired reservation customer message", () => {
  test("omits the message field from new normalized orders", () => {
    const result = safeParseCoworkReservation({
      entryTier: "reserved-desk",
      date: "2099-06-10",
      coffee: false,
      monitorOption: undefined,
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
      marketingConsent: false,
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).not.toHaveProperty("message");
    }
  });

  test("drops a legacy customer message on strict normalized decode", () => {
    const reservation = Schema.decodeUnknownSync(
      normalizedCoworkReservationOrderSchema,
      { onExcessProperty: "error" }
    )({
      kind: "cowork",
      entryTier: "open-space",
      date: "2099-06-10",
      coffee: false,
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
      message: "Legacy setup note.",
    });

    expect(reservation).not.toHaveProperty("message");
    expect(reservation.name).toBe("Ada Lovelace");
  });
});
