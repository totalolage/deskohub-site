import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { WorkspaceCheckoutAccessCodeService } from "@/features/checkout/backend/reservation/access-code.service";
import { ReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";

mock.module("server-only", () => ({}));

const orderId = workspaceReservationIdSchema.make(
  "reservation-access-deadline"
);

test("renders the unavailable state within 8 seconds when Dotypos hangs", async () => {
  const { ReservationAccessService } = await import(
    "./reservation-access.service"
  );
  const getReservation = mock(() => Effect.never);
  const resolveCustomerAccessCode = mock(() => Effect.never);

  const { access, completedWithinDeadline } = await Effect.gen(function* () {
    const service = yield* ReservationAccessService;
    const fiber = yield* Effect.forkChild(
      service.getAccess({ orderId, locale: "en-US" })
    );
    yield* TestClock.adjust("8 seconds");
    const completedWithinDeadline = fiber.pollUnsafe() !== undefined;
    yield* Fiber.interrupt(fiber);
    return {
      access: completedWithinDeadline ? yield* Fiber.join(fiber) : undefined,
      completedWithinDeadline,
    };
  }).pipe(
    Effect.provide(ReservationAccessService.Default),
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ReservationAuthorizationService, {
          isAuthorized: () => Effect.succeed(true),
        }),
        Layer.mock(WorkspaceReservationRepository, {
          findById: () =>
            Effect.succeed({
              id: orderId,
              paymentState: "paid",
              reservationState: "confirmed",
              dotyposReservationId: "provider-reservation-id",
            } as never),
        }),
        Layer.mock(DotyposService, { getReservation }),
        Layer.mock(WorkspaceCheckoutAccessCodeService, {
          resolveCustomerAccessCode,
        }),
        TestClock.layer()
      )
    ),
    Effect.runPromise
  );

  expect(completedWithinDeadline).toBe(true);
  expect(access).toEqual({ state: "unavailable", reason: "lookup-failed" });
  expect(getReservation).toHaveBeenCalledTimes(1);
  expect(resolveCustomerAccessCode).not.toHaveBeenCalled();
});
