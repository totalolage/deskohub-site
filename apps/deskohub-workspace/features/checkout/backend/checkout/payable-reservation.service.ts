import { type DotyposReadFailure, DotyposService } from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer } from "effect";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationDetailsMalformedError } from "@/features/reservation/backend/stored-reservation-details.server";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import type { SealedStateTokenError } from "@/shared/backend/sealed-state";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { deriveCheckoutSessionKeys } from "./checkout-lookup-keys.server";

export class PayableReservationUnavailableError extends Data.TaggedError(
  "PayableReservationUnavailableError"
)<{
  readonly orderId: WorkspaceReservationId;
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
    readonly orderId: WorkspaceReservationId;
    readonly checkoutSessionId?: CheckoutSessionId;
  }) => Effect.Effect<
    WorkspaceReservation,
    | PayableReservationUnavailableError
    | SealedStateTokenError
    | EffectDrizzleQueryError
    | WorkspaceReservationDetailsMalformedError
    | DotyposReadFailure
  >;
}

export class PayableReservationService extends Context.Service<
  PayableReservationService,
  IPayableReservationService
>()("PayableReservationService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const reservations = yield* WorkspaceReservationRepository;
      const dotypos = yield* DotyposService;
      const sealedStateKeys = yield* SealedStateKeys;

      /** The order, when it is the current reservation of this checkout session. */
      const findSessionReservation = Effect.fnUntraced(function* (input: {
        readonly orderId: WorkspaceReservationId;
        readonly checkoutSessionId: CheckoutSessionId;
      }) {
        const checkoutSessionKeys = yield* deriveCheckoutSessionKeys(
          input.checkoutSessionId
        ).pipe(Effect.provideService(SealedStateKeys, sealedStateKeys));
        const reservation = yield* reservations.findById(input.orderId);
        if (!reservation) {
          return yield* unavailable(input, "missing_reservation");
        }
        if (
          !checkoutSessionKeys.accepted.includes(reservation.checkoutSessionKey)
        ) {
          return yield* unavailable(input, "not_current");
        }

        const current = yield* reservations.findCurrentByCheckoutSessionKey(
          reservation.checkoutSessionKey
        );
        if (current?.id !== reservation.id) {
          return yield* unavailable(input, "not_current");
        }
        return reservation;
      });

      return PayableReservationService.of({
        requireCurrent: Effect.fn("payableReservation.requireCurrent")(
          function* (input) {
            if (!input.checkoutSessionId) {
              return yield* unavailable(input, "missing_checkout_session");
            }

            const reservation = yield* findSessionReservation({
              orderId: input.orderId,
              checkoutSessionId: input.checkoutSessionId,
            });

            const holdRefusal = getHoldRefusal(reservation);
            if (holdRefusal) return yield* unavailable(input, holdRefusal);

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

  static Live = this.Default.pipe(
    Layer.provide(WorkspaceReservationRepository.Live),
    Layer.provide(WorkspaceDotyposLayer),
    Layer.provide(SealedStateKeys.Default)
  );
}

const unavailable = (
  input: { readonly orderId: WorkspaceReservationId },
  reason: PayableReservationUnavailableError["reason"]
) =>
  new PayableReservationUnavailableError({
    orderId: input.orderId,
    reason,
  });

/** Why the reservation no longer holds its booking, if it doesn't. */
const getHoldRefusal = (
  reservation: Pick<
    WorkspaceReservation,
    "reservationState" | "reservationHoldExpiresAt"
  >
): PayableReservationUnavailableError["reason"] | undefined => {
  if (reservation.reservationState !== "held") return "not_held";
  if (
    reservation.reservationHoldExpiresAt &&
    Temporal.Instant.compare(
      reservation.reservationHoldExpiresAt,
      Temporal.Now.instant()
    ) <= 0
  ) {
    return "expired";
  }
  return undefined;
};
