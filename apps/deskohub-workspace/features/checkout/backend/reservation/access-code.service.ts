import { Context, Effect, Layer } from "effect";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  type ReservationAccessIssuanceError,
  ReservationAccessService as ReservationAccessProvisioningService,
} from "@/features/reservation-access";

const workspaceCheckoutPlaceholderAccessCode = "7915";

export interface WorkspaceCheckoutAccessCodeService {
  readonly generateCustomerAccessCode: Effect.Effect<string>;
  readonly resolveCustomerAccessCode: (input: {
    readonly reservationId: WorkspaceReservationId;
    readonly dotyposReservationId: string;
    readonly reservedFrom: Temporal.Instant;
    readonly reservedUntil: Temporal.Instant;
  }) => Effect.Effect<string, ReservationAccessIssuanceError>;
}

export const WorkspaceCheckoutAccessCodeService =
  Context.Service<WorkspaceCheckoutAccessCodeService>(
    "WorkspaceCheckoutAccessCodeService"
  );

export const generateWorkspaceCustomerAccessCode = Effect.succeed(
  workspaceCheckoutPlaceholderAccessCode
);

export const WorkspaceCheckoutAccessCodeServiceLive = Layer.effect(
  WorkspaceCheckoutAccessCodeService,
  Effect.gen(function* () {
    const reservationAccess = yield* ReservationAccessProvisioningService;

    return WorkspaceCheckoutAccessCodeService.of({
      generateCustomerAccessCode: generateWorkspaceCustomerAccessCode,
      resolveCustomerAccessCode: Effect.fn(
        "WorkspaceCheckoutAccessCodeService.resolveCustomerAccessCode"
      )(function* (input) {
        const issued = yield* reservationAccess.issueForReservation({
          reservationId: input.reservationId,
          reservedFrom: input.reservedFrom,
          reservedUntil: input.reservedUntil,
        });
        return issued.accessCode;
      }),
    });
  })
);

export const WorkspaceCheckoutAccessCodeServiceLiveWithDependencies =
  WorkspaceCheckoutAccessCodeServiceLive.pipe(
    Layer.provide(ReservationAccessProvisioningService.LiveWithDependencies)
  );
