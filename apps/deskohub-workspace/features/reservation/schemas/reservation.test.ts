import { afterEach, describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import { getReservationOrderSchema, getReservationSchema } from "./reservation";

const originalDateNow = Date.now;

const validMeetingRoomReservation = {
  entryTier: "meeting-room",
  startsAt: "2099-06-10T07:00:00Z",
  endsAt: "2099-06-10T08:00:00Z",
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420777777777",
  message: "",
} as const;

describe("reservation schema", () => {
  afterEach(() => {
    Date.now = originalDateNow;
  });

  test("rejects meeting room start times in the past", () => {
    Date.now = () => new Date("2099-06-10T08:00:00.000Z").getTime();

    const result = getReservationOrderSchema().safeParse(
      validMeetingRoomReservation
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect((result.error as { issues: unknown[] }).issues).toContainEqual(
        expect.objectContaining({ path: ["startsAt"] })
      );
    }
  });

  test("accepts meeting room start times in the future", () => {
    Date.now = () => new Date("2099-06-10T06:00:00.000Z").getTime();

    expect(
      getReservationOrderSchema().safeParse(validMeetingRoomReservation).success
    ).toBe(true);
  });

  test("normalizes cowork form dates to a full Prague business day", () => {
    const result = getReservationSchema().safeParse({
      entryTier: "plus",
      date: "2099-06-10",
      startsAt: "00:00",
      endsAt: "24:00",
      coffee: false,
      monitorOption: undefined,
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
      message: "  hello  ",
      legalConsent: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        entryTier: "plus",
        startsAt: "2099-06-09T22:00:00Z",
        endsAt: "2099-06-10T22:00:00Z",
        coffee: true,
        message: "hello",
      });
    }
  });

  test("rejects monitor setup for non-profi cowork tiers", () => {
    const result = getReservationSchema().safeParse({
      entryTier: "basic",
      date: "2099-06-10",
      startsAt: "00:00",
      endsAt: "24:00",
      coffee: false,
      monitorOption: "2x27-qhd",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
      message: "",
      legalConsent: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect((result.error as { issues: unknown[] }).issues).toContainEqual(
        expect.objectContaining({ path: ["monitorOption"] })
      );
    }
  });

  test("requires a monitor setup for profi cowork reservations", () => {
    const result = getReservationSchema().safeParse({
      entryTier: "profi",
      date: "2099-06-10",
      startsAt: "00:00",
      endsAt: "24:00",
      coffee: true,
      monitorOption: undefined,
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
      message: "",
      legalConsent: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect((result.error as { issues: unknown[] }).issues).toContainEqual(
        expect.objectContaining({ path: ["monitorOption"] })
      );
    }
  });
});
