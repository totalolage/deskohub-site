import { DotyposService } from "@deskohub/dotypos";
import { StandaloneEmailServiceLayer } from "@deskohub/email/backend/standalone-email-service";
import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database-live.server";
import { WorkspaceCheckoutNetworkDetailsService } from "@/features/checkout/backend/fulfillment/network-details.service";
import { WorkspaceReservationEmailService } from "@/features/checkout/backend/fulfillment/workspace-reservation-email.service";
import { SeatingMapFeatureFlagService } from "@/features/feature-flags/backend";
import { WorkspaceFeatureFlagServiceLive } from "@/features/feature-flags/backend/workspace-feature-flag.server";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { WorkspaceReservationService } from "@/features/reservation/backend/workspace-reservation.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import { canCancelReservation } from "./reservation-status";

export type ReservationCancellationResult = {
  readonly outcome: "cancelled" | "already_cancelled";
  readonly email: "not_requested" | "sent" | "failed";
};

export class ReservationAdministrationError extends Data.TaggedError(
  "ReservationAdministrationError"
)<{
  readonly code: "not_found" | "not_cancellable" | "cancellation_failed";
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface IReservationAdministrationService {
  readonly cancel: (input: {
    readonly reservationId: WorkspaceReservationId;
    readonly sendCancellationEmail: boolean;
  }) => Effect.Effect<
    ReservationCancellationResult,
    ReservationAdministrationError
  >;
}

export class ReservationAdministrationService extends Context.Service<
  ReservationAdministrationService,
  IReservationAdministrationService
>()("@deskohub-workspace/administration/ReservationAdministrationService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;
      const emails = yield* WorkspaceReservationEmailService;
      const reservations = yield* WorkspaceReservationRepository;
      const reservationDetails = yield* WorkspaceReservationService;

      return {
        cancel: Effect.fn("ReservationAdministrationService.cancel")(
          function* (input) {
            const current = yield* reservations
              .findById(input.reservationId)
              .pipe(
                Effect.mapError((cause) =>
                  cancellationFailed(
                    "The reservation could not be loaded.",
                    cause
                  )
                )
              );
            if (!current) {
              return yield* new ReservationAdministrationError({
                code: "not_found",
                message: "The reservation was not found.",
              });
            }
            if (current.reservationState === "cancelled") {
              return {
                outcome: "already_cancelled",
                email: yield* sendCancellationEmail({
                  input,
                  reservationDetails,
                  emails,
                }),
              };
            }
            if (!canCancelReservation(current)) {
              return yield* new ReservationAdministrationError({
                code: "not_cancellable",
                message:
                  current.fulfillmentState === "processing"
                    ? "The reservation is being confirmed. Try again after confirmation finishes."
                    : "The reservation cannot be cancelled in its current state.",
              });
            }

            const details = yield* reservationDetails
              .getReservation(current.id)
              .pipe(
                Effect.mapError((cause) =>
                  cancellationFailed(
                    "The current reservation details could not be loaded.",
                    cause
                  )
                )
              );
            const claimed = yield* reservations
              .claimAdministrationCancellation(current.id)
              .pipe(
                Effect.mapError((cause) =>
                  cancellationFailed(
                    "The reservation could not be claimed for cancellation.",
                    cause
                  )
                )
              );
            if (!claimed) {
              return yield* new ReservationAdministrationError({
                code: "not_cancellable",
                message:
                  "The reservation changed while cancellation was starting. Refresh and try again.",
              });
            }

            if (details.providerStatus !== "CANCELLED") {
              yield* dotypos
                .cancelReservation(details.dotyposReservationId)
                .pipe(
                  Effect.tapError(() =>
                    reservations
                      .markAdministrationCancellationFailed({
                        id: claimed.id,
                        failureCode: "admin_dotypos_cancel_failed",
                      })
                      .pipe(Effect.ignore)
                  ),
                  Effect.mapError((cause) =>
                    cancellationFailed(
                      "Dotypos could not cancel the reservation.",
                      cause
                    )
                  )
                );
            }

            yield* reservations
              .markAdministrationCancelled({
                id: claimed.id,
                cancelledAt: Temporal.Now.instant(),
              })
              .pipe(
                Effect.tapError(() =>
                  reservations
                    .markAdministrationCancellationFailed({
                      id: claimed.id,
                      failureCode: "admin_local_cancel_failed",
                    })
                    .pipe(Effect.ignore)
                ),
                Effect.mapError((cause) =>
                  cancellationFailed(
                    "The completed cancellation could not be recorded.",
                    cause
                  )
                )
              );

            return {
              outcome: "cancelled",
              email: yield* sendLoadedCancellationEmail({
                send: input.sendCancellationEmail,
                details,
                emails,
              }),
            };
          }
        ),
      } satisfies IReservationAdministrationService;
    })
  );

  static LiveWithDependencies = this.Live.pipe(
    Layer.provide(
      Layer.provideMerge(
        WorkspaceReservationEmailService.Live,
        Layer.provideMerge(
          Layer.provideMerge(StandaloneEmailServiceLayer, EmailConfigLayer),
          WorkspaceCheckoutNetworkDetailsService.Live
        )
      )
    ),
    Layer.provide(WorkspaceReservationService.Live),
    Layer.provide(WorkspaceReservationRepositoryLive),
    Layer.provide(WorkspaceDatabaseLive),
    Layer.provide(DotyposServiceLive),
    Layer.provide(
      SeatingMapFeatureFlagService.Live.pipe(
        Layer.provide(WorkspaceFeatureFlagServiceLive)
      )
    )
  );
}

const sendCancellationEmail = ({
  emails,
  input,
  reservationDetails,
}: {
  readonly emails: IWorkspaceReservationEmailService;
  readonly input: {
    readonly reservationId: WorkspaceReservationId;
    readonly sendCancellationEmail: boolean;
  };
  readonly reservationDetails: IWorkspaceReservationService;
}) =>
  input.sendCancellationEmail
    ? reservationDetails.getReservation(input.reservationId).pipe(
        Effect.flatMap((details) =>
          sendLoadedCancellationEmail({ send: true, details, emails })
        ),
        Effect.orElseSucceed(() => "failed" as const)
      )
    : Effect.succeed("not_requested" as const);

type IWorkspaceReservationEmailService =
  WorkspaceReservationEmailService["Service"];
type IWorkspaceReservationService = WorkspaceReservationService["Service"];

const sendLoadedCancellationEmail = ({
  details,
  emails,
  send,
}: {
  readonly details: Parameters<
    IWorkspaceReservationEmailService["sendCancellationEmail"]
  >[0]["reservation"];
  readonly emails: IWorkspaceReservationEmailService;
  readonly send: boolean;
}) =>
  send
    ? emails.sendCancellationEmail({ reservation: details }).pipe(
        Effect.as("sent" as const),
        Effect.orElseSucceed(() => "failed" as const)
      )
    : Effect.succeed("not_requested" as const);

const cancellationFailed = (message: string, cause: unknown) =>
  new ReservationAdministrationError({
    code: "cancellation_failed",
    message,
    cause,
  });
