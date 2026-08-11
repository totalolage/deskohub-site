import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Result, Schema } from "effect";
import { makeSchemaParser } from "@/shared/utils/schema-parser";
import {
  getOfficeReservationDayCount,
  getOfficeReservationDefaultValues,
  getOfficeReservationEndsOn,
  getOfficeReservationIntervalInput,
  getOfficeReservationMaximumDayCount,
  getOfficeReservationMaximumEndsOn,
  getOfficeReservationOrder,
  getStoredOfficeReservationDetails,
  getWorkspaceOfficeProductKey,
  officeReservationDetailsSchema,
  officeReservationOrderSchema,
  officeReservationSchema,
  storedOfficeReservationDetailsSchema,
  workspaceOfficeProductIdentitySchema,
  workspaceOfficeProductKeySchema,
} from "./office-reservation";
import { getCurrentWorkspaceDate } from "./reservation-date";

const formParser = makeSchemaParser(officeReservationSchema);
const orderParser = makeSchemaParser(officeReservationOrderSchema);
const detailsParser = makeSchemaParser(officeReservationDetailsSchema);
const storedDetailsParser = makeSchemaParser(
  storedOfficeReservationDetailsSchema,
  { onExcessProperty: "error" }
);
const validCustomer = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420777777777",
  message: "",
  marketingConsent: false,
};

describe("office reservation", () => {
  test("owns the complete office product identity and key", () => {
    const product = { kind: "office", seats: 3, dayCount: 2 } as const;

    expect(getWorkspaceOfficeProductKey(product)).toBe("office:3:2");
    expect(
      Schema.decodeUnknownSync(workspaceOfficeProductIdentitySchema)(product)
    ).toEqual(product);
    expect(
      Schema.decodeUnknownSync(workspaceOfficeProductKeySchema)("office:3:2")
    ).toBe("office:3:2");
    expect(() =>
      Schema.decodeUnknownSync(workspaceOfficeProductKeySchema)("office")
    ).toThrow();
  });

  test("accepts an inclusive multi-day range and total seats", () => {
    const startsOn = Temporal.Now.plainDateISO().add({ days: 1 }).toString();
    const result = formParser.safeParse({
      ...validCustomer,
      startsOn,
      dayCount: 3,
      seats: 3,
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.dayCount).toBe(3);
      const reservation = getOfficeReservationOrder(result.success);
      expect(getOfficeReservationDayCount(reservation)).toBe(3);
      expect(reservation.endsOn).toBe(
        Temporal.PlainDate.from(startsOn).add({ days: 2 }).toString()
      );
      expect(result.success.seats).toBe(3);
    }
  });

  test("caps a stay before the first unavailable date and the one-month horizon", () => {
    const today = Temporal.PlainDate.from("2026-08-10");
    const maximumEndsOn = getOfficeReservationMaximumEndsOn(today);

    expect(maximumEndsOn.toString()).toBe("2026-09-10");
    expect(
      getOfficeReservationMaximumDayCount({
        startsOn: "2026-08-20",
        maximumEndsOn,
        unavailableDates: ["2026-08-23", "2026-09-01"],
      })
    ).toBe(3);
    expect(
      getOfficeReservationMaximumDayCount({
        startsOn: "2026-09-09",
        maximumEndsOn,
        unavailableDates: [],
      })
    ).toBe(2);
    expect(
      getOfficeReservationEndsOn({ startsOn: "2026-08-20", dayCount: 3 })
    ).toBe("2026-08-22");
  });

  test("keeps marketing consent in form state and resets it on restoration", () => {
    const startsOn = Temporal.Now.plainDateISO().add({ days: 1 }).toString();
    const result = formParser.safeParse({
      ...validCustomer,
      marketingConsent: true,
      startsOn,
      dayCount: 3,
      seats: 3,
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.marketingConsent).toBe(true);
      const reservation = getOfficeReservationOrder(result.success);
      expect(reservation).not.toHaveProperty("marketingConsent");
      expect(
        getOfficeReservationDefaultValues(reservation).marketingConsent
      ).toBe(false);
      expect(getOfficeReservationDefaultValues(reservation)).toMatchObject({
        startsOn,
        dayCount: 3,
      });
      expect(getOfficeReservationDefaultValues(reservation)).not.toHaveProperty(
        "endsOn"
      );
    }

    expect(
      Result.isFailure(
        formParser.safeParse({
          ...validCustomer,
          marketingConsent: undefined,
          startsOn,
          dayCount: 3,
          seats: 3,
        })
      )
    ).toBe(true);
  });

  test("rejects invalid day and seat counts", () => {
    const startsOn = Temporal.Now.plainDateISO().add({ days: 1 }).toString();
    for (const input of [
      { startsOn, dayCount: 0, seats: 1 },
      { startsOn, dayCount: 1.5, seats: 1 },
      { startsOn, dayCount: 3, seats: 1.5 },
      { startsOn, dayCount: 3, seats: 0 },
    ]) {
      expect(
        Result.isFailure(formParser.safeParse({ ...validCustomer, ...input }))
      ).toBe(true);
    }
  });

  test("rejects a reservation whose last day is beyond one month", () => {
    const today = Temporal.Now.plainDateISO();
    const dayCount =
      today.until(today.add({ months: 1 }), {
        largestUnit: "day",
      }).days + 2;

    expect(
      Result.isFailure(
        formParser.safeParse({
          ...validCustomer,
          startsOn: today.toString(),
          dayCount,
          seats: 1,
        })
      )
    ).toBe(true);
  });

  test("rejects an order that starts before the current Prague date", () => {
    const today = getCurrentWorkspaceDate();

    expect(
      Result.isFailure(
        orderParser.safeParse({
          kind: "office",
          name: validCustomer.name,
          email: validCustomer.email,
          phone: validCustomer.phone,
          message: validCustomer.message,
          startsOn: today.subtract({ days: 1 }).toString(),
          endsOn: today.toString(),
          seats: 1,
        })
      )
    ).toBe(true);
  });

  test("keeps historical persisted details decodable while validating order", () => {
    const result = detailsParser.safeParse({
      kind: "office",
      startsOn: "2020-06-10",
      endsOn: "2020-06-12",
      seats: 3,
    });

    expect(Result.isSuccess(result)).toBe(true);
    expect(
      Result.isFailure(
        detailsParser.safeParse({
          kind: "office",
          startsOn: "2020-06-12",
          endsOn: "2020-06-10",
          seats: 3,
        })
      )
    ).toBe(true);
  });

  test("projects a whole Prague calendar day across DST", () => {
    expect(
      getOfficeReservationIntervalInput({
        startsOn: "2026-03-29",
        endsOn: "2026-03-29",
      })
    ).toEqual({
      startsAt: "2026-03-28T23:00:00Z",
      endsAt: "2026-03-29T22:00:00Z",
    });
  });

  test("keeps Dotypos-owned office facts out of local persistence", () => {
    expect(getStoredOfficeReservationDetails({ kind: "office" })).toEqual({
      kind: "office",
    });
    expect(
      Result.isFailure(
        storedDetailsParser.safeParse({
          kind: "office",
          startsOn: "2099-06-10",
          seats: 3,
        })
      )
    ).toBe(true);
  });
});
