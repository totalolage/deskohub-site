import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { checkoutDetailsJsonSchema } from "@/features/checkout/schemas/checkout-details";
import { instantStringSchema } from "@/shared/utils/temporal";
import { createWorkspaceDotyposReservation } from "./dotypos-reservation.adapter";
import {
  type IWorkspaceTableAssignmentService,
  WorkspaceTableAssignmentService,
} from "./workspace-table-assignment.service";

const decodeInstant = Schema.decodeUnknownSync(instantStringSchema);

const checkoutDetails = Schema.decodeUnknownSync(checkoutDetailsJsonSchema)({
  schema: "workspace-checkout-details",
  schemaVersion: 1,
  locale: "en-US",
  reservation: {
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
      Layer.succeed(WorkspaceTableAssignmentService, {
        assignTableId,
      } satisfies IWorkspaceTableAssignmentService),
      Layer.succeed(DotyposService, {
        createReservation,
      } as unknown as typeof DotyposService.Service)
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
      startsAt: decodeInstant("2099-06-10T08:00:00Z"),
      endsAt: decodeInstant("2099-06-10T12:00:00Z"),
    };
    const assignTableId = mock(() => Effect.succeed("meeting-room-table-id"));
    const createReservation = mock(() =>
      Effect.succeed({ id: "dotypos-reservation-id" } as never)
    );
    const testLayer = Layer.mergeAll(
      Layer.succeed(WorkspaceTableAssignmentService, {
        assignTableId,
      } satisfies IWorkspaceTableAssignmentService),
      Layer.succeed(DotyposService, {
        createReservation,
      } as unknown as typeof DotyposService.Service)
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
});
