import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";

test("operator cancellation cancels Dotypos, records the result, and optionally emails", async () => {
  const { WorkspaceReservationEmailService } = await import(
    "@/features/checkout/backend/fulfillment/workspace-reservation-email.service"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const { WorkspaceReservationService } = await import(
    "@/features/reservation/backend/workspace-reservation.service"
  );
  const { ReservationAdministrationService } = await import(
    "./reservation-administration.service"
  );
  const id = Schema.decodeUnknownSync(workspaceReservationIdSchema)(
    "reservation-test"
  );
  const current = {
    id,
    dotyposReservationId: "dotypos-test",
    fulfillmentState: "fulfilled",
    reservationState: "confirmed",
    updatedAt: Temporal.Now.instant(),
  } as never;
  const details = {
    id,
    dotyposReservationId: "dotypos-test",
    providerStatus: "CONFIRMED",
  } as never;
  const cancelReservation = mock(() => Effect.void);
  const markAdministrationCancelled = mock(() => Effect.void);
  const sendCancellationEmail = mock(() => Effect.void);

  const result = await Effect.gen(function* () {
    const service = yield* ReservationAdministrationService;
    return yield* service.cancel({
      reservationId: id,
      sendCancellationEmail: true,
    });
  }).pipe(
    Effect.provide(
      ReservationAdministrationService.Live.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(DotyposService, { cancelReservation }),
            Layer.mock(WorkspaceReservationEmailService, {
              sendCancellationEmail,
            }),
            Layer.mock(WorkspaceReservationRepository, {
              claimAdministrationCancellation: () => Effect.succeed(current),
              findById: () => Effect.succeed(current),
              markAdministrationCancellationFailed: () => Effect.void,
              markAdministrationCancelled,
            }),
            Layer.mock(WorkspaceReservationService, {
              getReservation: () => Effect.succeed(details),
            })
          )
        )
      )
    ),
    Effect.runPromise
  );

  expect(result).toEqual({ outcome: "cancelled", email: "sent" });
  expect(cancelReservation).toHaveBeenCalledWith("dotypos-test");
  expect(markAdministrationCancelled).toHaveBeenCalledWith({
    id,
    cancelledAt: expect.any(Temporal.Instant),
    claimedAt: current.updatedAt,
  });
  expect(sendCancellationEmail).toHaveBeenCalledWith({ reservation: details });
});

test("retrying an already-cancelled reservation does not email again", async () => {
  const { WorkspaceReservationEmailService } = await import(
    "@/features/checkout/backend/fulfillment/workspace-reservation-email.service"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const { WorkspaceReservationService } = await import(
    "@/features/reservation/backend/workspace-reservation.service"
  );
  const { ReservationAdministrationService } = await import(
    "./reservation-administration.service"
  );
  const id = Schema.decodeUnknownSync(workspaceReservationIdSchema)(
    "reservation-cancelled"
  );
  const sendCancellationEmail = mock(() => Effect.void);

  const result = await Effect.gen(function* () {
    const service = yield* ReservationAdministrationService;
    return yield* service.cancel({
      reservationId: id,
      sendCancellationEmail: true,
    });
  }).pipe(
    Effect.provide(
      ReservationAdministrationService.Live.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(DotyposService, {}),
            Layer.mock(WorkspaceReservationEmailService, {
              sendCancellationEmail,
            }),
            Layer.mock(WorkspaceReservationRepository, {
              findById: () =>
                Effect.succeed({ id, reservationState: "cancelled" } as never),
            }),
            Layer.mock(WorkspaceReservationService, {
              getReservation: () => Effect.die("details must not be loaded"),
            })
          )
        )
      )
    ),
    Effect.runPromise
  );

  expect(result).toEqual({
    outcome: "already_cancelled",
    email: "not_requested",
  });
  expect(sendCancellationEmail).not.toHaveBeenCalled();
});

test("does not adopt a pre-existing provider cancellation", async () => {
  const { WorkspaceReservationEmailService } = await import(
    "@/features/checkout/backend/fulfillment/workspace-reservation-email.service"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const { WorkspaceReservationService } = await import(
    "@/features/reservation/backend/workspace-reservation.service"
  );
  const { ReservationAdministrationError, ReservationAdministrationService } =
    await import("./reservation-administration.service");
  const id = Schema.decodeUnknownSync(workspaceReservationIdSchema)(
    "reservation-provider-cancelled"
  );
  const claimAdministrationCancellation = mock(() =>
    Effect.die("must not claim")
  );

  const result = await Effect.gen(function* () {
    const service = yield* ReservationAdministrationService;
    return yield* service.cancel({
      reservationId: id,
      sendCancellationEmail: true,
    });
  }).pipe(
    Effect.provide(
      ReservationAdministrationService.Live.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(DotyposService, {}),
            Layer.mock(WorkspaceReservationEmailService, {}),
            Layer.mock(WorkspaceReservationRepository, {
              claimAdministrationCancellation,
              findById: () =>
                Effect.succeed({
                  id,
                  dotyposReservationId: "dotypos-provider-cancelled",
                  fulfillmentState: "fulfilled",
                  paymentState: "paid",
                  reservationState: "confirmed",
                  updatedAt: Temporal.Now.instant(),
                } as never),
            }),
            Layer.mock(WorkspaceReservationService, {
              getReservation: () =>
                Effect.succeed({
                  id,
                  dotyposReservationId: "dotypos-provider-cancelled",
                  providerStatus: "CANCELLED",
                } as never),
            })
          )
        )
      )
    ),
    Effect.flip,
    Effect.runPromise
  );

  expect(result).toBeInstanceOf(ReservationAdministrationError);
  expect(result).toMatchObject({ code: "not_cancellable" });
  expect(claimAdministrationCancellation).not.toHaveBeenCalled();
});

test("resumes a stale cancellation after an interrupted request", async () => {
  const { WorkspaceReservationEmailService } = await import(
    "@/features/checkout/backend/fulfillment/workspace-reservation-email.service"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const { WorkspaceReservationService } = await import(
    "@/features/reservation/backend/workspace-reservation.service"
  );
  const { ReservationAdministrationService } = await import(
    "./reservation-administration.service"
  );
  const id = Schema.decodeUnknownSync(workspaceReservationIdSchema)(
    "reservation-interrupted"
  );
  const current = {
    id,
    dotyposReservationId: "dotypos-interrupted",
    fulfillmentState: "fulfilled",
    reservationState: "cancelling",
    updatedAt: Temporal.Now.instant().subtract({ minutes: 2 }),
  } as never;
  const details = {
    id,
    dotyposReservationId: "dotypos-interrupted",
    providerStatus: "CANCELLED",
  } as never;
  const claimAdministrationCancellation = mock(() => Effect.succeed(current));
  const markAdministrationCancelled = mock(() => Effect.void);

  const result = await Effect.gen(function* () {
    const service = yield* ReservationAdministrationService;
    return yield* service.cancel({
      reservationId: id,
      sendCancellationEmail: false,
    });
  }).pipe(
    Effect.provide(
      ReservationAdministrationService.Live.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(DotyposService, {
              cancelReservation: () => Effect.die("already cancelled"),
            }),
            Layer.mock(WorkspaceReservationEmailService, {}),
            Layer.mock(WorkspaceReservationRepository, {
              claimAdministrationCancellation,
              findById: () => Effect.succeed(current),
              markAdministrationCancellationFailed: () => Effect.void,
              markAdministrationCancelled,
            }),
            Layer.mock(WorkspaceReservationService, {
              getReservation: () => Effect.succeed(details),
            })
          )
        )
      )
    ),
    Effect.runPromise
  );

  expect(result).toEqual({ outcome: "cancelled", email: "not_requested" });
  expect(claimAdministrationCancellation).toHaveBeenCalledWith({
    id,
    staleCancellingBefore: expect.any(Temporal.Instant),
  });
  expect(markAdministrationCancelled).toHaveBeenCalledWith({
    id,
    cancelledAt: expect.any(Temporal.Instant),
    claimedAt: current.updatedAt,
  });
});

test("reconciles a duplicate provider failure after another worker cancelled", async () => {
  const { WorkspaceReservationEmailService } = await import(
    "@/features/checkout/backend/fulfillment/workspace-reservation-email.service"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const { WorkspaceReservationService } = await import(
    "@/features/reservation/backend/workspace-reservation.service"
  );
  const { ReservationAdministrationService } = await import(
    "./reservation-administration.service"
  );
  const id = Schema.decodeUnknownSync(workspaceReservationIdSchema)(
    "reservation-provider-race"
  );
  const current = {
    id,
    dotyposReservationId: "dotypos-provider-race",
    fulfillmentState: "fulfilled",
    paymentState: "paid",
    reservationState: "cancelling",
    updatedAt: Temporal.Now.instant().subtract({ minutes: 2 }),
  } as never;
  const confirmed = {
    id,
    dotyposReservationId: "dotypos-provider-race",
    providerStatus: "CONFIRMED",
  } as never;
  const cancelled = { ...confirmed, providerStatus: "CANCELLED" } as never;
  const getReservation = mock(() =>
    Effect.succeed(
      getReservation.mock.calls.length === 1 ? confirmed : cancelled
    )
  );
  const markAdministrationCancellationFailed = mock(() => Effect.void);
  const markAdministrationCancelled = mock(() => Effect.void);

  const result = await Effect.gen(function* () {
    const service = yield* ReservationAdministrationService;
    return yield* service.cancel({
      reservationId: id,
      sendCancellationEmail: false,
    });
  }).pipe(
    Effect.provide(
      ReservationAdministrationService.Live.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(DotyposService, {
              cancelReservation: () =>
                Effect.fail("already cancelled" as never),
            }),
            Layer.mock(WorkspaceReservationEmailService, {}),
            Layer.mock(WorkspaceReservationRepository, {
              claimAdministrationCancellation: () => Effect.succeed(current),
              findById: () => Effect.succeed(current),
              markAdministrationCancellationFailed,
              markAdministrationCancelled,
            }),
            Layer.mock(WorkspaceReservationService, { getReservation })
          )
        )
      )
    ),
    Effect.runPromise
  );

  expect(result).toEqual({ outcome: "cancelled", email: "not_requested" });
  expect(getReservation).toHaveBeenCalledTimes(2);
  expect(markAdministrationCancellationFailed).not.toHaveBeenCalled();
  expect(markAdministrationCancelled).toHaveBeenCalledTimes(1);
});
