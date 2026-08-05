import type {
  ExternalAPIError,
  NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import {
  isReservationSupersedable,
  type SupersedableReservation,
} from "@/features/reservation/backend/reservation-supersession";
import type { WorkspaceReservationDetailsMalformedError } from "@/features/reservation/backend/workspace-reservation.repository";
import { PayableReservationService } from "./payable-reservation.service";

type ReservationSupersessionError =
  | EffectDrizzleQueryError
  | WorkspaceReservationDetailsMalformedError
  | ExternalAPIError
  | NetworkError
  | ValidationError;

interface IReservationSupersessionService {
  readonly findCurrent: (input: {
    readonly orderId: string;
    readonly checkoutSessionId?: string;
  }) => Effect.Effect<
    SupersedableReservation | undefined,
    ReservationSupersessionError
  >;
}

export class ReservationSupersessionService extends Context.Service<
  ReservationSupersessionService,
  IReservationSupersessionService
>()("ReservationSupersessionService") {
  static Live = Layer.effect(
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

  static LiveWithDependencies = this.Live.pipe(
    Layer.provide(PayableReservationService.LiveWithDependencies)
  );
}
