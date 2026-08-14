import { Context, Effect, Layer } from "effect";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  type ReservationAccessIssuanceError,
  ReservationAccessService as ReservationAccessProvisioningService,
} from "@/features/reservation-access";

export interface IWorkspaceCheckoutAccessCodeService {
  readonly resolveCustomerAccessCode: (input: {
    readonly reservationId: WorkspaceReservationId;
    readonly dotyposReservationId: string;
    readonly reservedFrom: Temporal.Instant;
    readonly reservedUntil: Temporal.Instant;
  }) => Effect.Effect<
    {
      readonly code: string;
      readonly accessStartsAt: Temporal.Instant;
      readonly accessEndsAt: Temporal.Instant;
    },
    ReservationAccessIssuanceError
  >;
}

export class WorkspaceCheckoutAccessCodeService extends Context.Service<
  WorkspaceCheckoutAccessCodeService,
  IWorkspaceCheckoutAccessCodeService
>()("WorkspaceCheckoutAccessCodeService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const reservationAccess = yield* ReservationAccessProvisioningService;

      return WorkspaceCheckoutAccessCodeService.of({
        resolveCustomerAccessCode: Effect.fn(
          "WorkspaceCheckoutAccessCodeService.resolveCustomerAccessCode"
        )(function* (input) {
          const issued = yield* reservationAccess.issueForReservation({
            reservationId: input.reservationId,
            reservedFrom: input.reservedFrom,
            reservedUntil: input.reservedUntil,
          });
          return {
            code: issued.accessCode,
            accessStartsAt: issued.accessStartsAt,
            accessEndsAt: issued.accessEndsAt,
          };
        }),
      });
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(ReservationAccessProvisioningService.Live)
  );
}
