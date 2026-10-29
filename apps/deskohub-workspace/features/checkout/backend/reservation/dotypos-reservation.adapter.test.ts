import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { checkoutDetailsSchema } from "@/features/checkout/schemas/checkout-details";
import { createWorkspaceDotyposReservation } from "./dotypos-reservation.adapter";
import {
  type IWorkspaceTableAssignmentService,
  WorkspaceTableAssignmentService,
} from "./workspace-table-assignment.service";

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

const makeMeetingRoomCheckoutDetails = (earlySetup: boolean) =>
  Schema.decodeUnknownSync(checkoutDetailsSchema)({
    locale: "en-US",
    reservation: {
      kind: "meeting-room",
      duration: { unit: "hour", amount: 1 },
      reservationDate: "2099-06-10",
      startsAt: "2099-06-10T08:00:00Z",
      endsAt: "2099-06-10T09:00:00Z",
      ...(earlySetup && { earlySetup: true }),
    },
    payment: {
      expectedPrice: { value: 35_000, exponent: 2, currency: "CZK" },
      undiscountedPrice: { value: 35_000, exponent: 2, currency: "CZK" },
      discounts: [],
      items: [
        {
          type: "meeting-room",
          duration: { unit: "hour", amount: 1 },
          amount: { value: 35_000, exponent: 2, currency: "CZK" },
        },
      ],
    },
    legal: {},
  });

const createMeetingRoomDotyposInput = async (earlySetup: boolean) => {
  const reservation = {
    kind: "meeting-room" as const,
    duration: { unit: "hour" as const, amount: 1 as const },
    reservationDate: "2099-06-10",
    startsAt: "2099-06-10T08:00:00Z",
    endsAt: "2099-06-10T09:00:00Z",
    ...(earlySetup && { earlySetup: true }),
  };
  const assignTableId = mock(() => Effect.succeed("meeting-room-id"));
  const createReservation = mock(() =>
    Effect.succeed({ id: "dotypos-reservation-id" } as never)
  );
  const testLayer = Layer.mergeAll(
    Layer.mock(WorkspaceTableAssignmentService, {
      assignTableId,
    } satisfies IWorkspaceTableAssignmentService),
    Layer.mock(DotyposService, { createReservation })
  );

  await createWorkspaceDotyposReservation({
    paymentOrderId: "payment-order-id",
    dotyposCustomerId: "dotypos-customer-id",
    checkoutDetails: makeMeetingRoomCheckoutDetails(earlySetup),
    reservation,
    status: "NEW",
  }).pipe(Effect.provide(testLayer), Effect.runPromise);

  return createReservation.mock.calls[0]![0];
};

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

  test("creates an early-setup meeting-room reservation from 15 minutes before its start", async () => {
    const input = await createMeetingRoomDotyposInput(true);

    expect(input.startDate).toEqual(new Date("2099-06-10T07:45:00Z"));
    expect(input.endDate).toEqual(new Date("2099-06-10T09:00:00Z"));
    expect(
      input.note.split("\n").some((line) => line.startsWith("Setup from:"))
    ).toBe(true);
  });

  test("keeps a meeting-room reservation start unchanged without early setup", async () => {
    const input = await createMeetingRoomDotyposInput(false);

    expect(input.startDate).toEqual(new Date("2099-06-10T08:00:00Z"));
    expect(input.endDate).toEqual(new Date("2099-06-10T09:00:00Z"));
    expect(
      input.note.split("\n").some((line) => line.startsWith("Setup from:"))
    ).toBe(false);
  });
});
