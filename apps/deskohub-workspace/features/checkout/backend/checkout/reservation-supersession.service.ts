import type {
  ExternalAPIError,
  NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import {
  isReservationSupersedable,
  type SupersedableReservation,
} from "@/features/reservation/backend/reservation-supersession";
import type { WorkspaceReservationDetailsMalformedError } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { PayableReservationService } from "./payable-reservation.service";

type ReservationSupersessionError =
  | EffectDrizzleQueryError
  | WorkspaceReservationDetailsMalformedError
  | ExternalAPIError
  | NetworkError
  | ValidationError;

interface IReservationSupersessionService {
  readonly findCurrent: (input: {
    readonly orderId: WorkspaceReservationId;
    readonly checkoutSessionId?: CheckoutSessionId;
  }) => Effect.Effect<
    SupersedableReservation | undefined,
    ReservationSupersessionError
  >;
}

export class ReservationSupersessionService extends Context.Service<
  ReservationSupersessionService,
  IReservationSupersessionService
>()("ReservationSupersessionService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const payableReservations = yield* PayableReservationService;

      return {
        findCurrent: Effect.fn("reservationSupersession.findCurrent")((input) =>
          payableReservations.requireCurrent(input).pipe(
            Effect.map((reservation) =>
              isReservationSupersedable(reservation) ? reservation : undefined
            ),
            Effect.catchTag("PayableReservationUnavailableError", () =>
              Effect.succeed(undefined)
            )
          )
        ),
      } satisfies IReservationSupersessionService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(PayableReservationService.Live)
  );
}
