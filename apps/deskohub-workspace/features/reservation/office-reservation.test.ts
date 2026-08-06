import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Result, Schema } from "effect";
import { makeSchemaParser } from "@/shared/utils/schema-parser";
import {
  getOfficeReservationDayCount,
  getOfficeReservationDefaultValues,
  getOfficeReservationGuestCount,
  getOfficeReservationIntervalInput,
  getOfficeReservationOrder,
  getStoredOfficeReservationDetails,
  getWorkspaceOfficeProductKey,
  officeReservationSchema,
  storedOfficeReservationDetailsSchema,
  workspaceOfficeProductKeySchema,
} from "./office-reservation";

const formParser = makeSchemaParser(officeReservationSchema);
const storedDetailsParser = makeSchemaParser(
  storedOfficeReservationDetailsSchema,
  { onExcessProperty: "error" }
);
const validCustomer = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420777777777",
  message: "",
  legalConsent: true,
  marketingConsent: false,
};

describe("office reservation", () => {
  test("owns the stable office product identity and key", () => {
    expect(getWorkspaceOfficeProductKey({ kind: "office" })).toBe("office");
    expect(
      Schema.decodeUnknownSync(workspaceOfficeProductKeySchema)("office")
    ).toBe("office");
    expect(() =>
      Schema.decodeUnknownSync(workspaceOfficeProductKeySchema)("office:person")
    ).toThrow();
  });

  test("accepts an inclusive multi-day range and other-person count", () => {
    const result = formParser.safeParse({
      ...validCustomer,
      startsOn: "2099-06-10",
      endsOn: "2099-06-12",
      additionalGuests: 2,
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(getOfficeReservationDayCount(result.success)).toBe(3);
      expect(getOfficeReservationGuestCount(result.success)).toBe(3);
    }
  });

  test("keeps marketing consent in form state and resets it on restoration", () => {
    const result = formParser.safeParse({
      ...validCustomer,
      marketingConsent: true,
      startsOn: "2099-06-10",
      endsOn: "2099-06-12",
      additionalGuests: 2,
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.marketingConsent).toBe(true);
      const reservation = getOfficeReservationOrder(result.success);
      expect(reservation).not.toHaveProperty("marketingConsent");
      expect(
        getOfficeReservationDefaultValues(reservation).marketingConsent
      ).toBe(false);
    }

    expect(
      Result.isFailure(
        formParser.safeParse({
          ...validCustomer,
          marketingConsent: undefined,
          startsOn: "2099-06-10",
          endsOn: "2099-06-12",
          additionalGuests: 2,
        })
      )
    ).toBe(true);
  });

  test("rejects a backwards range and non-whole guest count", () => {
    for (const input of [
      { startsOn: "2099-06-12", endsOn: "2099-06-10", additionalGuests: 0 },
      { startsOn: "2099-06-10", endsOn: "2099-06-12", additionalGuests: 1.5 },
      { startsOn: "2099-06-10", endsOn: "2099-06-12", additionalGuests: -1 },
    ]) {
      expect(
        Result.isFailure(formParser.safeParse({ ...validCustomer, ...input }))
      ).toBe(true);
    }
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
          additionalGuests: 2,
        })
      )
    ).toBe(true);
  });
});
