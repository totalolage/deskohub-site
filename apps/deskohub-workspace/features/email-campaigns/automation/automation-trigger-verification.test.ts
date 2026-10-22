import { describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { Option } from "effect";
import type { ReservationVisit } from "@/features/reservation/backend/reservation-visits.service";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { stillHolds } from "./automation-trigger-verification";

const at = Temporal.Instant.from("2026-10-19T10:00:00Z");

const visit = (
  overrides: Partial<Pick<ReservationVisit, "startsAt" | "endsAt" | "status">>
): Option.Option<ReservationVisit> =>
  Option.some({
    workspaceReservationId: workspaceReservationIdSchema.make("reservation"),
    dotyposReservationId: DotyposReservationIdSchema.make("dotypos"),
    dotyposCustomerId: DotyposCustomerIdSchema.make("customer"),
    startsAt: at.subtract({ hours: 3 }),
    endsAt: at.subtract({ hours: 1 }),
    status: "active",
    ...overrides,
  });

describe("stillHolds", () => {
  test("withdraws a booked, started or finished trigger whose visit is cancelled or gone", () => {
    for (const kind of [
      "reservation-booked",
      "reservation-started",
      "reservation-finished",
    ] as const) {
      expect(stillHolds({ kind, visit: Option.none(), at })).toBe("withdraw");
      expect(
        stillHolds({ kind, visit: visit({ status: "cancelled" }), at })
      ).toBe("withdraw");
    }
  });

  test("defers a started or finished trigger whose visit moved past now", () => {
    const later = at.add({ minutes: 30 });
    expect(
      stillHolds({
        kind: "reservation-started",
        visit: visit({ startsAt: later, endsAt: later.add({ hours: 2 }) }),
        at,
      })
    ).toBe("defer");
    expect(
      stillHolds({
        kind: "reservation-finished",
        visit: visit({ endsAt: later }),
        at,
      })
    ).toBe("defer");
    // A booked trigger has happened whenever the visit is.
    expect(
      stillHolds({
        kind: "reservation-booked",
        visit: visit({ startsAt: later, endsAt: later.add({ hours: 2 }) }),
        at,
      })
    ).toBe("send");
  });

  test("sends once the trigger's moment has passed, at the instant itself included", () => {
    expect(
      stillHolds({
        kind: "reservation-finished",
        visit: visit({ endsAt: at }),
        at,
      })
    ).toBe("send");
    expect(
      stillHolds({ kind: "reservation-started", visit: visit({}), at })
    ).toBe("send");
  });

  test("never withdraws a cancellation, schedule or account trigger", () => {
    for (const kind of [
      "reservation-cancelled",
      "schedule",
      "account-created",
    ] as const) {
      expect(stillHolds({ kind, visit: Option.none(), at })).toBe("send");
    }
  });
});
