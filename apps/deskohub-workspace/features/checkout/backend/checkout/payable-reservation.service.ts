import {
  DotyposService,
  type ExternalAPIError,
  type NetworkError,
  type ValidationError,
} from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import {
  type WorkspaceReservation,
  type WorkspaceReservationDetailsMalformedError,
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { deriveCheckoutSessionKey } from "./checkout-session-key.server";

export class PayableReservationUnavailableError extends Data.TaggedError(
  "PayableReservationUnavailableError"
)<{
  readonly orderId: string;
  readonly reason:
    | "missing_checkout_session"
    | "missing_reservation"
    | "not_current"
    | "not_held"
    | "expired"
    | "missing_dotypos_reservation"
    | "dotypos_not_pending";
}> {}

interface IPayableReservationService {
  readonly requireCurrent: (input: {
    readonly orderId: string;
    readonly checkoutSessionId?: string;
  }) => Effect.Effect<
    WorkspaceReservation,
    | PayableReservationUnavailableError
    | EffectDrizzleQueryError
    | WorkspaceReservationDetailsMalformedError
    | ExternalAPIError
    | NetworkError
    | ValidationError
  >;
}

export class PayableReservationService extends Context.Service<
  PayableReservationService,
  IPayableReservationService
>()("PayableReservationService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const reservations = yield* WorkspaceReservationRepository;
      const dotypos = yield* DotyposService;

      return PayableReservationService.of({
        requireCurrent: Effect.fn("payableReservation.requireCurrent")(
          function* (input) {
            if (!input.checkoutSessionId) {
              return yield* unavailable(input, "missing_checkout_session");
            }

            const checkoutSessionKey = deriveCheckoutSessionKey(
              input.checkoutSessionId
            );
            const reservation = yield* reservations.findById(input.orderId);
            if (!reservation) {
              return yield* unavailable(input, "missing_reservation");
            }

            const current =
              yield* reservations.findCurrentByCheckoutSessionKey(
                checkoutSessionKey
              );
            if (
              reservation.checkoutSessionKey !== checkoutSessionKey ||
              current?.id !== reservation.id
            ) {
              return yield* unavailable(input, "not_current");
            }

            if (reservation.reservationState !== "held") {
              return yield* unavailable(input, "not_held");
            }

            if (
              reservation.reservationHoldExpiresAt &&
              Temporal.Instant.compare(
                reservation.reservationHoldExpiresAt,
                Temporal.Now.instant()
              ) <= 0
            ) {
              return yield* unavailable(input, "expired");
            }

            if (!reservation.dotyposReservationId) {
              return yield* unavailable(input, "missing_dotypos_reservation");
            }

            const status = yield* dotypos.getReservationStatus(
              reservation.dotyposReservationId
            );
            if (status !== "NEW") {
              return yield* unavailable(input, "dotypos_not_pending");
            }

            return reservation;
          }
        ),
      });
    })
  );

  static LiveWithDependencies = this.Live.pipe(
    Layer.provide(
      WorkspaceReservationRepositoryLive.pipe(
        Layer.provide(WorkspaceDatabaseLive)
      )
    ),
    Layer.provide(DotyposServiceLive)
  );
}

const unavailable = (
  input: { readonly orderId: string },
  reason: PayableReservationUnavailableError["reason"]
) =>
  new PayableReservationUnavailableError({
    orderId: input.orderId,
    reason,
  });
