import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { normalizedCoworkReservationOrderSchema } from "./cowork-reservation";
import {
  getOfficeReservationDefaultValuesFromSearchParams,
  getReservationDefaultValuesFromPayState,
  getReservationDefaultValuesFromSearchParams,
  getWorkspaceAvailabilityQueryFromReservationSearchParams,
} from "./reservation-checkout-query";

describe("getWorkspaceAvailabilityQueryFromReservationSearchParams", () => {
  test("normalizes checkout tier aliases for availability", () => {
    const query = getWorkspaceAvailabilityQueryFromReservationSearchParams({
      date: "2099-06-10",
      monitorOption: "2x27-qhd",
      tier: "profi",
    });

    expect(query).toMatchObject({
      kind: "cowork",
      date: "2099-06-10",
      entryTier: "profi",
      monitorOption: "2x27-qhd",
    });
  });

  test("keeps cowork checkout query tiers cowork-only", () => {
    const query = getWorkspaceAvailabilityQueryFromReservationSearchParams({
      date: "2099-06-10",
      tier: "meeting-room",
    });

    expect(query).toMatchObject({
      kind: "cowork",
      date: "2099-06-10",
      entryTier: "basic",
    });
  });

  test("drops monitor options for tiers that do not use monitors", () => {
    const query = getWorkspaceAvailabilityQueryFromReservationSearchParams({
      date: "2099-06-10",
      entryTier: "basic",
      monitorOption: "2x27-qhd",
    });

    expect(query).toMatchObject({
      kind: "cowork",
      date: "2099-06-10",
      entryTier: "basic",
    });
    expect(query.monitorOption).toBeUndefined();
  });

  test("ignores interval query params for cowork availability", () => {
    const query = getWorkspaceAvailabilityQueryFromReservationSearchParams({
      date: "2099-06-10",
      startsAt: "09:00",
      endsAt: "11:30",
    });

    expect(query).toEqual({
      kind: "cowork",
      date: "2099-06-10",
      entryTier: "basic",
      from: expect.any(String),
      to: expect.any(String),
    });
  });

  test("ignores incomplete interval query params", () => {
    const query = getWorkspaceAvailabilityQueryFromReservationSearchParams({
      date: "2099-06-10",
      startsAt: "09:00",
    });

    expect(query).toEqual({
      kind: "cowork",
      date: "2099-06-10",
      entryTier: "basic",
      from: expect.any(String),
      to: expect.any(String),
    });
  });
});

describe("getReservationDefaultValuesFromSearchParams", () => {
  test("uses the shared email validator for checkout query defaults", () => {
    expect(
      getReservationDefaultValuesFromSearchParams({
        email: '  "quoted local"@example.com  ',
      }).email
    ).toBe('"quoted local"@example.com');
    expect(
      getReservationDefaultValuesFromSearchParams({ email: "invalid@" }).email
    ).toBe("");
  });
});

describe("getOfficeReservationDefaultValuesFromSearchParams", () => {
  test("prefills safe office shape on a fresh date", () => {
    expect(
      getOfficeReservationDefaultValuesFromSearchParams(
        {
          dayCount: "3",
          seats: "4",
          startsOn: "2000-01-01",
          name: "Sensitive Customer",
          email: "sensitive@example.com",
          discountCode: "SECRET-DISCOUNT",
          price: "442500",
          providerOrderId: "provider-order-id",
        },
        { seatCapacity: 6, startsOn: "2099-06-12" }
      )
    ).toEqual({
      startsOn: "2099-06-12",
      dayCount: 3,
      seats: 4,
      name: "",
      email: "",
      phone: "",
      message: "",
      billing: { purpose: "personal", invoice: "none" },
      marketingConsent: false,
    });
  });

  test("falls back for malformed or stale office shape", () => {
    expect(
      getOfficeReservationDefaultValuesFromSearchParams(
        { dayCount: "999", seats: "7" },
        { seatCapacity: 3, startsOn: "2099-10-01" }
      )
    ).toMatchObject({
      startsOn: "2099-10-01",
      dayCount: 1,
      seats: 1,
    });
    expect(
      getOfficeReservationDefaultValuesFromSearchParams(
        { dayCount: "Infinity", seats: "0" },
        { seatCapacity: 3, startsOn: "2099-10-01" }
      )
    ).toMatchObject({ dayCount: 1, seats: 1 });
  });
});

describe("getReservationDefaultValuesFromPayState", () => {
  test("restores all reservation details while resetting marketing consent", () => {
    const reservation = Schema.decodeUnknownSync(
      normalizedCoworkReservationOrderSchema
    )({
      kind: "cowork",
      entryTier: "profi",
      date: "2099-06-10",
      coffee: true,
      monitorOption: "2x27-qhd",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420 777 000 111",
      message: "Please prepare the standing desk.",
    });

    expect(getReservationDefaultValuesFromPayState(reservation)).toEqual({
      entryTier: "profi",
      date: "2099-06-10",
      coffee: true,
      monitorOption: "2x27-qhd",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420 777 000 111",
      message: "Please prepare the standing desk.",
      billing: { purpose: "personal", invoice: "none" },
      marketingConsent: false,
    });
  });
});
