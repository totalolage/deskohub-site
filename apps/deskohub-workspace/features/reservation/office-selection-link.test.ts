import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  getOfficeReservationDefaultValues,
  type NormalizedOfficeReservationOrder,
} from "./office-reservation";
import { officeSelectionLink } from "./office-selection-link";
import { setReservationSelectionSearchParams } from "./reservation-checkout-query";

const workspaceMidnight = (date: string) =>
  Temporal.PlainDate.from(date)
    .toZonedDateTime(workspaceSiteConstants.location.timeZone)
    .toInstant();

describe("officeSelectionLink.read", () => {
  test("prefills safe office shape on a fresh date", () => {
    expect(
      officeSelectionLink.read(
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
        { seatCapacity: 6, today: "2099-06-12" }
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
      officeSelectionLink.read(
        { dayCount: "999", seats: "7" },
        { seatCapacity: 3, today: "2099-10-01" }
      )
    ).toMatchObject({
      startsOn: "2099-10-01",
      dayCount: 1,
      seats: 1,
    });
    expect(
      officeSelectionLink.read(
        { dayCount: "Infinity", seats: "0" },
        { seatCapacity: 3, today: "2099-10-01" }
      )
    ).toMatchObject({ dayCount: 1, seats: 1 });
  });
});

describe("office start date links", () => {
  const today = "2099-06-12";
  const startsOnFrom = (startsOn: string) =>
    officeSelectionLink.read({ startsOn }, { seatCapacity: 6, today }).startsOn;

  test("opens on a linked start date inside the booking window", () => {
    expect(startsOnFrom("2099-06-12")).toBe("2099-06-12");
    expect(startsOnFrom(" 2099-06-20 ")).toBe("2099-06-20");
    // The last bookable day, one month from today, can still start a day.
    expect(startsOnFrom("2099-07-12")).toBe("2099-07-12");
  });

  test.each([
    ["past", "2099-06-11"],
    ["after the booking window", "2099-07-13"],
    ["impossible", "2099-02-30"],
    ["non-canonical", "2099-6-20"],
    ["a date-time", "2099-06-20T10:00"],
    ["empty", ""],
  ])("falls back to today for a %s start date", (_label, startsOn) => {
    expect(startsOnFrom(startsOn)).toBe(today);
  });

  test("fits the day count to the window from the linked start date", () => {
    expect(
      officeSelectionLink.read(
        { startsOn: "2099-07-10", dayCount: "3" },
        { seatCapacity: 6, today }
      )
    ).toMatchObject({ startsOn: "2099-07-10", dayCount: 3 });
    expect(
      officeSelectionLink.read(
        { startsOn: "2099-07-10", dayCount: "4" },
        { seatCapacity: 6, today }
      )
    ).toMatchObject({ startsOn: "2099-07-10", dayCount: 1 });
  });
});

describe("officeSelectionLink.write", () => {
  test("names the selection in the declared order", () => {
    expect(
      Object.entries(
        officeSelectionLink.write({
          seats: 4,
          dayCount: 5,
          startsOn: "2099-06-20",
        })
      )
    ).toEqual([
      ["startsOn", "2099-06-20"],
      ["dayCount", "5"],
      ["seats", "4"],
    ]);
  });

  test("leaves an open selection out of the link", () => {
    expect(officeSelectionLink.write({})).toEqual({
      startsOn: undefined,
      dayCount: undefined,
      seats: undefined,
    });
  });

  test.each([
    { startsOn: "2099-06-12", dayCount: 1, seats: 1 },
    { startsOn: "2099-06-20", dayCount: 5, seats: 4 },
    { startsOn: "2099-07-12", dayCount: 1, seats: 6 },
  ])("the parser reads back the written selection %o", (selection) => {
    const searchParams = new URLSearchParams(
      "startsOn=2099-06-15&dayCount=2&discountCode=SPRING"
    );
    setReservationSelectionSearchParams(
      searchParams,
      officeSelectionLink.write(selection)
    );

    expect(
      officeSelectionLink.read(searchParams, {
        seatCapacity: 6,
        today: "2099-06-12",
      })
    ).toMatchObject(selection);
    expect(searchParams.get("discountCode")).toBe("SPRING");
  });
});

describe("customer last reservation defaults", () => {
  test("fills open or invalid office options from a still-fitting last reservation", () => {
    const lastReservation = { kind: "office", dayCount: 2, seats: 3 } as const;

    expect(
      officeSelectionLink.read(
        {},
        { lastReservation, seatCapacity: 6, today: "2099-06-12" }
      )
    ).toMatchObject({ dayCount: 2, seats: 3 });
    expect(
      officeSelectionLink.read(
        { dayCount: "4", seats: "9" },
        { lastReservation, seatCapacity: 6, today: "2099-06-12" }
      )
    ).toMatchObject({ dayCount: 4, seats: 3 });
    expect(
      officeSelectionLink.read(
        {},
        { lastReservation, seatCapacity: 2, today: "2099-06-12" }
      )
    ).toMatchObject({ dayCount: 2, seats: 1 });
  });
});

describe("officeSelectionLink.fromStored", () => {
  test.each([
    { startsOn: "2099-06-12", endsBefore: "2099-06-13", seats: 1 },
    { startsOn: "2099-06-20", endsBefore: "2099-06-25", seats: 4 },
  ])("the parser reads back the stored reservation %o", (reservation) => {
    const selection = officeSelectionLink.fromStored({
      kind: "office",
      reservedFrom: workspaceMidnight(reservation.startsOn),
      reservedUntil: workspaceMidnight(reservation.endsBefore),
      seats: reservation.seats,
    });
    const dayCount = Temporal.PlainDate.from(reservation.startsOn).until(
      reservation.endsBefore
    ).days;
    expect(selection).toEqual({
      kind: "office",
      startsOn: reservation.startsOn,
      dayCount,
      seats: reservation.seats,
    });

    const searchParams = new URLSearchParams();
    setReservationSelectionSearchParams(
      searchParams,
      officeSelectionLink.write(selection ?? {})
    );
    expect(
      officeSelectionLink.read(searchParams, {
        seatCapacity: 6,
        today: "2099-06-12",
      })
    ).toMatchObject({
      startsOn: reservation.startsOn,
      dayCount,
      seats: reservation.seats,
    });
  });

  test("gives no selection for an interval that isn't whole workspace days", () => {
    expect(
      officeSelectionLink.fromStored({
        kind: "office",
        reservedFrom: workspaceMidnight("2099-06-20").add({ hours: 9 }),
        reservedUntil: workspaceMidnight("2099-06-21"),
        seats: 2,
      })
    ).toBeUndefined();
  });
});

describe("officeSelectionLink.restore", () => {
  const restored = getOfficeReservationDefaultValues({
    kind: "office",
    startsOn: "2099-06-20",
    endsOn: "2099-06-21",
    seats: 3,
    name: "Ada Lovelace",
    email: testEmailAddress("ada"),
    phone: "+420777777777",
    billing: { purpose: "personal", invoice: "none" },
  } as NormalizedOfficeReservationOrder);
  const context = { seatCapacity: 6, today: "2099-06-12" };

  test("keeps the restored selection without a selection parameter", () => {
    expect(
      officeSelectionLink.restore(
        restored,
        { payState: "signed", discountCode: "SPRING" },
        context
      )
    ).toEqual(restored);
  });

  test("lets any selection parameter replace the whole restored selection", () => {
    expect(
      officeSelectionLink.restore(restored, { seats: "5" }, context)
    ).toEqual({
      ...restored,
      startsOn: "2099-06-12",
      dayCount: 1,
      seats: 5,
    });
  });
});
