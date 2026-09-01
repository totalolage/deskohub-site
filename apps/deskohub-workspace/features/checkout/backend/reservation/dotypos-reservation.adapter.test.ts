import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { checkoutDetailsSchema } from "@/features/checkout/schemas/checkout-details";
import { instantStringSchema } from "@/shared/utils/temporal";
import {
  createWorkspaceDotyposReservation,
  formatWorkspaceReservationNote,
} from "./dotypos-reservation.adapter";
import {
  type IWorkspaceTableAssignmentService,
  WorkspaceTableAssignmentService,
} from "./workspace-table-assignment.service";

const decodeInstant = Schema.decodeUnknownSync(instantStringSchema);

const checkoutDetails = Schema.decodeUnknownSync(checkoutDetailsSchema)({
  locale: "en-US",
  reservation: {
    kind: "cowork",
    entryTier: "basic",
    date: "2099-06-10",
    coffee: false,
  },
  payment: {
    expectedPrice: { value: 35_000, exponent: 2, currency: "CZK" },
    undiscountedPrice: { value: 35_000, exponent: 2, currency: "CZK" },
    discounts: [],
    summary: {
      sections: [],
      total: { value: 35_000, exponent: 2, currency: "CZK" },
    },
  },
  legal: {},
});

describe("createWorkspaceDotyposReservation", () => {
  test("uses the cowork reservation domain interval for creation", async () => {
    const reservation = {
      kind: "cowork" as const,
      entryTier: "basic" as const,
      date: "2099-06-10",
      coffee: false,
    };
    const assignTableId = mock(() => Effect.succeed("cowork-table-id"));
    const createReservation = mock(() =>
      Effect.succeed({ id: "dotypos-reservation-id" } as never)
    );
    const testLayer = Layer.mergeAll(
      Layer.mock(WorkspaceTableAssignmentService, {
        assignTableId,
      } satisfies IWorkspaceTableAssignmentService),
      Layer.mock(DotyposService, {
        createReservation,
      })
    );

    await createWorkspaceDotyposReservation({
      paymentOrderId: "payment-order-id",
      dotyposCustomerId: "dotypos-customer-id",
      checkoutDetails,
      reservation,
      status: "NEW",
    }).pipe(Effect.provide(testLayer), Effect.runPromise);

    expect(assignTableId).toHaveBeenCalledWith(reservation);
    expect(createReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: new Date("2099-06-09T22:00:00Z"),
        endDate: new Date("2099-06-10T22:00:00Z"),
      })
    );
  });

  test("uses the meeting-room reservation for assignment and creation", async () => {
    const reservation = {
      kind: "meeting-room" as const,
      duration: { unit: "hour" as const, amount: 4 as const },
      reservationDate: "2099-06-10",
      startsAt: decodeInstant("2099-06-10T08:00:00Z"),
      endsAt: decodeInstant("2099-06-10T12:00:00Z"),
    };
    const assignTableId = mock(() => Effect.succeed("meeting-room-table-id"));
    const createReservation = mock(() =>
      Effect.succeed({ id: "dotypos-reservation-id" } as never)
    );
    const testLayer = Layer.mergeAll(
      Layer.mock(WorkspaceTableAssignmentService, {
        assignTableId,
      } satisfies IWorkspaceTableAssignmentService),
      Layer.mock(DotyposService, {
        createReservation,
      })
    );
    const input = {
      paymentOrderId: "payment-order-id",
      dotyposCustomerId: "dotypos-customer-id",
      checkoutDetails,
      reservation,
      status: "NEW" as const,
    };

    await createWorkspaceDotyposReservation(input).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    );

    expect(assignTableId).toHaveBeenCalledWith(reservation);
    expect(createReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: new Date("2099-06-10T08:00:00Z"),
        endDate: new Date("2099-06-10T12:00:00Z"),
        note: expect.stringContaining(
          "Time: 2099-06-10T08:00:00Z-2099-06-10T12:00:00Z"
        ),
      })
    );
  });

  test("labels a DST calendar-day reservation as whole day in the note", () => {
    const note = formatWorkspaceReservationNote({
      paymentOrderId: "payment-order-id",
      checkoutDetails,
      reservation: {
        kind: "meeting-room",
        duration: { unit: "day", amount: 1 },
        reservationDate: "2026-03-29",
        startsAt: decodeInstant("2026-03-28T23:00:00Z"),
        endsAt: decodeInstant("2026-03-29T22:00:00Z"),
      },
    });

    expect(note).toContain("Duration: whole day");
    expect(note).not.toContain("Duration: 1380 minutes");
  });

  test.each([
    [{ unit: "hour", amount: 4 }, "Duration: 4 hodiny"],
    [{ unit: "day", amount: 1 }, "Duration: celý den"],
  ] as const)(
    "localizes a Czech meeting-room %s duration in the note",
    (duration, expected) => {
      const note = formatWorkspaceReservationNote({
        paymentOrderId: "payment-order-id",
        checkoutDetails: { ...checkoutDetails, locale: "cs-CZ" },
        reservation: {
          kind: "meeting-room",
          duration,
          reservationDate: "2026-03-29",
          startsAt: decodeInstant("2026-03-28T23:00:00Z"),
          endsAt: decodeInstant("2026-03-29T22:00:00Z"),
        },
      });

      expect(note).toContain(expected);
    }
  );
});
