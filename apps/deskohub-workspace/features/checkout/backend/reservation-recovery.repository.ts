import "server-only";

import { randomUUID } from "node:crypto";
import { Context, Data, Effect, Layer } from "effect";
import { z } from "zod/v4";
import {
  type DatabaseError,
  runDb,
  WorkspaceDatabase,
} from "@/db/database.service";
import {
  type ReservationRecoveryEvent,
  reservationRecoveryEvents,
} from "@/db/schema";

const reservationRecoveryInputSchema = z.object({
  orderId: z.string().min(1).nullable().optional(),
  reservationSubmitKey: z.string().min(1),
  dotyposCustomerId: z.string().min(1),
  dotyposReservationId: z.string().min(1),
  attemptedCancellationResult: z.string().min(1).nullable().optional(),
  cancellationAttemptedAt: z.date().nullable().optional(),
  failureReason: z.string().min(1),
});

export class ReservationRecoveryInputError extends Data.TaggedError(
  "ReservationRecoveryInputError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type ReservationRecoveryInput = z.input<
  typeof reservationRecoveryInputSchema
>;

export const parseReservationRecoveryInput = (
  input: ReservationRecoveryInput
) => {
  const parsed = reservationRecoveryInputSchema.parse(input);

  return {
    orderId: parsed.orderId ?? null,
    reservationSubmitKey: parsed.reservationSubmitKey,
    dotyposCustomerId: parsed.dotyposCustomerId,
    dotyposReservationId: parsed.dotyposReservationId,
    attemptedCancellationResult: parsed.attemptedCancellationResult ?? null,
    cancellationAttemptedAt: parsed.cancellationAttemptedAt ?? null,
    failureReason: parsed.failureReason,
  };
};

export interface ReservationRecoveryRepository {
  readonly recordAttachFailure: (
    input: ReservationRecoveryInput
  ) => Effect.Effect<
    ReservationRecoveryEvent,
    DatabaseError | ReservationRecoveryInputError
  >;
}

export const ReservationRecoveryRepository =
  Context.GenericTag<ReservationRecoveryRepository>(
    "ReservationRecoveryRepository"
  );

export const ReservationRecoveryRepositoryLive = Layer.effect(
  ReservationRecoveryRepository,
  Effect.gen(function* () {
    const { db } = yield* WorkspaceDatabase;

    return ReservationRecoveryRepository.of({
      recordAttachFailure: Effect.fn("reservationRecovery.recordAttachFailure")(
        function* (input) {
          const event = yield* Effect.try({
            try: () => parseReservationRecoveryInput(input),
            catch: (cause) =>
              new ReservationRecoveryInputError({
                message: "Reservation recovery input is invalid.",
                cause,
              }),
          });

          const [inserted] = yield* runDb(
            "reservationRecovery.recordAttachFailure",
            () =>
              db
                .insert(reservationRecoveryEvents)
                .values({ id: randomUUID(), ...event })
                .returning()
          );

          if (!inserted) {
            return yield* Effect.fail(
              new ReservationRecoveryInputError({
                message: "Reservation recovery insert returned no row.",
              })
            );
          }

          return inserted;
        },
        (effect, input) =>
          effect.pipe(
            Effect.annotateLogs({
              orderId: input.orderId ?? null,
              reservationSubmitKey: input.reservationSubmitKey,
            })
          )
      ),
    });
  })
);
