import { DotyposService } from "@deskohub/dotypos";
import { Clock, Context, Effect, Layer, Result, Schema } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database-live.server";
import {
  WorkspaceCheckoutAccessCodeService,
  WorkspaceCheckoutAccessCodeServiceLive,
} from "@/features/checkout/backend/reservation/access-code.service";
import type { Locale } from "@/features/i18n";
import { openReservationAccessToken } from "@/features/reservation/backend/reservation-access-token";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { getDotyposReservationTiming } from "@/features/reservation/backend/workspace-reservation.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { getReservationAccessCodeWindowState } from "@/features/reservation/reservation-access-code";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";

export type ReservationAccessViewModel =
  | {
      readonly state: "upcoming";
      readonly availableAt: Temporal.Instant;
      readonly unavailableAt: Temporal.Instant;
    }
  | {
      readonly state: "available";
      readonly code: string;
      readonly unavailableAt: Temporal.Instant;
    }
  | { readonly state: "ended" }
  | { readonly state: "unavailable" };

export interface IReservationAccessService {
  readonly getAccess: (input: {
    readonly orderId: WorkspaceReservationId;
    readonly locale: Locale;
    readonly accessToken?: string;
  }) => Effect.Effect<ReservationAccessViewModel>;
}

const unavailableAccess: ReservationAccessViewModel = {
  state: "unavailable",
};
const endedAccess: ReservationAccessViewModel = { state: "ended" };

const implementation = Effect.gen(function* () {
  const reservations = yield* WorkspaceReservationRepository;
  const dotypos = yield* DotyposService;
  const accessCodes = yield* WorkspaceCheckoutAccessCodeService;

  const getAccess = Effect.fn("ReservationAccessService.getAccess")(
    function* (input: {
      readonly orderId: WorkspaceReservationId;
      readonly locale: Locale;
      readonly accessToken?: string;
    }) {
      const now = Temporal.Instant.fromEpochMilliseconds(
        yield* Clock.currentTimeMillis
      );
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

      const window = getReservationAccessCodeWindowState({ ...timing, now });
      if (window.state === "before-window") {
        return {
          state: "upcoming",
          availableAt: window.opensAt,
          unavailableAt: window.closesAt,
        } satisfies ReservationAccessViewModel;
      }
      if (window.state === "after-window") return endedAccess;

      return yield* accessCodes
        .resolveCustomerAccessCode({
          reservationId: reservation.id,
          dotyposReservationId: reservation.dotyposReservationId,
          ...timing,
        })
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.NonEmptyString)),
          Effect.map(
            (code): ReservationAccessViewModel => ({
              state: "available",
              code,
              unavailableAt: window.closesAt,
            })
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
  static Live = Layer.effect(this, implementation);

  static LiveWithDependencies = this.Live.pipe(
    Layer.provide(WorkspaceReservationRepositoryLive),
    Layer.provide(WorkspaceDatabaseLive),
    Layer.provide(DotyposServiceLive),
    Layer.provide(WorkspaceCheckoutAccessCodeServiceLive)
  );
}

const authorizeAccess = Effect.fn("ReservationAccessService.authorizeAccess")(
  function* (input: {
    readonly orderId: WorkspaceReservationId;
    readonly locale: Locale;
    readonly accessToken?: string;
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
