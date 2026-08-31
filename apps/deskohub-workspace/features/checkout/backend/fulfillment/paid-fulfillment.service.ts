import { DotyposService } from "@deskohub/dotypos";
import { EmailServiceTag } from "@deskohub/email/backend/service";
import { Context, Data, Effect, Layer, Predicate } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { env } from "@/env";
import { ReservationInvoiceService } from "@/features/accounting/backend/reservation-invoice.service";
import { WorkspaceCheckoutAccessCodeService } from "@/features/checkout/backend/reservation/access-code.service";
import {
  SeatingMapFeatureFlagService,
  WorkspaceFeatureFlagService,
} from "@/features/feature-flags/backend";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
  type WorkspaceReservationStateError,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { WorkspaceReservationService } from "@/features/reservation/backend/workspace-reservation.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { PostHogEventService } from "@/shared/backend/analytics/posthog-event.service";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import { captureReservationCompleted } from "../analytics/posthog-lifecycle-events";
import { WorkspaceCheckoutNetworkDetailsService } from "./network-details.service";
import {
  createCustomerEmailRecoveryIdempotencyKey,
  WorkspaceReservationEmailService,
} from "./workspace-reservation-email.service";

export type WorkspacePaidFulfillmentFailureCode =
  | "dotypos_reservation_failed"
  | "dotypos_reservation_unfulfillable"
  | "fulfillment_access_failed"
  | "fulfillment_email_failed"
  | "fulfillment_order_load_failed"
  | "fulfillment_claim_failed"
  | "fulfillment_completion_failed"
  | "invoice_processing_failed";

export class WorkspacePaidFulfillmentError extends Data.TaggedError(
  "WorkspacePaidFulfillmentError"
)<{
  readonly orderId: WorkspaceReservationId;
  readonly failureCode: WorkspacePaidFulfillmentFailureCode;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const PAID_FULFILLMENT_PROCESSING_RETRY_AFTER_MS = 60 * 1000;

export interface IWorkspacePaidFulfillmentService {
  readonly fulfillPaidOrder: (input: {
    readonly orderId: WorkspaceReservationId;
  }) => Effect.Effect<
    void,
    WorkspacePaidFulfillmentError | WorkspaceReservationStateError
  >;
}

export class WorkspacePaidFulfillmentService extends Context.Service<
  WorkspacePaidFulfillmentService,
  IWorkspacePaidFulfillmentService
>()("WorkspacePaidFulfillmentService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const reservations = yield* WorkspaceReservationRepository;
      const dotypos = yield* DotyposService;
      const reservationEmails = yield* WorkspaceReservationEmailService;
      const workspaceReservations = yield* WorkspaceReservationService;
      const accessCodes = yield* WorkspaceCheckoutAccessCodeService;
      const posthogEvents = yield* PostHogEventService;
      const reservationInvoices = yield* ReservationInvoiceService;

      const processReservationInvoice = Effect.fn(
        "workspacePaidFulfillment.processReservationInvoice"
      )(function* (
        reservation: Pick<WorkspaceReservation, "activePaymentAttemptId" | "id">
      ) {
        if (!reservation.activePaymentAttemptId) {
          yield* Effect.logWarning(
            "Reservation invoice processing skipped: payment attempt missing",
            { orderId: reservation.id }
          );
          return;
        }

        yield* reservationInvoices
          .processByPaymentAttemptId({
            paymentAttemptId: reservation.activePaymentAttemptId,
          })
          .pipe(
            Effect.tapError((cause) =>
              Effect.logFatal("Reservation invoice processing failed", {
                orderId: reservation.id,
                cause,
              })
            ),
            Effect.mapError(
              (cause) =>
                new WorkspacePaidFulfillmentError({
                  orderId: reservation.id,
                  failureCode: "invoice_processing_failed",
                  message: "Paid reservation invoice processing failed.",
                  cause,
                })
            )
          );
      });

      const failFulfillment = Effect.fn("workspacePaidFulfillment.fail")(
        function* (input: {
          readonly orderId: WorkspaceReservationId;
          readonly failureCode: WorkspacePaidFulfillmentFailureCode;
          readonly cause?: unknown;
        }) {
          yield* Effect.annotateLogsScoped({ input });
          yield* Effect.logInfo("Paid fulfillment failure handling started");

          yield* Effect.logInfo("Paid fulfillment failure marker started");
          yield* reservations
            .markFulfillmentFailed({
              id: input.orderId,
              failureCode: input.failureCode,
              failedAt: Temporal.Now.instant(),
            })
            .pipe(
              Effect.tapError((cause) =>
                Effect.logError("Paid fulfillment failure marker failed", {
                  orderId: input.orderId,
                  failureCode: input.failureCode,
                  cause,
                })
              ),
              Effect.ignore
            );
          yield* Effect.logInfo("Paid fulfillment failure marker completed");
          yield* Effect.logFatal("Paid fulfillment failure handling completed");

          return yield* new WorkspacePaidFulfillmentError({
            ...input,
            message: "Paid reservation fulfillment failed.",
          });
        }
      );

      return WorkspacePaidFulfillmentService.of({
        fulfillPaidOrder: Effect.fn(
          "workspacePaidFulfillment.fulfillPaidOrder"
        )(
          function* (input) {
            yield* Effect.annotateLogsScoped({ input });
            yield* Effect.logInfo("Paid fulfillment started");

            yield* Effect.logDebug(
              "Paid fulfillment reservation lookup started"
            );
            const reservation = yield* reservations
              .findById(input.orderId)
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new WorkspacePaidFulfillmentError({
                      orderId: input.orderId,
                      failureCode: "fulfillment_order_load_failed",
                      message:
                        "Paid reservation could not be loaded for fulfillment.",
                      cause,
                    })
                )
              );
            yield* Effect.annotateLogsScoped({ reservation });
            yield* Effect.logDebug("Paid fulfillment reservation loaded");

            if (!reservation) {
              yield* Effect.logWarning(
                "Paid fulfillment skipped: reservation missing",
                {
                  reason: "reservation_missing",
                }
              );
              return;
            }

            if (reservation.paymentState !== "paid") {
              yield* Effect.logWarning(
                "Paid fulfillment skipped: reservation not paid",
                {
                  reason: "reservation_not_paid",
                }
              );
              return;
            }

            if (reservation.fulfillmentState === "fulfilled") {
              yield* Effect.logInfo(
                "Paid access fulfillment already completed; retrying invoice processing",
                {
                  reason: "already_fulfilled",
                }
              );
              yield* processReservationInvoice(reservation);
              return;
            }

            if (reservation.fulfillmentState === "awaiting_delivery") {
              yield* Effect.logInfo(
                "Paid fulfillment skipped: awaiting customer email delivery",
                {
                  reason: "awaiting_customer_email_delivery",
                }
              );
              return;
            }

            const staleProcessingBefore = Temporal.Now.instant().subtract({
              milliseconds: PAID_FULFILLMENT_PROCESSING_RETRY_AFTER_MS,
            });

            if (reservation.fulfillmentState === "processing") {
              if (
                Temporal.Instant.compare(
                  reservation.updatedAt,
                  staleProcessingBefore
                ) > 0
              ) {
                yield* Effect.logInfo(
                  "Paid fulfillment skipped: already processing",
                  {
                    reason: "already_processing",
                  }
                );
                return;
              }

              yield* Effect.logWarning(
                "Paid fulfillment retrying stale processing reservation",
                {
                  reason: "stale_processing",
                  staleProcessingBefore,
                }
              );
            }

            const claimed = yield* reservations
              .claimPaidFulfillment({
                id: reservation.id,
                staleProcessingBefore,
              })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new WorkspacePaidFulfillmentError({
                      orderId: input.orderId,
                      failureCode: "fulfillment_claim_failed",
                      message:
                        "Paid reservation could not be claimed for fulfillment.",
                      cause,
                    })
                )
              );
            yield* Effect.annotateLogsScoped({ claimed });
            yield* Effect.logDebug("Paid fulfillment claim completed");

            if (!claimed) {
              yield* Effect.logWarning(
                "Paid fulfillment skipped: claim returned no reservation",
                { reason: "claim_returned_no_reservation" }
              );
              return;
            }
            yield* Effect.logInfo("Paid fulfillment claim succeeded");

            if (!claimed.dotyposReservationId) {
              yield* Effect.logWarning(
                "Paid fulfillment failed: missing Dotypos reservation hold",
                { reason: "missing_dotypos_reservation_id" }
              );

              return yield* failFulfillment({
                orderId: input.orderId,
                failureCode: "dotypos_reservation_unfulfillable",
              });
            }

            if (claimed.reservationState !== "confirmed") {
              if (claimed.reservationState !== "held") {
                yield* Effect.logWarning(
                  "Paid fulfillment failed: reservation no longer confirmable",
                  { reason: "reservation_no_longer_confirmable" }
                );

                return yield* failFulfillment({
                  orderId: input.orderId,
                  failureCode: "dotypos_reservation_unfulfillable",
                });
              }

              yield* Effect.logInfo(
                "Dotypos paid reservation confirmation started"
              );
              yield* dotypos
                .confirmReservation(claimed.dotyposReservationId)
                .pipe(
                  Effect.tapError((cause) =>
                    Effect.logError(
                      "Dotypos paid reservation confirmation failed",
                      { claimed, cause }
                    )
                  ),
                  Effect.catch((cause) =>
                    failFulfillment({
                      orderId: input.orderId,
                      failureCode: "dotypos_reservation_failed",
                      cause,
                    })
                  )
                );
              yield* Effect.logInfo(
                "Dotypos paid reservation confirmation succeeded"
              );

              yield* Effect.logInfo(
                "Paid fulfillment reservation confirmed marker started"
              );
              const confirmedAt = Temporal.Now.instant();
              yield* reservations
                .markReservationConfirmed({
                  id: claimed.id,
                  confirmedAt,
                })
                .pipe(
                  Effect.tapError((cause) =>
                    Effect.logError(
                      "Paid fulfillment reservation confirmed marker failed",
                      { claimed, cause }
                    )
                  )
                );
              yield* Effect.logInfo(
                "Paid fulfillment reservation confirmed marker succeeded"
              );
              yield* captureReservationCompleted({
                reservation: claimed,
                timestamp: confirmedAt,
              }).pipe(
                Effect.provideService(PostHogEventService, posthogEvents)
              );
            }

            yield* Effect.logInfo("Paid reservation email flow started");
            const reservationForDelivery = yield* workspaceReservations
              .getReservation(claimed.id)
              .pipe(
                Effect.tapError((cause) =>
                  Effect.logError(
                    "Workspace paid reservation email flow failed",
                    {
                      workspaceReservationId: claimed.id,
                      dotyposCustomerId: claimed.dotyposCustomerId,
                      cause,
                    }
                  )
                ),
                Effect.catch((cause) =>
                  failFulfillment({
                    orderId: input.orderId,
                    failureCode: "fulfillment_email_failed",
                    cause,
                  })
                )
              );
            yield* accessCodes
              .resolveCustomerAccessCode({
                reservationId: reservationForDelivery.id,
                dotyposReservationId:
                  reservationForDelivery.dotyposReservationId,
                reservedFrom: reservationForDelivery.reservedFrom,
                reservedUntil: reservationForDelivery.reservedUntil,
              })
              .pipe(
                Effect.catch((cause) =>
                  failFulfillment({
                    orderId: input.orderId,
                    failureCode: "fulfillment_access_failed",
                    cause,
                  })
                )
              );
            const customerEmailDeliveryId = yield* reservationEmails
              .sendPaidReservationEmails({
                reservation: reservationForDelivery,
                ...(claimed.activeCustomerEmailDeliveryId && {
                  customerEmailIdempotencyKey:
                    createCustomerEmailRecoveryIdempotencyKey(
                      claimed.activeCustomerEmailDeliveryId
                    ),
                }),
              })
              .pipe(
                Effect.catch((cause) =>
                  failFulfillment({
                    orderId: input.orderId,
                    failureCode: "fulfillment_email_failed",
                    cause,
                  })
                )
              );
            yield* Effect.logInfo("Paid reservation email flow succeeded");

            if (env.VERCEL_ENV !== "production") {
              yield* reservations.markFulfilled({
                id: claimed.id,
                fulfilledAt: Temporal.Now.instant(),
              });
              yield* processReservationInvoice(claimed);
              yield* Effect.logInfo(
                "Non-production paid fulfillment completed after email provider acceptance"
              );
              return;
            }

            yield* Effect.logInfo(
              "Paid fulfillment recorded accepted customer email delivery"
            );
            yield* reservations.markAwaitingCustomerEmailDelivery({
              id: claimed.id,
              customerEmailDeliveryId,
            });
            yield* Effect.logInfo(
              "Paid fulfillment is awaiting Resend delivery webhook"
            );
          },
          (effect, input) =>
            effect.pipe(
              Effect.catch((cause) =>
                Predicate.isTagged(cause, "WorkspacePaidFulfillmentError")
                  ? Effect.fail(cause)
                  : failFulfillment({
                      orderId: input.orderId,
                      failureCode: "fulfillment_completion_failed",
                      cause,
                    })
              ),
              Effect.scoped,
              Effect.annotateLogs({ ...input })
            )
        ),
      });
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.provideMerge(
        WorkspaceReservationEmailService.Default,
        Layer.provideMerge(
          Layer.provideMerge(EmailServiceTag.Live, EmailConfigLayer),
          WorkspaceCheckoutNetworkDetailsService.Default
        )
      )
    ),
    Layer.provide(PostHogEventService.Live),
    Layer.provide(ReservationInvoiceService.Live),
    Layer.provide(WorkspaceReservationService.Default),
    Layer.provide(WorkspaceCheckoutAccessCodeService.Live),
    Layer.provide(WorkspaceReservationRepository.Default),
    Layer.provide(WorkspaceDatabase.Default),
    Layer.provide(WorkspaceDotyposLayer),
    Layer.provide(
      SeatingMapFeatureFlagService.Default.pipe(
        Layer.provide(WorkspaceFeatureFlagService.Default)
      )
    )
  );
}
