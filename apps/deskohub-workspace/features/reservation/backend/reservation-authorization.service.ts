import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Context, Effect, Layer, Result } from "effect";
import { CustomerAccountReservationOwnership } from "@/features/account";
import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { ReservationAccessToken } from "@/features/reservation/reservation-access-token";
import {
  openReservationAccessCookie,
  type ReservationAccessCookieOptions,
} from "./reservation-access-cookie";
import { openReservationAccessToken } from "./reservation-access-token";
import { WorkspaceReservationRepository } from "./workspace-reservation.repository";

export type ReservationAuthorizationInput = {
  readonly accessCookie?: string;
  readonly accessToken?: ReservationAccessToken;
  readonly locale: Locale;
  readonly orderId: WorkspaceReservationId;
};

export interface IReservationAuthorizationService {
  readonly isAuthorized: (
    input: ReservationAuthorizationInput
  ) => Effect.Effect<boolean>;
}

const capabilityIsValid = Effect.fn(
  "ReservationAuthorizationService.capabilityIsValid"
)(function* (
  input: ReservationAuthorizationInput,
  options: ReservationAccessCookieOptions = {}
) {
  if (input.accessCookie) {
    const cookie = yield* openReservationAccessCookie(
      { value: input.accessCookie, orderId: input.orderId },
      options
    ).pipe(Effect.result);
    if (Result.isSuccess(cookie)) return true;
  }

  if (input.accessToken) {
    const token = yield* openReservationAccessToken(
      {
        token: input.accessToken,
        orderId: input.orderId,
        locale: input.locale,
      },
      options
    ).pipe(Effect.result);
    if (Result.isSuccess(token)) return true;
  }

  return false;
});

export class ReservationAuthorizationService extends Context.Service<
  ReservationAuthorizationService,
  IReservationAuthorizationService
>()("@deskohub-workspace/reservation/ReservationAuthorizationService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const ownership = yield* CustomerAccountReservationOwnership;
      const reservations = yield* WorkspaceReservationRepository;

      const isAuthorized = Effect.fn(
        "ReservationAuthorizationService.isAuthorized"
      )(function* (input: ReservationAuthorizationInput) {
        if (yield* capabilityIsValid(input)) return true;

        const account = yield* ownership.resolve.pipe(Effect.result);
        if (Result.isFailure(account)) return false;

        const reservation = yield* reservations
          .findById(input.orderId)
          .pipe(Effect.result);
        if (Result.isFailure(reservation) || !reservation.success) return false;

        return (
          account.success.dotyposCustomerId ===
          (reservation.success.dotyposCustomerId as DotyposCustomerId)
        );
      });

      return { isAuthorized } satisfies IReservationAuthorizationService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CustomerAccountReservationOwnership.Live,
        WorkspaceReservationRepository.Live
      )
    )
  );
}
