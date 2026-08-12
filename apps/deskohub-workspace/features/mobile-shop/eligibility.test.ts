import { describe, expect, test } from "bun:test";
import { DotyposReservationIdSchema } from "@deskohub/dotypos";
import {
  evaluateMobileShopEligibility,
  getCurrentMobileShopDay,
  type MobileShopReservationCandidate,
} from "./eligibility";

const reservation = (
  input: Partial<MobileShopReservationCandidate> &
    Pick<MobileShopReservationCandidate, "id">
): MobileShopReservationCandidate => ({
  id: input.id,
  status: "CONFIRMED",
  startsAt: Temporal.Instant.from("2026-08-11T08:00:00Z"),
  endsAt: Temporal.Instant.from("2026-08-11T10:00:00Z"),
  ...input,
});

describe("mobile shop reservation-day eligibility", () => {
  test("unlocks the whole local day for any confirmed overlapping reservation", () => {
    const result = evaluateMobileShopEligibility({
      now: Temporal.Instant.from("2026-08-11T21:30:00Z"),
      reservations: [
        reservation({ id: DotyposReservationIdSchema.make("confirmed") }),
      ],
    });

    expect(result.kind).toBe("eligible");
    expect(result.day.date).toBe("2026-08-11");
    expect(result.day.startsAt.toString()).toBe("2026-08-10T22:00:00Z");
    expect(result.day.endsAt.toString()).toBe("2026-08-11T22:00:00Z");
  });

  test("never grants access for NEW or CANCELLED reservations", () => {
    const result = evaluateMobileShopEligibility({
      now: Temporal.Instant.from("2026-08-11T09:00:00Z"),
      reservations: [
        reservation({
          id: DotyposReservationIdSchema.make("new"),
          status: "NEW",
        }),
        reservation({
          id: DotyposReservationIdSchema.make("cancelled"),
          status: "CANCELLED",
        }),
      ],
    });
    expect(result).toMatchObject({
      kind: "locked",
      reason: "no_active_reservation",
    });
  });

  test("uses consecutive Prague midnights across a 23-hour DST day", () => {
    const day = getCurrentMobileShopDay(
      Temporal.Instant.from("2026-03-29T10:00:00Z")
    );
    expect(day.date).toBe("2026-03-29");
    expect(
      Number(day.endsAt.epochMilliseconds - day.startsAt.epochMilliseconds) /
        3_600_000
    ).toBe(23);
  });
});
