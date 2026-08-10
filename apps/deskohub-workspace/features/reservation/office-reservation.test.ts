import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Result, Schema } from "effect";
import { makeSchemaParser } from "@/shared/utils/schema-parser";
import {
  getOfficeReservationDayCount,
  getOfficeReservationDefaultValues,
  getOfficeReservationIntervalInput,
  getOfficeReservationOrder,
  getStoredOfficeReservationDetails,
  getWorkspaceOfficeProductKey,
  officeReservationDetailsSchema,
  officeReservationSchema,
  storedOfficeReservationDetailsSchema,
  workspaceOfficeProductIdentitySchema,
  workspaceOfficeProductKeySchema,
} from "./office-reservation";

const formParser = makeSchemaParser(officeReservationSchema);
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
    const result = formParser.safeParse({
      ...validCustomer,
      startsOn: "2099-06-10",
      endsOn: "2099-06-12",
      seats: 3,
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(getOfficeReservationDayCount(result.success)).toBe(3);
      expect(result.success.seats).toBe(3);
    }
  });

  test("keeps marketing consent in form state and resets it on restoration", () => {
    const result = formParser.safeParse({
      ...validCustomer,
      marketingConsent: true,
      startsOn: "2099-06-10",
      endsOn: "2099-06-12",
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
    }

    expect(
      Result.isFailure(
        formParser.safeParse({
          ...validCustomer,
          marketingConsent: undefined,
          startsOn: "2099-06-10",
          endsOn: "2099-06-12",
          seats: 3,
        })
      )
    ).toBe(true);
  });

  test("rejects a backwards range and invalid seat count", () => {
    for (const input of [
      { startsOn: "2099-06-12", endsOn: "2099-06-10", seats: 1 },
      { startsOn: "2099-06-10", endsOn: "2099-06-12", seats: 1.5 },
      { startsOn: "2099-06-10", endsOn: "2099-06-12", seats: 0 },
    ]) {
      expect(
        Result.isFailure(formParser.safeParse({ ...validCustomer, ...input }))
      ).toBe(true);
    }
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
