import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { normalizedCoworkReservationOrderSchema } from "./cowork-reservation";
import { getMeetingRoomReservationInterval } from "./meeting-room-reservation-time";
import {
  getMeetingRoomReservationDefaultValuesFromSearchParams,
  getOfficeReservationDefaultValuesFromSearchParams,
  getReservationCustomerQueryMode,
  getReservationDefaultValuesFromPayState,
  getReservationDefaultValuesFromSearchParams,
  getWorkspaceAvailabilityQueryFromReservationSearchParams,
} from "./reservation-checkout-query";

const deterministicNow = () => Temporal.Instant.from("2099-07-30T13:01:00Z");

const workspaceInstant = (local: string) =>
  Temporal.PlainDateTime.from(local)
    .toZonedDateTime(workspaceSiteConstants.location.timeZone, {
      disambiguation: "compatible",
    })
    .toInstant();

describe("getWorkspaceAvailabilityQueryFromReservationSearchParams", () => {
  test("normalizes checkout tier aliases for availability", () => {
    const query = getWorkspaceAvailabilityQueryFromReservationSearchParams({
      date: "2099-06-10",
      monitorOption: "2x27-qhd",
      tier: "reserved-desk",
    });

    expect(query).toMatchObject({
      kind: "cowork",
      date: "2099-06-10",
      entryTier: "reserved-desk",
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
      entryTier: "open-space",
    });
  });

  test("drops monitor options for tiers that do not use monitors", () => {
    const query = getWorkspaceAvailabilityQueryFromReservationSearchParams({
      date: "2099-06-10",
      entryTier: "open-space",
      monitorOption: "2x27-qhd",
    });

    expect(query).toMatchObject({
      kind: "cowork",
      date: "2099-06-10",
      entryTier: "open-space",
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
      entryTier: "open-space",
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
      entryTier: "open-space",
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

  test("decodes customer fields independently as URLSearchParams", () => {
    const values = getReservationDefaultValuesFromSearchParams(
      new URLSearchParams("name=Ada%20Lovelace&email=invalid@")
    );

    expect(values.name).toBe("Ada Lovelace");
    expect(values.email).toBe("");
    expect(values.phone).toBe("");
  });

  test("decodes customer fields independently as plain records", () => {
    const values = getReservationDefaultValuesFromSearchParams({
      name: "  ",
      email: "ada@example.com",
      phone: "+420777777777",
    });

    expect(values.name).toBe("");
    expect(values.email).toBe("ada@example.com");
    expect(values.phone).toBe("+420777777777");
  });
});

describe("getMeetingRoomReservationDefaultValuesFromSearchParams", () => {
  test("prefills a valid future hourly reservation in Workspace time", () => {
    const values = getMeetingRoomReservationDefaultValuesFromSearchParams(
      {
        duration: "hour:1",
        email: " ada@example.com ",
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
      email: "ada@example.com",
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

  test("decodes a plus-encoded phone from a URL query string", () => {
    expect(
      getMeetingRoomReservationDefaultValuesFromSearchParams(
        new URLSearchParams("email=ada@example.com&phone=%2B420777777777"),
        deterministicNow()
      ).phone
    ).toBe("+420777777777");
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

  test("falls back for a start that already began, keeping valid siblings", () => {
    const now = workspaceInstant("2099-07-30T10:30");

    expect(
      getMeetingRoomReservationDefaultValuesFromSearchParams(
        {
          duration: "hour:1",
          email: "ada@example.com",
          name: "Ada Lovelace",
          startDateTime: "2099-07-30T10:00",
        },
        now
      )
    ).toEqual({
      startDateTime: "2099-07-30T10:00",
      duration: "hour:1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "",
      billing: { purpose: "personal", invoice: "none" },
      marketingConsent: false,
    });

    expect(
      getMeetingRoomReservationDefaultValuesFromSearchParams(
        { duration: "hour:4", startDateTime: "2099-07-30T10:00" },
        now
      )
    ).toMatchObject({
      startDateTime: "2099-07-30T07:00",
      duration: "hour:4",
    });
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

  test("falls back for unsupported durations", () => {
    expect(
      getMeetingRoomReservationDefaultValuesFromSearchParams(
        { duration: "hour:3" },
        deterministicNow()
      )
    ).toMatchObject({ duration: "hour:1" });
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
            email: "ada@example.com",
            name: "Ada Lovelace",
            startDateTime: `${transition}T${nearbyValid}`,
          },
          now
        )
      ).toMatchObject({
        startDateTime: `${transition}T${nearbyValid}`,
        name: "Ada Lovelace",
        email: "ada@example.com",
      });
    }
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
      entryTier: "reserved-desk",
      date: "2099-06-10",
      coffee: true,
      monitorOption: "2x27-qhd",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420 777 000 111",
    });

    expect(getReservationDefaultValuesFromPayState(reservation)).toEqual({
      entryTier: "reserved-desk",
      date: "2099-06-10",
      coffee: true,
      monitorOption: "2x27-qhd",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420 777 000 111",
      billing: { purpose: "personal", invoice: "none" },
      marketingConsent: false,
    });
  });
});

describe("retired reservation customer message", () => {
  test("ignores a message query parameter without harming valid siblings", () => {
    const values = getReservationDefaultValuesFromSearchParams(
      new URLSearchParams(
        "name=Ada%20Lovelace&email=ada%40example.com&phone=%2B420777777777&message=%20Legacy%20note%20&entryTier=open-space&date=2099-06-10"
      )
    );

    expect(values.name).toBe("Ada Lovelace");
    expect(values.email).toBe("ada@example.com");
    expect(values.phone).toBe("+420777777777");
    expect(values.entryTier).toBe("open-space");
    expect(values.date).toBe("2099-06-10");
    expect(values).not.toHaveProperty("message");
  });

  test("does not introduce a message field into new form defaults", () => {
    const fromEmptyQuery = getReservationDefaultValuesFromSearchParams({});
    const fromMeetingRoomQuery =
      getMeetingRoomReservationDefaultValuesFromSearchParams(
        { name: "Ada Lovelace" },
        deterministicNow()
      );

    expect(fromEmptyQuery).not.toHaveProperty("message");
    expect(fromMeetingRoomQuery).not.toHaveProperty("message");
  });

  test("drops a legacy customer message when restoring from signed Pay state", () => {
    const reservation = Schema.decodeUnknownSync(
      normalizedCoworkReservationOrderSchema,
      { onExcessProperty: "error" }
    )({
      kind: "cowork",
      entryTier: "reserved-desk",
      date: "2099-06-10",
      coffee: true,
      monitorOption: "2x27-qhd",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420 777 000 111",
      message: "Please prepare the standing desk.",
    });

    expect(reservation).not.toHaveProperty("message");
    expect(getReservationDefaultValuesFromPayState(reservation)).toEqual({
      entryTier: "reserved-desk",
      date: "2099-06-10",
      coffee: true,
      monitorOption: "2x27-qhd",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420 777 000 111",
      billing: { purpose: "personal", invoice: "none" },
      marketingConsent: false,
    });
  });
});

describe("getReservationCustomerQueryMode", () => {
  test("honours an explicit customer parameter over contact fields", () => {
    expect(
      getReservationCustomerQueryMode({
        customer: "account",
        name: "Ada Lovelace",
      })
    ).toBe("account");
    expect(getReservationCustomerQueryMode({ customer: " contact " })).toBe(
      "contact"
    );
  });

  test("treats any contact field as a request for that exact contact", () => {
    expect(
      getReservationCustomerQueryMode(
        new URLSearchParams("phone=%2B420777777777")
      )
    ).toBe("contact");
    expect(getReservationCustomerQueryMode({ email: "invalid@" })).toBe(
      "contact"
    );
  });

  test("leaves the mode open without a customer or contact parameter", () => {
    expect(getReservationCustomerQueryMode({ tier: "plus" })).toBeUndefined();
    expect(
      getReservationCustomerQueryMode({ customer: "someone", name: "  " })
    ).toBeUndefined();
  });

  test("ignores contact fields on forms whose links never prefill them", () => {
    expect(
      getReservationCustomerQueryMode(
        { name: "Ada Lovelace" },
        { prefillsContact: false }
      )
    ).toBeUndefined();
    expect(
      getReservationCustomerQueryMode(
        { customer: "contact" },
        { prefillsContact: false }
      )
    ).toBe("contact");
  });
});

describe("customer last reservation defaults", () => {
  test("fills an open cowork offer from the last reservation", () => {
    expect(
      getReservationDefaultValuesFromSearchParams(
        { date: "2099-06-10" },
        {
          kind: "cowork",
          entryTier: "reserved-desk",
          coffee: true,
          monitorOption: "2x27-qhd",
        }
      )
    ).toMatchObject({
      date: "2099-06-10",
      entryTier: "reserved-desk",
      coffee: true,
      monitorOption: "2x27-qhd",
    });
  });

  test("keeps explicit cowork query options over the last reservation", () => {
    const lastReservation = {
      kind: "cowork",
      entryTier: "reserved-desk",
      coffee: true,
      monitorOption: "2x27-qhd",
    } as const;

    expect(
      getReservationDefaultValuesFromSearchParams(
        { tier: "reserved-desk", monitorOption: "2x32-4k" },
        lastReservation
      )
    ).toMatchObject({
      entryTier: "reserved-desk",
      coffee: true,
      monitorOption: "2x32-4k",
    });
    // Another tier replaces the whole remembered offer.
    expect(
      getReservationDefaultValuesFromSearchParams(
        { tier: "open-space" },
        lastReservation
      )
    ).toEqual(
      getReservationDefaultValuesFromSearchParams({ tier: "open-space" })
    );
  });

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
