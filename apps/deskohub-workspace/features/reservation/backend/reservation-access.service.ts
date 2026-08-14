import { DotyposService } from "@deskohub/dotypos";
import { Context, Effect, Layer, Result, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceCheckoutAccessCodeService } from "@/features/checkout/backend/reservation/access-code.service";
import type { Locale } from "@/features/i18n";
import { openReservationAccessToken } from "@/features/reservation/backend/reservation-access-token";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { getDotyposReservationTiming } from "@/features/reservation/backend/workspace-reservation.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { ReservationAccessToken } from "@/features/reservation/reservation-access-token";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";

export type ReservationAccessViewModel =
  | {
      readonly state: "available";
      readonly code: string;
      readonly accessStartsAt: Temporal.Instant;
      readonly accessEndsAt: Temporal.Instant;
    }
  | { readonly state: "unavailable" };

export interface IReservationAccessService {
  readonly getAccess: (input: {
    readonly orderId: WorkspaceReservationId;
    readonly locale: Locale;
    readonly accessToken?: ReservationAccessToken;
  }) => Effect.Effect<ReservationAccessViewModel>;
}

const unavailableAccess: ReservationAccessViewModel = {
  state: "unavailable",
};
const implementation = Effect.gen(function* () {
  const reservations = yield* WorkspaceReservationRepository;
  const dotypos = yield* DotyposService;
  const accessCodes = yield* WorkspaceCheckoutAccessCodeService;

  const getAccess = Effect.fn("ReservationAccessService.getAccess")(
    function* (input: {
      readonly orderId: WorkspaceReservationId;
      readonly locale: Locale;
      readonly accessToken?: ReservationAccessToken;
    }) {
      const authorized = yield* authorizeAccess(input);
      if (!authorized) return unavailableAccess;

      const reservation = yield* reservations.findById(input.orderId).pipe(
        Effect.tapError(() =>
          Effect.logWarning("Reservation access lookup failed")
        ),
        Effect.orElseSucceed(() => undefined)
      );
      if (!reservation || reservation.locale !== input.locale) {
        return unavailableAccess;
      }
      if (
        reservation.paymentState !== "paid" ||
        reservation.reservationState !== "confirmed" ||
        !reservation.dotyposReservationId
      ) {
        return unavailableAccess;
      }

      const providerReservation = yield* dotypos
        .getReservation(reservation.dotyposReservationId)
        .pipe(
          Effect.tapError(() =>
            Effect.logWarning("Reservation access provider lookup failed")
          ),
          Effect.orElseSucceed(() => undefined)
        );
      if (
        !providerReservation ||
        providerReservation.reservation.status !== "CONFIRMED"
      ) {
        return unavailableAccess;
      }

      const timing = yield* getDotyposReservationTiming({
        reservationId: reservation.id,
        reservation: providerReservation.reservation,
      }).pipe(
        Effect.tapError(() =>
          Effect.logWarning("Reservation access timing is invalid")
        ),
        Effect.orElseSucceed(() => undefined)
      );
      if (!timing) return unavailableAccess;

      return yield* accessCodes
        .resolveCustomerAccessCode({
          reservationId: reservation.id,
          dotyposReservationId: reservation.dotyposReservationId,
          ...timing,
        })
        .pipe(
          Effect.flatMap((access) =>
            Schema.decodeUnknownEffect(Schema.NonEmptyString)(access.code).pipe(
              Effect.map(
                (code): ReservationAccessViewModel => ({
                  state: "available",
                  code,
                  accessStartsAt: access.accessStartsAt,
                  accessEndsAt: access.accessEndsAt,
                })
              )
            )
          ),
          Effect.tapError(() =>
            Effect.logError("Reservation access code resolution failed")
          ),
          Effect.orElseSucceed(() => unavailableAccess)
        );
    },
    (effect, input) =>
      effect.pipe(
        Effect.annotateLogs({
          orderId: input.orderId,
          locale: input.locale,
          hasAccessToken: input.accessToken !== undefined,
        })
      )
  );

  return { getAccess };
});

export class ReservationAccessService extends Context.Service<
  ReservationAccessService,
  IReservationAccessService
>()("@deskohub-workspace/reservation/ReservationAccessService") {
  static Default = Layer.effect(this, implementation);

  static Live = this.Default.pipe(
    Layer.provide(WorkspaceReservationRepository.Default),
    Layer.provide(WorkspaceDatabase.Default),
    Layer.provide(WorkspaceDotyposLayer),
    Layer.provide(WorkspaceCheckoutAccessCodeService.Live)
  );
}

const authorizeAccess = Effect.fn("ReservationAccessService.authorizeAccess")(
  function* (input: {
    readonly orderId: WorkspaceReservationId;
    readonly locale: Locale;
    readonly accessToken?: ReservationAccessToken;
  }) {
    if (!input.accessToken) return false;

    const result = yield* openReservationAccessToken({
      token: input.accessToken,
      orderId: input.orderId,
      locale: input.locale,
    }).pipe(Effect.result);
    if (Result.isFailure(result)) {
      yield* Effect.logWarning("Reservation access token rejected", {
        code: result.failure.code,
      });
    }
    return Result.isSuccess(result);
  }
);
