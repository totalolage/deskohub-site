import { DotyposService } from "@deskohub/dotypos";
import { isConsoleEmailDeliveryId } from "@deskohub/email";
import { EmailServiceTag } from "@deskohub/email/backend/service";
import { Context, Data, Effect, Layer, Match, Predicate } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { env } from "@/env";
import {
  CustomerEmailLocaleService,
  ReservationAuthorDirectory,
} from "@/features/account";
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
  createCustomerEmailInitialIdempotencyKey,
  createCustomerEmailLocaleResolver,
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

class CustomerEmailDeliveryGenerationClosed extends Data.TaggedError(
  "CustomerEmailDeliveryGenerationClosed"
) {}

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
      const emailLocale = yield* CustomerEmailLocaleService;
      const resolveCustomerEmailLocale =
        createCustomerEmailLocaleResolver(emailLocale);
      const workspaceReservations = yield* WorkspaceReservationService;
      const accessCodes = yield* WorkspaceCheckoutAccessCodeService;
      const posthogEvents = yield* PostHogEventService;
      const reservationInvoices = yield* ReservationInvoiceService;
      const reservationAuthors = yield* ReservationAuthorDirectory;

      // The author only adds a secondary confirmation, so an author that
      // can't be read skips it rather than failing fulfillment.
      const describeReservationAuthor = Effect.fn(
        "workspacePaidFulfillment.describeReservationAuthor"
      )(function* (
        reservation: Pick<WorkspaceReservation, "authorAccountId" | "id">
      ) {
        const { authorAccountId } = reservation;
        return yield* reservationAuthors.describe([authorAccountId]).pipe(
          Effect.map((authors) => authors.get(authorAccountId) ?? null),
          Effect.catch((error) =>
            Effect.logWarning(
              "Paid reservation author could not be read; the author confirmation is skipped",
              { code: error.code, workspaceReservationId: reservation.id }
            ).pipe(Effect.as(null))
          )
        );
      });

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
                      failureCode: Match.value(cause).pipe(
                        Match.tagsExhaustive({
                          DotyposReservationCancelledError: () =>
                            "dotypos_reservation_unfulfillable" as const,
                          ExternalAPIError: () =>
                            "dotypos_reservation_failed" as const,
                          NetworkError: () =>
                            "dotypos_reservation_failed" as const,
                          ValidationError: () =>
                            "dotypos_reservation_failed" as const,
                        })
                      ),
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
                // Only a real email failure may later be repaired by a
                // delivered webhook, so a provider read failure keeps the
                // Dotypos failure code.
                Effect.catch((cause) =>
                  failFulfillment({
                    orderId: input.orderId,
                    failureCode: "dotypos_reservation_failed",
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
            // A retained locale pins the current idempotency generation to the
            // language of its first send: preference changes between failed or
            // accepted-but-unrecorded retries must not change the email under
            // the same provider idempotency key. Retention is bound to the
            // claimed delivery generation via its active-delivery marker, and
            // the repository returns the AUTHORITATIVE retained locale, so a
            // writer that loses the null-slot race adopts the winner's locale
            // and sends it. A null result means another writer already closed
            // this generation by recording its accepted send, so this writer
            // fails before sending. Recording the accepted send's delivery ID
            // clears the slot, so the next generation resolves the current
            // preference again.
            const customerEmailLocale = yield* (
              claimed.activeCustomerEmailDeliveryLocale
                ? Effect.succeed(claimed.activeCustomerEmailDeliveryLocale)
                : resolveCustomerEmailLocale(reservationForDelivery).pipe(
                    Effect.flatMap((locale) =>
                      reservations.retainActiveCustomerEmailDeliveryLocale({
                        id: claimed.id,
                        locale,
                        expectedActiveCustomerEmailDeliveryId:
                          claimed.activeCustomerEmailDeliveryId ?? null,
                      })
                    ),
                    Effect.flatMap((authoritativeLocale) =>
                      authoritativeLocale
                        ? Effect.succeed(authoritativeLocale)
                        : Effect.fail(
                            new CustomerEmailDeliveryGenerationClosed()
                          )
                    )
                  )
            ).pipe(
              Effect.mapError(
                (cause) =>
                  new WorkspacePaidFulfillmentError({
                    orderId: input.orderId,
                    failureCode: "fulfillment_email_failed",
                    message:
                      "Paid reservation customer email locale could not be resolved and retained.",
                    cause,
                  })
              )
            );
            // The author confirmation goes out with the first customer
            // delivery only; a recovery delivery after a bounce re-sends the
            // customer's email alone, so the author never gets a duplicate
            // once the provider's idempotency window has passed.
            const author = claimed.activeCustomerEmailDeliveryId
              ? null
              : yield* describeReservationAuthor(claimed);
            const customerEmailDeliveryId = yield* reservationEmails
              .sendPaidReservationEmails({
                reservation: reservationForDelivery,
                customerEmailLocale,
                author,
                customerEmailIdempotencyKey:
                  claimed.activeCustomerEmailDeliveryId
                    ? createCustomerEmailRecoveryIdempotencyKey(
                        claimed.activeCustomerEmailDeliveryId
                      )
                    : createCustomerEmailInitialIdempotencyKey(
                        reservationForDelivery.id
                      ),
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

            // Console never reports delivery, and protected Previews cannot
            // receive Resend callbacks, so acceptance is final for both.
            const acceptedByConsole = isConsoleEmailDeliveryId(
              customerEmailDeliveryId
            );
            if (env.VERCEL_ENV !== "production" || acceptedByConsole) {
              yield* reservations.markFulfilled({
                id: claimed.id,
                fulfilledAt: Temporal.Now.instant(),
                customerEmailDeliveryId,
              });
              yield* processReservationInvoice(claimed);
              yield* Effect.logInfo(
                "Paid fulfillment completed after email provider acceptance",
                { acceptedByConsole }
              );
              return;
            }

            yield* Effect.logInfo(
              "Paid fulfillment recorded accepted customer email delivery"
            );
            yield* reservations
              .markAwaitingCustomerEmailDelivery({
                id: claimed.id,
                customerEmailDeliveryId,
                expectedActiveCustomerEmailDeliveryId:
                  claimed.activeCustomerEmailDeliveryId ?? null,
              })
              .pipe(
                // Only a verified generation supersession is benign: another
                // writer owns the reservation row, so this recording is a
                // no-op. Any other invalid-state failure keeps the normal
                // failure handling.
                Effect.catchTag(
                  "WorkspaceReservationDeliveryGenerationSupersededError",
                  () =>
                    Effect.logWarning(
                      "Paid fulfillment delivery recording superseded by a newer delivery generation",
                      { orderId: input.orderId }
                    )
                )
              );
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
          Layer.provideMerge(
            Layer.provideMerge(
              EmailServiceTag.RecipientRouted,
              EmailConfigLayer
            ),
            WorkspaceCheckoutNetworkDetailsService.Default
          ),
          CustomerEmailLocaleService.Live
        )
      )
    ),
    Layer.provide(PostHogEventService.Live),
    Layer.provide(ReservationInvoiceService.Live),
    Layer.provide(WorkspaceReservationService.Default),
    Layer.provide(WorkspaceCheckoutAccessCodeService.Live),
    Layer.provide(WorkspaceReservationRepository.Default),
    Layer.provide(ReservationAuthorDirectory.Default),
    Layer.provide(WorkspaceDatabase.Default),
    Layer.provide(WorkspaceDotyposLayer),
    Layer.provide(
      SeatingMapFeatureFlagService.Default.pipe(
        Layer.provide(WorkspaceFeatureFlagService.Default)
      )
    )
  );
}
