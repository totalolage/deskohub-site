import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import { makeEffectSchemaParser } from "@/shared/utils/effect-schema-parser";
import { meetingRoomReservationEffectSchema } from "./meeting-room-reservation";

const schema = makeEffectSchemaParser(meetingRoomReservationEffectSchema);

describe("meetingRoomReservationEffectSchema", () => {
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

    expect(result.success).toBe(false);
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

    expect(result).toMatchObject({
      success: true,
      data: {
        name: "Ada Lovelace",
        email: "ada@example.com",
        message: "Project workshop",
      },
    });
  });
});
