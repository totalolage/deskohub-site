import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import type { NormalizedMeetingRoomReservationOrder } from "./meeting-room-reservation";
import {
  getMeetingRoomReservationDefaultValuesFromSearchParams,
  getMeetingRoomReservationSelectionSearchParams,
  getMeetingRoomRestoredReservationValues,
  getStoredMeetingRoomReservationSelectionSearchParams,
} from "./meeting-room-reservation-checkout-query";
import { getMeetingRoomReservationDuration } from "./meeting-room-reservation-duration";
import {
  getEarliestMeetingRoomStartDateTime,
  getMeetingRoomReservationInterval,
} from "./meeting-room-reservation-time";
import { setReservationSelectionSearchParams } from "./reservation-checkout-query";

const adaEmail = testEmailAddress("ada");

const deterministicNow = () => Temporal.Instant.from("2099-07-30T13:01:00Z");

const workspaceInstant = (local: string) =>
  Temporal.PlainDateTime.from(local)
    .toZonedDateTime(workspaceSiteConstants.location.timeZone, {
      disambiguation: "compatible",
    })
    .toInstant();

describe("getMeetingRoomReservationDefaultValuesFromSearchParams", () => {
  test("prefills a valid future hourly reservation in Workspace time", () => {
    const values = getMeetingRoomReservationDefaultValuesFromSearchParams(
      {
        duration: "hour:1",
        email: ` ${adaEmail} `,
        name: "Ada Lovelace",
        phone: "+420777777777",
        startDateTime: "2099-08-12T09:00",
      },
      deterministicNow()
    );

    expect(values).toEqual({
      startDateTime: "2099-08-12T09:00",
      duration: "hour:1",
      name: "Ada Lovelace",
      email: adaEmail,
      phone: "+420777777777",
      billing: { purpose: "personal", invoice: "none" },
      marketingConsent: false,
    });
    expect(
      getMeetingRoomReservationInterval(values.startDateTime, {
        unit: "hour",
        amount: 1,
      })
    ).toEqual({
      startsAt: "2099-08-12T07:00:00Z",
      endsAt: "2099-08-12T08:00:00Z",
    });
  });

  test("falls back to the earliest start while keeping a valid duration", () => {
    expect(
      getMeetingRoomReservationDefaultValuesFromSearchParams(
        {
          duration: "hour:4",
          startDateTime: "2099-02-30T09:00",
        },
        deterministicNow()
      )
    ).toMatchObject({
      startDateTime: "2099-07-30T12:00",
      duration: "hour:4",
    });
  });

  test("keeps an ongoing start, keeping valid siblings", () => {
    const now = workspaceInstant("2099-07-30T10:30");

    expect(
      getMeetingRoomReservationDefaultValuesFromSearchParams(
        {
          duration: "hour:1",
          email: adaEmail,
          name: "Ada Lovelace",
          startDateTime: "2099-07-30T10:00",
        },
        now
      )
    ).toEqual({
      startDateTime: "2099-07-30T10:00",
      duration: "hour:1",
      name: "Ada Lovelace",
      email: adaEmail,
      phone: "",
      billing: { purpose: "personal", invoice: "none" },
      marketingConsent: false,
    });

    expect(
      getMeetingRoomReservationDefaultValuesFromSearchParams(
        { duration: "hour:4", startDateTime: "2099-07-30T09:00" },
        now
      )
    ).toMatchObject({
      startDateTime: "2099-07-30T09:00",
      duration: "hour:4",
    });
    expect(
      getMeetingRoomReservationDefaultValuesFromSearchParams(
        { duration: "day:1", startDateTime: "2099-07-30T00:00" },
        now
      )
    ).toMatchObject({ startDateTime: "2099-07-30T00:00", duration: "day:1" });
  });

  test("falls back for an interval that already ended", () => {
    const now = workspaceInstant("2099-07-30T10:30");

    expect(
      getMeetingRoomReservationDefaultValuesFromSearchParams(
        { duration: "hour:1", startDateTime: "2099-07-30T09:00" },
        now
      )
    ).toMatchObject({ startDateTime: "2099-07-30T10:00", duration: "hour:1" });
    expect(
      getMeetingRoomReservationDefaultValuesFromSearchParams(
        { duration: "hour:4", startDateTime: "2099-07-30T06:00" },
        now
      )
    ).toMatchObject({ startDateTime: "2099-07-30T07:00", duration: "hour:4" });
    expect(
      getMeetingRoomReservationDefaultValuesFromSearchParams(
        { duration: "day:1", startDateTime: "2099-07-29T00:00" },
        now
      )
    ).toMatchObject({ startDateTime: "2099-07-30T00:00", duration: "day:1" });
  });

  test("keeps an interval that ends exactly at now, like the picker minimum", () => {
    const now = workspaceInstant("2099-07-30T11:00");

    expect(
      getMeetingRoomReservationDefaultValuesFromSearchParams(
        { duration: "hour:4", startDateTime: "2099-07-30T07:00" },
        now
      )
    ).toMatchObject({ startDateTime: "2099-07-30T07:00", duration: "hour:4" });
    expect(
      getEarliestMeetingRoomStartDateTime({ unit: "hour", amount: 4 }, now)
    ).toBe("2099-07-30T07:00");
  });

  test("keeps a whole-hour start exactly at now", () => {
    const now = workspaceInstant("2099-07-30T11:00");

    expect(
      getMeetingRoomReservationDefaultValuesFromSearchParams(
        { startDateTime: "2099-07-30T11:00" },
        now
      )
    ).toMatchObject({ startDateTime: "2099-07-30T11:00" });
  });

  test("falls back independently for past and empty starts", () => {
    expect(
      getMeetingRoomReservationDefaultValuesFromSearchParams(
        { startDateTime: "2099-07-30T09:00" },
        deterministicNow()
      )
    ).toMatchObject({ startDateTime: "2099-07-30T15:00", duration: "hour:1" });
    expect(
      getMeetingRoomReservationDefaultValuesFromSearchParams(
        { startDateTime: "" },
        deterministicNow()
      )
    ).toMatchObject({ startDateTime: "2099-07-30T15:00" });
  });

  test("rejects DST nonexistent and ambiguous whole-hour starts", () => {
    // Prague transition Sundays: 2099-03-29 springs 02:00 -> 03:00 and
    // 2099-10-25 falls 03:00 -> 02:00, so 02:00 is nonexistent / ambiguous.
    const marchLastDay = Temporal.PlainDate.from("2099-03-31");
    const springForward = marchLastDay.subtract({
      days: marchLastDay.dayOfWeek % 7,
    });
    const octoberLastDay = Temporal.PlainDate.from("2099-10-31");
    const fallBack = octoberLastDay.subtract({
      days: octoberLastDay.dayOfWeek % 7,
    });

    const cases = [
      {
        now: Temporal.Instant.from("2099-03-01T12:00:00Z"),
        earliest: "2099-03-01T12:00",
        transition: springForward.toString(),
        nearbyValid: "05:00",
      },
      {
        now: Temporal.Instant.from("2099-10-01T12:00:00Z"),
        earliest: "2099-10-01T13:00",
        transition: fallBack.toString(),
        nearbyValid: "05:00",
      },
    ];

    for (const { now, earliest, transition, nearbyValid } of cases) {
      expect(
        getMeetingRoomReservationDefaultValuesFromSearchParams(
          { startDateTime: `${transition}T02:00` },
          now
        )
      ).toMatchObject({ startDateTime: earliest });

      expect(
        getMeetingRoomReservationDefaultValuesFromSearchParams(
          {
            email: adaEmail,
            name: "Ada Lovelace",
            startDateTime: `${transition}T${nearbyValid}`,
          },
          now
        )
      ).toMatchObject({
        startDateTime: `${transition}T${nearbyValid}`,
        name: "Ada Lovelace",
        email: adaEmail,
      });
    }
  });
});

describe("customer last reservation defaults", () => {
  test("fills an open meeting room duration from the last reservation", () => {
    expect(
      getMeetingRoomReservationDefaultValuesFromSearchParams(
        { startDateTime: "2099-08-12T09:00" },
        deterministicNow(),
        { kind: "meeting-room", duration: "hour:4" }
      ).duration
    ).toBe("hour:4");
    expect(
      getMeetingRoomReservationDefaultValuesFromSearchParams(
        { duration: "hour:1", startDateTime: "2099-08-12T09:00" },
        deterministicNow(),
        { kind: "meeting-room", duration: "hour:4" }
      ).duration
    ).toBe("hour:1");
  });
});

describe("getMeetingRoomReservationSelectionSearchParams", () => {
  test.each([
    { startDateTime: "2099-08-12T09:00", duration: "hour:1" },
    { startDateTime: "2099-08-13T14:00", duration: "hour:4" },
    { startDateTime: "2099-08-14T08:00", duration: "day:1" },
  ] as const)("the parser reads back the written selection %o", (selection) => {
    const searchParams = new URLSearchParams(
      "duration=hour:4&discountCode=SPRING"
    );
    setReservationSelectionSearchParams(
      searchParams,
      getMeetingRoomReservationSelectionSearchParams(selection)
    );

    expect(
      getMeetingRoomReservationDefaultValuesFromSearchParams(
        searchParams,
        deterministicNow()
      )
    ).toEqual(expect.objectContaining(selection));
    expect(searchParams.get("discountCode")).toBe("SPRING");
  });

  const ongoingNow = workspaceInstant("2099-07-30T10:30");
  const ongoingSelection = {
    startDateTime: "2099-07-30T09:00",
    duration: "hour:4",
  } as const;

  const writeSelection = (searchParams: URLSearchParams) => {
    setReservationSelectionSearchParams(
      searchParams,
      getMeetingRoomReservationSelectionSearchParams(ongoingSelection)
    );
    return new URLSearchParams(searchParams.toString());
  };

  test("the parser reads back an ongoing interval after its earliest start", () => {
    expect(
      getEarliestMeetingRoomStartDateTime(
        { unit: "hour", amount: 4 },
        ongoingNow
      )
    ).not.toBe(ongoingSelection.startDateTime);

    expect(
      getMeetingRoomReservationDefaultValuesFromSearchParams(
        writeSelection(new URLSearchParams()),
        ongoingNow
      )
    ).toEqual(expect.objectContaining(ongoingSelection));
  });

  test("a Pay restoration reads back an ongoing interval edited into the URL", () => {
    const restoredReservation: NormalizedMeetingRoomReservationOrder = {
      kind: "meeting-room",
      duration: { unit: "hour", amount: 1 },
      reservationDate: "2099-07-30",
      startsAt: "2099-07-30T12:00:00Z",
      endsAt: "2099-07-30T13:00:00Z",
      name: "Ada Lovelace",
      email: adaEmail,
      phone: "+420777777777",
      billing: { purpose: "personal", invoice: "none" },
    };

    expect(
      getMeetingRoomRestoredReservationValues(
        restoredReservation,
        writeSelection(new URLSearchParams("payState=signed")),
        ongoingNow
      )
    ).toEqual(
      expect.objectContaining({
        ...ongoingSelection,
        name: "Ada Lovelace",
        email: adaEmail,
      })
    );
  });
});

describe("getStoredMeetingRoomReservationSelectionSearchParams", () => {
  const readBack = (
    reservation: Parameters<
      typeof getStoredMeetingRoomReservationSelectionSearchParams
    >[0]
  ) => {
    const searchParams = new URLSearchParams();
    setReservationSelectionSearchParams(
      searchParams,
      getStoredMeetingRoomReservationSelectionSearchParams(reservation) ?? {}
    );
    for (const contactKey of ["name", "email", "phone", "customer"]) {
      expect(searchParams.has(contactKey)).toBe(false);
    }
    return getMeetingRoomReservationDefaultValuesFromSearchParams(
      searchParams,
      deterministicNow()
    );
  };

  test.each([
    { startDateTime: "2099-08-12T09:00", duration: "hour:1" },
    { startDateTime: "2099-08-13T14:00", duration: "hour:4" },
    { startDateTime: "2099-08-14T00:00", duration: "day:1" },
  ] as const)(
    "the parser reads back the stored reservation %o",
    (selection) => {
      const interval = getMeetingRoomReservationInterval(
        selection.startDateTime,
        getMeetingRoomReservationDuration(selection.duration)
      );
      if (!interval) throw new Error("Expected a meeting-room interval.");

      expect(
        readBack({
          kind: "meeting-room",
          duration: getMeetingRoomReservationDuration(selection.duration),
          reservedFrom: Temporal.Instant.from(interval.startsAt),
          reservedUntil: Temporal.Instant.from(interval.endsAt),
        })
      ).toEqual(expect.objectContaining(selection));
    }
  );

  test("takes the duration from the interval when the row has none", () => {
    expect(
      readBack({
        kind: "meeting-room",
        reservedFrom: workspaceInstant("2099-08-13T14:00"),
        reservedUntil: workspaceInstant("2099-08-13T18:00"),
      })
    ).toEqual(
      expect.objectContaining({
        startDateTime: "2099-08-13T14:00",
        duration: "hour:4",
      })
    );
  });
});
