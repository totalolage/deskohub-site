import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  getOfficeReservationDefaultValuesFromSearchParams,
  getOfficeReservationSearchParams,
} from "./office-reservation-checkout-query";
import { getCurrentWorkspaceDate } from "./reservation-date";

describe("getOfficeReservationDefaultValuesFromSearchParams", () => {
  test("prefills safe office shape on a fresh date", () => {
    expect(
      getOfficeReservationDefaultValuesFromSearchParams(
        {
          dayCount: "3",
          seats: "4",
          startsOn: "2000-01-01",
          name: "Sensitive Customer",
          email: testEmailAddress("sensitive"),
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

describe("customer last reservation defaults", () => {
  test("fills open or invalid office options from a still-fitting last reservation", () => {
    const lastReservation = { kind: "office", dayCount: 2, seats: 3 } as const;

    expect(
      getOfficeReservationDefaultValuesFromSearchParams(
        {},
        { lastReservation, seatCapacity: 6, startsOn: "2099-06-12" }
      )
    ).toMatchObject({ dayCount: 2, seats: 3 });
    expect(
      getOfficeReservationDefaultValuesFromSearchParams(
        { dayCount: "4", seats: "9" },
        { lastReservation, seatCapacity: 6, startsOn: "2099-06-12" }
      )
    ).toMatchObject({ dayCount: 4, seats: 3 });
    expect(
      getOfficeReservationDefaultValuesFromSearchParams(
        {},
        { lastReservation, seatCapacity: 2, startsOn: "2099-06-12" }
      )
    ).toMatchObject({ dayCount: 2, seats: 1 });
  });
});

describe("getOfficeReservationSearchParams", () => {
  test("restores selected office options for the current Workspace date", () => {
    const startsOn = getCurrentWorkspaceDate().toString();
    const searchParams = getOfficeReservationSearchParams({
      dayCount: 3,
      seats: 4,
    });

    expect(
      getOfficeReservationDefaultValuesFromSearchParams(searchParams, {
        seatCapacity: 6,
        startsOn,
      })
    ).toMatchObject({ startsOn, dayCount: 3, seats: 4 });
  });

  test("omits options that were not selected", () => {
    const searchParams = getOfficeReservationSearchParams({});

    expect(searchParams.toString()).toBe("");
    expect(searchParams.has("dayCount")).toBe(false);
    expect(searchParams.has("seats")).toBe(false);
  });
});
