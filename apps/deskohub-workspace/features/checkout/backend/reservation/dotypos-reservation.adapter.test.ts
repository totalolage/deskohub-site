import { describe, expect, mock, test } from "bun:test";
import {
  type CreateDotyposReservationInput,
  DotyposService,
  type Reservation,
} from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import type { CheckoutDetailsJson } from "@/features/checkout/types/checkout-details";
import { createWorkspaceDotyposReservation } from "./dotypos-reservation.adapter";
import { WorkspaceTableAssignmentService } from "./workspace-table-assignment.service";

describe("createWorkspaceDotyposReservation", () => {
  test("localizes the product name in the Dotypos reservation note", async () => {
    let reservationInput: CreateDotyposReservationInput | undefined;
    const checkoutDetails = {
      schema: "workspace-checkout-details",
      schemaVersion: 1,
      locale: "cs-CZ",
      reservation: {
        _tag: "meeting-room",
        startsAt: "2026-07-15T08:00:00Z",
        endsAt: "2026-07-15T09:00:00Z",
      },
      payment: {
        expectedPrice: { value: 30_000, exponent: 2, currency: "CZK" },
        summary: {
          sections: [],
          total: { value: 30_000, exponent: 2, currency: "CZK" },
        },
      },
      legal: {},
      fulfillment: { accessCodePolicy: "workspace-static-v1" },
    } satisfies CheckoutDetailsJson;

    await createWorkspaceDotyposReservation({
      paymentOrderId: "order-1",
      dotyposCustomerId: "customer-1",
      checkoutDetails,
      status: "NEW",
    }).pipe(
      Effect.provide(
        Layer.succeed(DotyposService, {
          createReservation: mock((input: CreateDotyposReservationInput) => {
            reservationInput = input;
            return Effect.succeed({ id: "reservation-1" } as Reservation);
          }),
        } as never)
      ),
      Effect.provide(
        Layer.succeed(
          WorkspaceTableAssignmentService,
          WorkspaceTableAssignmentService.of({
            assignTableId: mock(() => Effect.succeed("meeting-room-table")),
          })
        )
      ),
      Effect.runPromise
    );

    expect(reservationInput?.note).toContain("Product: Zasedací místnost");
  });
});
