import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservation } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationDetails } from "@/features/reservation/backend/workspace-reservation.service";
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
  const claimAdministrationCancellation = mock(() => Effect.succeed(current));
  const markAdministrationCancelled = mock(() => Effect.void);
  const sendCancellationEmail = mock(() => Effect.void);

  const result = await Effect.gen(function* () {
    const service = yield* ReservationAdministrationService;
    return yield* service.cancel({
      accessGrantUpdatedAt: "2026-08-10T10:00:00.000Z",
      providerCredentialRemoved: true,
      reservationId: id,
      sendCancellationEmail: true,
    });
  }).pipe(
    Effect.provide(
      ReservationAdministrationService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(DotyposService, { cancelReservation }),
            Layer.mock(WorkspaceReservationEmailService, {
              sendCancellationEmail,
            }),
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

  expect(result).toEqual({ outcome: "cancelled", email: "sent" });
  expect(cancelReservation).toHaveBeenCalledWith("dotypos-test");
  expect(markAdministrationCancelled).toHaveBeenCalledWith({
    id,
    cancelledAt: expect.any(Temporal.Instant),
    claimedAt: current.updatedAt,
    failureCode: null,
  });
  expect(claimAdministrationCancellation).toHaveBeenCalledWith({
    accessGrantUpdatedAt: "2026-08-10T10:00:00.000Z",
    id,
    providerCredentialRemoved: true,
    staleCancellingBefore: expect.any(Temporal.Instant),
  });
  expect(sendCancellationEmail).toHaveBeenCalledWith({ reservation: details });
});

test("forced operator cancellation terminalizes a pending payment before cancelling", async () => {
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
  const id = workspaceReservationIdSchema.make("reservation-pending");
  const activePaymentAttemptId = paymentAttemptIdSchema.make("payment-pending");
  const current = {
    id,
    activePaymentAttemptId,
    dotyposReservationId: "dotypos-pending",
    fulfillmentState: "not_started",
    paymentState: "pending",
    reservationState: "held",
    updatedAt: Temporal.Now.instant(),
  } as never;
  const details = {
    id,
    dotyposReservationId: "dotypos-pending",
    providerStatus: "NEW",
  } as never;
  const cancelReservation = mock(() => Effect.void);
  const markAdministrationCancelled = mock(() => Effect.void);
  const claimAdministrationCancellation = mock(() => Effect.succeed(current));

  const result = await Effect.gen(function* () {
    const service = yield* ReservationAdministrationService;
    return yield* service.cancel({
      accessGrantUpdatedAt: null,
      force: true,
      providerCredentialRemoved: false,
      reservationId: id,
      sendCancellationEmail: false,
    });
  }).pipe(
    Effect.provide(
      ReservationAdministrationService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(DotyposService, { cancelReservation }),
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
    accessGrantUpdatedAt: null,
    id,
    pendingPaymentCancellation: {
      paymentAttemptId: activePaymentAttemptId,
      failureCode: "admin_forced_payment_cancellation",
    },
    providerCredentialRemoved: false,
    staleCancellingBefore: expect.any(Temporal.Instant),
  });
  expect(cancelReservation).toHaveBeenCalledWith("dotypos-pending");
  expect(markAdministrationCancelled).toHaveBeenCalledWith({
    id,
    cancelledAt: expect.any(Temporal.Instant),
    claimedAt: current.updatedAt,
    failureCode: "admin_forced_payment_cancellation",
  });
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
      accessGrantUpdatedAt: null,
      providerCredentialRemoved: false,
      reservationId: id,
      sendCancellationEmail: true,
    });
  }).pipe(
    Effect.provide(
      ReservationAdministrationService.Default.pipe(
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

test("refuses cancellation while the confirmation email is still delivering", async () => {
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
    "reservation-awaiting-delivery"
  );
  const cancelReservation = mock(() =>
    Effect.die("awaiting delivery must not cancel at the provider")
  );
  const claimAdministrationCancellation = mock(() =>
    Effect.die("awaiting delivery must not claim cancellation")
  );

  const result = await Effect.gen(function* () {
    const service = yield* ReservationAdministrationService;
    return yield* service.cancel({
      accessGrantUpdatedAt: null,
      providerCredentialRemoved: false,
      reservationId: id,
      sendCancellationEmail: true,
    });
  }).pipe(
    Effect.provide(
      ReservationAdministrationService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(DotyposService, { cancelReservation }),
            Layer.mock(WorkspaceReservationEmailService, {}),
            Layer.mock(WorkspaceReservationRepository, {
              claimAdministrationCancellation,
              findById: () =>
                Effect.succeed({
                  id,
                  dotyposReservationId: "dotypos-awaiting-delivery",
                  fulfillmentState: "awaiting_delivery",
                  paymentState: "paid",
                  reservationState: "confirmed",
                  updatedAt: Temporal.Now.instant(),
                } as never),
            }),
            Layer.mock(WorkspaceReservationService, {
              getReservation: () => Effect.die("details must not be loaded"),
            })
          )
        )
      )
    ),
    Effect.flip,
    Effect.runPromise
  );

  expect(result).toBeInstanceOf(ReservationAdministrationError);
  expect(result).toMatchObject({
    code: "not_cancellable",
    reason: "delivery_in_progress",
    message:
      "The confirmation email is still being delivered. Try again after delivery completes.",
  });
  expect(cancelReservation).not.toHaveBeenCalled();
  expect(claimAdministrationCancellation).not.toHaveBeenCalled();
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
      accessGrantUpdatedAt: null,
      providerCredentialRemoved: false,
      reservationId: id,
      sendCancellationEmail: true,
    });
  }).pipe(
    Effect.provide(
      ReservationAdministrationService.Default.pipe(
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
  expect(result).toMatchObject({
    code: "not_cancellable",
    reason: "cancelled_in_dotypos",
  });
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
      accessGrantUpdatedAt: null,
      providerCredentialRemoved: false,
      reservationId: id,
      sendCancellationEmail: false,
    });
  }).pipe(
    Effect.provide(
      ReservationAdministrationService.Default.pipe(
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
    accessGrantUpdatedAt: null,
    id,
    providerCredentialRemoved: false,
    staleCancellingBefore: expect.any(Temporal.Instant),
  });
  expect(markAdministrationCancelled).toHaveBeenCalledWith({
    id,
    cancelledAt: expect.any(Temporal.Instant),
    claimedAt: current.updatedAt,
    failureCode: null,
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
      accessGrantUpdatedAt: null,
      providerCredentialRemoved: false,
      reservationId: id,
      sendCancellationEmail: false,
    });
  }).pipe(
    Effect.provide(
      ReservationAdministrationService.Default.pipe(
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

const cancelWith = async ({
  current,
  details = { providerStatus: "CONFIRMED" },
  findById = () => Effect.succeed(current),
  getReservation = () =>
    Effect.succeed({
      id: "reservation-refusal",
      dotyposReservationId: "dotypos-refusal",
      ...details,
    }),
  claimAdministrationCancellation = () => Effect.succeed(current),
  cancelReservation = () => Effect.void,
  markAdministrationCancelled = () => Effect.void,
  markAdministrationCancellationFailed = () => Effect.void,
  force,
}: {
  readonly current: Partial<WorkspaceReservation> | null;
  readonly details?: Partial<WorkspaceReservationDetails>;
  readonly findById?: () => Effect.Effect<unknown, unknown>;
  readonly getReservation?: () => Effect.Effect<unknown, unknown>;
  readonly claimAdministrationCancellation?: () => Effect.Effect<
    unknown,
    unknown
  >;
  readonly cancelReservation?: () => Effect.Effect<void, unknown>;
  readonly markAdministrationCancelled?: () => Effect.Effect<void, unknown>;
  readonly markAdministrationCancellationFailed?: () => Effect.Effect<
    void,
    unknown
  >;
  readonly force?: boolean;
}) => {
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
  return Effect.gen(function* () {
    const service = yield* ReservationAdministrationService;
    return yield* service.cancel({
      accessGrantUpdatedAt: null,
      ...(force !== undefined && { force }),
      providerCredentialRemoved: false,
      reservationId: workspaceReservationIdSchema.make("reservation-refusal"),
      sendCancellationEmail: false,
    });
  }).pipe(
    Effect.provide(
      ReservationAdministrationService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(DotyposService, { cancelReservation } as never),
            Layer.mock(WorkspaceReservationEmailService, {}),
            Layer.mock(WorkspaceReservationRepository, {
              claimAdministrationCancellation,
              findById,
              markAdministrationCancellationFailed,
              markAdministrationCancelled,
            } as never),
            Layer.mock(WorkspaceReservationService, {
              getReservation,
            } as never)
          )
        )
      )
    ),
    Effect.flip,
    Effect.runPromise
  );
};

const cancellableReservation = {
  id: workspaceReservationIdSchema.make("reservation-refusal"),
  dotyposReservationId: "dotypos-refusal",
  fulfillmentState: "fulfilled",
  paymentState: "paid",
  reservationState: "confirmed",
  failureCode: null,
  activePaymentAttemptId: null,
  updatedAt: Temporal.Instant.from("2026-08-10T10:00:00Z"),
} satisfies Partial<WorkspaceReservation>;

test("explains each refusal before claiming the reservation", async () => {
  const claimAdministrationCancellation = mock(() => Effect.die("no claim"));
  const refusal = async (
    input: Omit<
      Parameters<typeof cancelWith>[0],
      "claimAdministrationCancellation"
    >
  ) => {
    const error = await cancelWith({
      ...input,
      claimAdministrationCancellation,
    });
    return { code: error.code, reason: error.reason };
  };

  expect(
    await Promise.all([
      refusal({ current: null }),
      refusal({ current: null, findById: () => Effect.fail("database down") }),
      refusal({
        current: { ...cancellableReservation, fulfillmentState: "processing" },
      }),
      refusal({
        current: { ...cancellableReservation, reservationState: "draft" },
      }),
      refusal({
        current: cancellableReservation,
        getReservation: () => Effect.fail("Dotypos down"),
      }),
      refusal({
        current: { ...cancellableReservation, paymentState: "pending" },
        force: true,
      }),
    ])
  ).toEqual([
    { code: "not_found", reason: "not_found" },
    { code: "cancellation_failed", reason: "reservation_unavailable" },
    { code: "not_cancellable", reason: "confirmation_in_progress" },
    { code: "not_cancellable", reason: "invalid_state" },
    { code: "cancellation_failed", reason: "details_unavailable" },
    { code: "not_cancellable", reason: "pending_payment" },
  ]);
  expect(claimAdministrationCancellation).not.toHaveBeenCalled();
});

test("stops without cancelling in Dotypos when the claim fails or loses a race", async () => {
  const cancelReservation = mock(() => Effect.void);

  const failed = await cancelWith({
    current: cancellableReservation,
    claimAdministrationCancellation: () => Effect.fail("lock timeout"),
    cancelReservation,
  });
  const changed = await cancelWith({
    current: cancellableReservation,
    claimAdministrationCancellation: () => Effect.succeed(null),
    cancelReservation,
  });

  expect(failed).toMatchObject({
    code: "cancellation_failed",
    reason: "claim_failed",
    cause: "lock timeout",
  });
  expect(changed).toMatchObject({ code: "not_cancellable", reason: "changed" });
  expect(cancelReservation).not.toHaveBeenCalled();
});

test("marks the claim failed when Dotypos or the local record fails", async () => {
  const markAdministrationCancelled = mock(() => Effect.void);
  const markAdministrationCancellationFailed = mock(() => Effect.void);

  const dotyposFailed = await cancelWith({
    current: cancellableReservation,
    cancelReservation: () => Effect.fail("Dotypos refused"),
    getReservation: mock()
      .mockReturnValueOnce(
        Effect.succeed({
          dotyposReservationId: "dotypos-refusal",
          providerStatus: "CONFIRMED",
        })
      )
      .mockReturnValueOnce(Effect.fail("Dotypos down")),
    markAdministrationCancelled,
    markAdministrationCancellationFailed,
  });
  expect(dotyposFailed).toMatchObject({
    code: "cancellation_failed",
    reason: "dotypos_failed",
    cause: "Dotypos refused",
  });
  expect(markAdministrationCancelled).not.toHaveBeenCalled();
  expect(markAdministrationCancellationFailed).toHaveBeenLastCalledWith({
    id: cancellableReservation.id,
    claimedAt: cancellableReservation.updatedAt,
    failureCode: "admin_dotypos_cancel_failed",
  });

  const recordFailed = await cancelWith({
    current: {
      ...cancellableReservation,
      failureCode: "admin_forced_payment_cancellation",
    },
    markAdministrationCancelled: () => Effect.fail("write conflict"),
    markAdministrationCancellationFailed,
  });
  expect(recordFailed).toMatchObject({
    code: "cancellation_failed",
    reason: "record_failed",
    cause: "write conflict",
  });
  expect(markAdministrationCancellationFailed).toHaveBeenLastCalledWith({
    id: cancellableReservation.id,
    claimedAt: cancellableReservation.updatedAt,
    failureCode: "admin_forced_payment_cancellation",
  });

  await cancelWith({
    current: cancellableReservation,
    markAdministrationCancelled: () => Effect.fail("write conflict"),
    markAdministrationCancellationFailed,
  });
  expect(markAdministrationCancellationFailed).toHaveBeenLastCalledWith({
    id: cancellableReservation.id,
    claimedAt: cancellableReservation.updatedAt,
    failureCode: "admin_local_cancel_failed",
  });
});
