import { afterEach, describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import { getReservationOrderSchema } from "./reservation";

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
      expect(result.error.issues).toContainEqual(
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
});
