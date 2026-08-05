import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { Effect, Result, Schema } from "effect";
import "@/shared/polyfills/temporal";
import { makeSchemaParser } from "@/shared/utils/schema-parser";
import {
  getMeetingRoomReservationDefaultValues,
  getMeetingRoomReservationIssues,
  getMeetingRoomReservationOrder,
  getStoredMeetingRoomReservationDetails,
  getWorkspaceMeetingRoomProductKey,
  meetingRoomReservationOrderInputSchema,
  meetingRoomReservationSchema,
  normalizedMeetingRoomReservationOrderSchema,
  storedMeetingRoomReservationDetailsSchema,
  workspaceMeetingRoomProductKeySchema,
} from "./meeting-room-reservation";

const schema = makeSchemaParser(meetingRoomReservationSchema);
const decodeOrder = Schema.decodeUnknownSync(
  meetingRoomReservationOrderInputSchema
);
const storedDetailsParser = makeSchemaParser(
  storedMeetingRoomReservationDetailsSchema,
  { onExcessProperty: "error" }
);
const customer = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420777777777",
};

afterEach(() => setSystemTime());

describe("meetingRoomReservationSchema", () => {
  test("owns stable pricing-boundary meeting-room product keys", () => {
    expect(
      getWorkspaceMeetingRoomProductKey({
        kind: "meeting-room",
        duration: { unit: "hour", amount: 1 },
      })
    ).toBe("meeting-room:hour:1");
    expect(
      getWorkspaceMeetingRoomProductKey({
        kind: "meeting-room",
        duration: { unit: "hour", amount: 4 },
      })
    ).toBe("meeting-room:hour:4");
    expect(
      getWorkspaceMeetingRoomProductKey({
        kind: "meeting-room",
        duration: { unit: "day", amount: 1 },
      })
    ).toBe("meeting-room:day:1");
    const decodeProductKey = Schema.decodeUnknownSync(
      workspaceMeetingRoomProductKeySchema
    );
    expect(() => decodeProductKey("meeting-room:4")).toThrow();
    expect(() => decodeProductKey("meeting-room:240-minutes")).toThrow();
    expect(() => decodeProductKey("meeting-room:1440")).toThrow();
  });

  test("rejects an empty meeting-room start without throwing", () => {
    const result = schema.safeParse({
      startDateTime: "",
      duration: "hour:1",
      ...customer,
      message: "",
      legalConsent: true,
      marketingConsent: false,
    });

    expect(Result.isFailure(result)).toBe(true);
  });

  test("reuses contact normalization for a valid meeting-room form", () => {
    const result = schema.safeParse({
      startDateTime: "2099-06-10T10:00",
      duration: "hour:4",
      name: "  Ada Lovelace  ",
      email: "  ada@example.com  ",
      phone: customer.phone,
      message: "  Project workshop  ",
      legalConsent: true,
      marketingConsent: true,
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toMatchObject({
        name: "Ada Lovelace",
        email: "ada@example.com",
        message: "Project workshop",
        marketingConsent: true,
      });
    }
  });

  test("allows a reservation that has started but not ended", () => {
    setSystemTime(new Date("2099-06-10T10:30:00Z"));

    const formResult = schema.safeParse({
      startDateTime: "2099-06-10T12:00",
      duration: "hour:1",
      ...customer,
      message: "",
      legalConsent: true,
      marketingConsent: false,
    });
    const issues = Effect.runSync(
      getMeetingRoomReservationIssues(
        decodeOrder({
          kind: "meeting-room",
          duration: { unit: "hour", amount: 1 },
          reservationDate: "2099-06-10",
          startsAt: "2099-06-10T10:00:00Z",
          endsAt: "2099-06-10T11:00:00Z",
          ...customer,
        })
      )
    );

    expect(Result.isSuccess(formResult)).toBe(true);
    expect(issues).toEqual([]);
  });

  test("decodes explicit product intent with the interval", () => {
    const result = decodeOrder({
      kind: "meeting-room",
      duration: { unit: "hour", amount: 1 },
      reservationDate: "2099-06-10",
      startsAt: "2099-06-10T10:00:00Z",
      endsAt: "2099-06-10T11:00:00Z",
      ...customer,
    });

    expect(result).toMatchObject({
      kind: "meeting-room",
      duration: { unit: "hour", amount: 1 },
    });
  });

  test("keeps Dotypos-owned meeting-room facts out of local persistence", () => {
    expect(
      getStoredMeetingRoomReservationDetails({
        kind: "meeting-room",
        duration: { unit: "day", amount: 1 },
      })
    ).toEqual({
      kind: "meeting-room",
    });

    expect(
      Result.isFailure(
        storedDetailsParser.safeParse({
          kind: "meeting-room",
          duration: { unit: "day", amount: 1 },
        })
      )
    ).toBe(true);
  });

  test("rejects Prague times that cannot identify one instant", () => {
    setSystemTime(new Date("2026-01-01T00:00:00Z"));

    for (const startDateTime of ["2026-03-29T02:00", "2026-10-25T02:00"]) {
      const result = schema.safeParse({
        startDateTime,
        duration: "hour:1",
        ...customer,
        message: "",
        legalConsent: true,
        marketingConsent: false,
      });

      expect(Result.isFailure(result)).toBe(true);
    }
  });

  test("projects signed state to Prague form values and back to an order", () => {
    const reservation = normalizedMeetingRoomReservationOrderSchema.make({
      kind: "meeting-room",
      duration: { unit: "hour", amount: 4 },
      reservationDate: "2099-07-30",
      startsAt: "2099-07-30T08:00:00Z",
      endsAt: "2099-07-30T12:00:00Z",
      ...customer,
      message: "Workshop",
    });

    const defaults = getMeetingRoomReservationDefaultValues(reservation);
    expect(defaults).toEqual({
      startDateTime: "2099-07-30T10:00",
      duration: "hour:4",
      ...customer,
      message: "Workshop",
      legalConsent: false,
      marketingConsent: false,
    });
    expect(
      getMeetingRoomReservationOrder({
        ...defaults!,
        legalConsent: true,
        marketingConsent: true,
      })
    ).toEqual(reservation);
  });

  test("keeps whole-day intent across a 23-hour DST day", () => {
    setSystemTime(new Date("2026-03-29T12:00:00Z"));
    const reservation = normalizedMeetingRoomReservationOrderSchema.make({
      kind: "meeting-room",
      duration: { unit: "day", amount: 1 },
      reservationDate: "2026-03-29",
      startsAt: "2026-03-28T23:00:00Z",
      endsAt: "2026-03-29T22:00:00Z",
      ...customer,
    });

    expect(getMeetingRoomReservationDefaultValues(reservation)).toMatchObject({
      startDateTime: "2026-03-29T00:00",
      duration: "day:1",
    });
  });

  test("restores a started calendar day before its end", () => {
    setSystemTime(new Date("2099-06-10T12:00:00Z"));
    const reservation = normalizedMeetingRoomReservationOrderSchema.make({
      kind: "meeting-room",
      duration: { unit: "day", amount: 1 },
      reservationDate: "2099-06-10",
      startsAt: "2099-06-09T22:00:00Z",
      endsAt: "2099-06-10T22:00:00Z",
      ...customer,
    });

    expect(getMeetingRoomReservationDefaultValues(reservation)).toMatchObject({
      startDateTime: "2099-06-10T00:00",
      duration: "day:1",
    });
  });

  test("rejects a day product paired with a rolling 24-hour interval", () => {
    const issues = Effect.runSync(
      getMeetingRoomReservationIssues(
        decodeOrder({
          kind: "meeting-room",
          duration: { unit: "day", amount: 1 },
          reservationDate: "2099-06-10",
          startsAt: "2099-06-10T13:00:00Z",
          endsAt: "2099-06-11T13:00:00Z",
          ...customer,
        })
      )
    );

    expect(issues).toHaveLength(1);
  });

  test("creates a day interval from the selected date, not its hidden clock", () => {
    const result = schema.safeParse({
      startDateTime: "2099-06-10T15:00",
      duration: "day:1",
      ...customer,
      message: "",
      legalConsent: true,
      marketingConsent: false,
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(getMeetingRoomReservationOrder(result.success)).toMatchObject({
        duration: { unit: "day", amount: 1 },
        reservationDate: "2099-06-10",
        startsAt: "2099-06-09T22:00:00Z",
        endsAt: "2099-06-10T22:00:00Z",
      });
    }
  });
});
