import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { Effect, Result, Schema } from "effect";
import "@/shared/polyfills/temporal";
import { makeSchemaParser } from "@/shared/utils/schema-parser";
import {
  getMeetingRoomReservationDefaultValues,
  getMeetingRoomReservationDurationMinutes,
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

afterEach(() => setSystemTime());

describe("meetingRoomReservationSchema", () => {
  test("owns canonical meeting-room product keys", () => {
    expect(
      getWorkspaceMeetingRoomProductKey({
        kind: "meeting-room",
        durationMinutes: 60,
      })
    ).toBe("meeting-room:60");
    expect(
      getWorkspaceMeetingRoomProductKey({
        kind: "meeting-room",
        durationMinutes: 240,
      })
    ).toBe("meeting-room:240");
    expect(
      getWorkspaceMeetingRoomProductKey({
        kind: "meeting-room",
        durationMinutes: 1440,
      })
    ).toBe("meeting-room:1440");
    const decodeProductKey = Schema.decodeUnknownSync(
      workspaceMeetingRoomProductKeySchema
    );
    expect(() => decodeProductKey("meeting-room:4")).toThrow();
    expect(() => decodeProductKey("meeting-room:240-minutes")).toThrow();
  });

  test("rejects an empty meeting-room start without throwing", () => {
    const result = schema.safeParse({
      startDateTime: "",
      durationMinutes: 60,
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
      message: "",
      legalConsent: true,
    });

    expect(Result.isFailure(result)).toBe(true);
  });

  test("reuses contact normalization for a valid meeting-room form", () => {
    const result = schema.safeParse({
      startDateTime: "2099-06-10T10:00",
      durationMinutes: 240,
      name: "  Ada Lovelace  ",
      email: "  ada@example.com  ",
      phone: "+420777777777",
      message: "  Project workshop  ",
      legalConsent: true,
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toMatchObject({
        name: "Ada Lovelace",
        email: "ada@example.com",
        message: "Project workshop",
      });
    }
  });

  test("allows a reservation that has started but not ended", () => {
    setSystemTime(new Date("2099-06-10T10:30:00Z"));

    const formResult = schema.safeParse({
      startDateTime: "2099-06-10T12:00",
      durationMinutes: 60,
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
      message: "",
      legalConsent: true,
    });

    const issues = Effect.runSync(
      getMeetingRoomReservationIssues(
        decodeOrder({
          kind: "meeting-room",
          startsAt: "2099-06-10T10:00:00Z",
          endsAt: "2099-06-10T11:00:00Z",
          name: "Ada Lovelace",
          email: "ada@example.com",
          phone: "+420777777777",
        })
      )
    );

    expect(Result.isSuccess(formResult)).toBe(true);
    expect(issues).toEqual([]);
  });

  test("decodes meeting-room orders with the domain discriminator", () => {
    const result = decodeOrder({
      kind: "meeting-room",
      startsAt: "2099-06-10T10:00:00Z",
      endsAt: "2099-06-10T11:00:00Z",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
    });

    expect(result).toMatchObject({ kind: "meeting-room" });
    expect(result).not.toHaveProperty("_tag");
  });

  test("stores only the meeting-room family discriminator", () => {
    expect(
      getStoredMeetingRoomReservationDetails({ kind: "meeting-room" })
    ).toEqual({ kind: "meeting-room" });

    expect(
      Result.isFailure(
        storedDetailsParser.safeParse({
          kind: "meeting-room",
          startsAt: "2099-06-10T10:00:00Z",
        })
      )
    ).toBe(true);
  });

  test("rejects Prague times that cannot identify one instant", () => {
    setSystemTime(new Date("2026-01-01T00:00:00Z"));

    for (const startDateTime of ["2026-03-29T02:00", "2026-10-25T02:00"]) {
      const result = schema.safeParse({
        startDateTime,
        durationMinutes: 60,
        name: "Ada Lovelace",
        email: "ada@example.com",
        phone: "+420777777777",
        message: "",
        legalConsent: true,
      });

      expect(Result.isFailure(result)).toBe(true);
    }
  });

  test("projects signed state to Prague form values and back to an order", () => {
    const reservation = normalizedMeetingRoomReservationOrderSchema.make({
      kind: "meeting-room",
      startsAt: "2099-07-30T08:00:00Z",
      endsAt: "2099-07-30T12:00:00Z",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
      message: "Workshop",
    });

    const defaults = getMeetingRoomReservationDefaultValues(reservation);
    expect(defaults).toEqual({
      startDateTime: "2099-07-30T10:00",
      durationMinutes: 240,
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
      message: "Workshop",
      legalConsent: false,
    });

    expect(
      getMeetingRoomReservationOrder({ ...defaults, legalConsent: true })
    ).toEqual(reservation);
  });

  test("maps a DST whole day to the stable whole-day product identity", () => {
    const reservation = normalizedMeetingRoomReservationOrderSchema.make({
      kind: "meeting-room",
      startsAt: "2026-03-28T23:00:00Z",
      endsAt: "2026-03-29T22:00:00Z",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
    });

    expect(getMeetingRoomReservationDurationMinutes(reservation)).toBe(1440);
    expect(getMeetingRoomReservationDefaultValues(reservation)).toMatchObject({
      startDateTime: "2026-03-29T00:00",
      durationMinutes: 1440,
    });
  });

  test("normalizes whole-day form selections and rejects rolling 24-hour orders", () => {
    const result = schema.safeParse({
      startDateTime: "2099-06-10T15:00",
      durationMinutes: 1440,
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
      message: "",
      legalConsent: true,
    });
    const issues = Effect.runSync(
      getMeetingRoomReservationIssues(
        decodeOrder({
          kind: "meeting-room",
          startsAt: "2099-06-10T13:00:00Z",
          endsAt: "2099-06-11T13:00:00Z",
          name: "Ada Lovelace",
          email: "ada@example.com",
          phone: "+420777777777",
        })
      )
    );

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(getMeetingRoomReservationOrder(result.success)).toMatchObject({
        startsAt: "2099-06-09T22:00:00Z",
        endsAt: "2099-06-10T22:00:00Z",
      });
    }
    expect(issues).toHaveLength(1);
  });
});
