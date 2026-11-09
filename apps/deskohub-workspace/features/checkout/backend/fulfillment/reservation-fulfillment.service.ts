import { type DotyposReservationId, DotyposService } from "@deskohub/dotypos";
import {
  type EmailDeliveryId,
  isConsoleEmailDeliveryId,
} from "@deskohub/email";
import { Context, Data, Effect, Layer, Match, Predicate } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { env } from "@/env";
import {
  CustomerEmailLocaleService,
  ReservationAuthorDirectory,
} from "@/features/account";
import { ReservationInvoiceService } from "@/features/accounting/backend/reservation-invoice.service";
import { WorkspaceCheckoutAccessCodeService } from "@/features/checkout/backend/reservation/access-code.service";
import type { Locale } from "@/features/i18n";
import { SeatingMapReleaseGate } from "@/features/reservation/backend/seating-map-release-gate";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
  type WorkspaceReservationStateError,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type WorkspaceReservationDetails,
  WorkspaceReservationService,
} from "@/features/reservation/backend/workspace-reservation.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { WorkspaceEmailLayer } from "@/shared/backend/config/email.config";
import { CheckoutAnalytics } from "../analytics/checkout-analytics.service";
import {
  createCustomerEmailInitialIdempotencyKey,
  createCustomerEmailRecoveryIdempotencyKey,
} from "./customer-email-idempotency-key";
import {
  FulfillmentLedger,
  fulfillmentEmailFailureCode,
} from "./fulfillment-ledger.repository";
import { WorkspaceCheckoutNetworkDetailsService } from "./network-details.service";
import {
  createCustomerEmailLocaleResolver,
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

/**
 * One decoded provider report about this deployment's customer
 * confirmation. The delivery report ingress verifies the provider payload
 * and the deployment; fulfillment applies the report.
 */
export interface ReservationAccessDeliveryReport {
  /** The provider's ID of the reported send. */
  readonly deliveryId: EmailDeliveryId;
  /** A bounce reports `failed`. */
  readonly outcome: "delivered" | "failed";
  /** The provider's event time, which fences the current delivery outcome. */
  readonly occurredAt: Temporal.Instant;
  /**
   * The customer access email the sender's tags declare. Undefined when the
   * tags carry another source or no valid reservation ID.
   */
  readonly accessEmail?: {
    readonly reservationId: WorkspaceReservationId;
  };
}

type ReservationDeliveryIgnoredReason =
  | "unknown_email_delivery"
  | "unrelated_email"
  | "reservation_mismatch"
  | "reservation_already_fulfilled"
  | "reservation_already_failed"
  | "reservation_delivery_state_changed";

export type ReservationDeliveryOutcome =
  | "applied"
  | { readonly ignored: ReservationDeliveryIgnoredReason };

/** A report that could not be applied yet; the provider should retry it. */
export class ReservationDeliveryReportError extends Data.TaggedError(
  "ReservationDeliveryReportError"
)<{
  readonly reason:
    | "delivery_unattached"
    | "reservation_load_failed"
    | "invoice_processing_failed"
    | "reservation_update_failed";
  readonly message: string;
  readonly workspaceReservationId?: WorkspaceReservationId;
  readonly cause?: unknown;
}> {}

/** A cancelled hold can never be confirmed; any other failure may pass on a retry. */
const dotyposConfirmationFailureCode = (
  cause: Effect.Error<
    ReturnType<DotyposService["Service"]["confirmReservation"]>
  >
) =>
  Match.value(cause).pipe(
    Match.tagsExhaustive({
      DotyposReservationCancelledError: () =>
        "dotypos_reservation_unfulfillable" as const,
      DotyposUnavailable: () => "dotypos_reservation_failed" as const,
      DotyposRejected: () => "dotypos_reservation_failed" as const,
      DotyposUncertain: () => "dotypos_reservation_failed" as const,
      DotyposVersionConflict: () => "dotypos_reservation_failed" as const,
    })
  );

const appliedDelivery: ReservationDeliveryOutcome = "applied";

const ignoredDelivery = (
  reason: ReservationDeliveryIgnoredReason
): ReservationDeliveryOutcome => ({ ignored: reason });

export interface IReservationFulfillment {
  /**
   * Claims the paid order, confirms it in Dotypos, issues access, sends the
   * customer confirmation, then completes or awaits its delivery report.
   * Idempotent per order. Whether to run inline or enqueue stays with the
   * caller.
   */
  readonly run: (
    orderId: WorkspaceReservationId
  ) => Effect.Effect<
    void,
    WorkspacePaidFulfillmentError | WorkspaceReservationStateError
  >;
  /**
   * Applies a delivery report for the customer confirmation: completes or
   * fails the delivery it matches, and ignores reports for other emails or
   * outcomes that are no longer current.
   */
  readonly recordDelivery: (
    report: ReservationAccessDeliveryReport
  ) => Effect.Effect<
    ReservationDeliveryOutcome,
    ReservationDeliveryReportError
  >;
}

/**
 * Reservation fulfillment: the paid-fulfillment run, customer confirmation
 * delivery reports, and the fulfillment progress they write (the Fulfillment
 * state in the checkout lifecycle reference). The queue consumer and the
 * stalled-run cron are its trigger adapters; the ledger stays internal.
 *
 * Fence invariant: a run claims a `processing` fulfillment again only after
 * `PAID_FULFILLMENT_PROCESSING_RETRY_AFTER_MS` without progress, and never an
 * `awaiting_delivery` one. Completion (`markFulfilled`) and failure fence on
 * the fulfillment state alone, not on the claim, so a stalled run that was
 * reclaimed can still settle the order. Delivery reports apply only to the
 * active delivery ID and only when strictly newer than the current outcome.
 * Change the fence only together with the invoice delivery lease's.
 */
export class ReservationFulfillment extends Context.Service<
  ReservationFulfillment,
  IReservationFulfillment
>()("ReservationFulfillment") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const reservations = yield* WorkspaceReservationRepository;
      const ledger = yield* FulfillmentLedger;
      const dotypos = yield* DotyposService;
      const reservationEmails = yield* WorkspaceReservationEmailService;
      const emailLocale = yield* CustomerEmailLocaleService;
      const resolveCustomerEmailLocale =
        createCustomerEmailLocaleResolver(emailLocale);
      const workspaceReservations = yield* WorkspaceReservationService;
      const accessCodes = yield* WorkspaceCheckoutAccessCodeService;
      const checkoutAnalytics = yield* CheckoutAnalytics;
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
          yield* ledger
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

      // An invoice failure after a delivery report leaves the delivery
      // recorded; the provider's retry of the report retries the invoice.
      const processDeliveredReservationInvoice = Effect.fn(
        "resendWebhook.processReservationInvoice"
      )(function* (
        reservation: Pick<WorkspaceReservation, "activePaymentAttemptId" | "id">
      ) {
        if (!reservation.activePaymentAttemptId) {
          yield* Effect.logWarning(
            "Reservation invoice processing skipped: payment attempt missing",
            { workspaceReservationId: reservation.id }
          );
          return;
        }

        yield* reservationInvoices
          .processByPaymentAttemptId({
            paymentAttemptId: reservation.activePaymentAttemptId,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new ReservationDeliveryReportError({
                  reason: "invoice_processing_failed",
                  message:
                    "Reservation invoice processing after a delivery report failed.",
                  workspaceReservationId: reservation.id,
                  cause,
                })
            )
          );
      });

      // Settles an order this run must not claim, retrying a fulfilled
      // order's invoice; returns the order to claim otherwise.
      const admitPaidOrder = Effect.fnUntraced(function* (
        reservation: WorkspaceReservation | null
      ) {
        if (!reservation) {
          yield* Effect.logWarning(
            "Paid fulfillment skipped: reservation missing",
            {
              reason: "reservation_missing",
            }
          );
          return null;
        }

        if (reservation.paymentState !== "paid") {
          yield* Effect.logWarning(
            "Paid fulfillment skipped: reservation not paid",
            {
              reason: "reservation_not_paid",
            }
          );
          return null;
        }

        if (reservation.fulfillmentState === "fulfilled") {
          yield* Effect.logInfo(
            "Paid access fulfillment already completed; retrying invoice processing",
            {
              reason: "already_fulfilled",
            }
          );
          yield* processReservationInvoice(reservation);
          return null;
        }

        if (reservation.fulfillmentState === "awaiting_delivery") {
          yield* Effect.logInfo(
            "Paid fulfillment skipped: awaiting customer email delivery",
            {
              reason: "awaiting_customer_email_delivery",
            }
          );
          return null;
        }

        return reservation;
      });

      // The instant before which a `processing` claim counts as stale, or
      // null while another run still holds the order.
      const staleProcessingCutoff = Effect.fnUntraced(function* (
        reservation: WorkspaceReservation
      ) {
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
            return null;
          }

          yield* Effect.logWarning(
            "Paid fulfillment retrying stale processing reservation",
            {
              reason: "stale_processing",
              staleProcessingBefore,
            }
          );
        }

        return staleProcessingBefore;
      });

      const claimPaidOrder = (input: {
        readonly orderId: WorkspaceReservationId;
        readonly reservation: WorkspaceReservation;
        readonly staleProcessingBefore: Temporal.Instant;
      }) =>
        ledger
          .claimPaidFulfillment({
            id: input.reservation.id,
            staleProcessingBefore: input.staleProcessingBefore,
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

      const confirmHeldReservation = Effect.fnUntraced(function* (input: {
        readonly orderId: WorkspaceReservationId;
        readonly claimed: WorkspaceReservation;
        readonly dotyposReservationId: DotyposReservationId;
      }) {
        const { claimed } = input;
        yield* Effect.logInfo("Dotypos paid reservation confirmation started");
        yield* dotypos.confirmReservation(input.dotyposReservationId).pipe(
          Effect.tapError((cause) =>
            Effect.logError("Dotypos paid reservation confirmation failed", {
              claimed,
              cause,
            })
          ),
          Effect.catch((cause) =>
            failFulfillment({
              orderId: input.orderId,
              failureCode: dotyposConfirmationFailureCode(cause),
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
        yield* checkoutAnalytics.reservationCompleted({
          reservation: claimed,
          timestamp: confirmedAt,
        });
      });

      // Fails a claim Dotypos can't fulfill, confirms a held one, and leaves
      // a confirmed one as it is.
      const confirmClaimedReservation = Effect.fnUntraced(function* (input: {
        readonly orderId: WorkspaceReservationId;
        readonly claimed: WorkspaceReservation;
      }) {
        const { claimed } = input;
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

        if (claimed.reservationState === "confirmed") {
          return;
        }

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

        yield* confirmHeldReservation({
          orderId: input.orderId,
          claimed,
          dotyposReservationId: claimed.dotyposReservationId,
        });
      });

      const loadReservationForDelivery = (input: {
        readonly orderId: WorkspaceReservationId;
        readonly claimed: WorkspaceReservation;
      }) =>
        workspaceReservations.getReservation(input.claimed.id).pipe(
          Effect.tapError((cause) =>
            Effect.logError("Workspace paid reservation email flow failed", {
              workspaceReservationId: input.claimed.id,
              dotyposCustomerId: input.claimed.dotyposCustomerId,
              cause,
            })
          ),
          // Only a real email failure may later be repaired by a delivered
          // webhook, so a provider read failure keeps the Dotypos failure
          // code.
          Effect.catch((cause) =>
            failFulfillment({
              orderId: input.orderId,
              failureCode: "dotypos_reservation_failed",
              cause,
            })
          )
        );

      const issueCustomerAccessCode = (input: {
        readonly orderId: WorkspaceReservationId;
        readonly reservationForDelivery: WorkspaceReservationDetails;
      }) => {
        const { reservationForDelivery } = input;
        return accessCodes
          .resolveCustomerAccessCode({
            reservationId: reservationForDelivery.id,
            dotyposReservationId: reservationForDelivery.dotyposReservationId,
            // The door code also covers an early-setup meeting room's setup
            // time.
            reservedFrom:
              reservationForDelivery.setupFrom ??
              reservationForDelivery.reservedFrom,
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
      };

      // A retained locale pins the current idempotency generation to the
      // language of its first send: preference changes between failed or
      // accepted-but-unrecorded retries must not change the email under the
      // same provider idempotency key. Retention is bound to the claimed
      // delivery generation via its active-delivery marker, and the
      // repository returns the AUTHORITATIVE retained locale, so a writer that
      // loses the null-slot race adopts the winner's locale and sends it. A
      // null result means another writer already closed this generation by
      // recording its accepted send, so this writer fails before sending.
      // Recording the accepted send's delivery ID clears the slot, so the
      // next generation resolves the current preference again.
      const retainCustomerEmailLocale = (input: {
        readonly orderId: WorkspaceReservationId;
        readonly claimed: WorkspaceReservation;
        readonly reservationForDelivery: WorkspaceReservationDetails;
      }) => {
        const { claimed } = input;
        return (
          claimed.activeCustomerEmailDeliveryLocale
            ? Effect.succeed(claimed.activeCustomerEmailDeliveryLocale)
            : resolveCustomerEmailLocale(input.reservationForDelivery).pipe(
                Effect.flatMap((locale) =>
                  ledger.retainActiveCustomerEmailDeliveryLocale({
                    id: claimed.id,
                    locale,
                    expectedActiveCustomerEmailDeliveryId:
                      claimed.activeCustomerEmailDeliveryId ?? null,
                  })
                ),
                Effect.flatMap((authoritativeLocale) =>
                  authoritativeLocale
                    ? Effect.succeed(authoritativeLocale)
                    : Effect.fail(new CustomerEmailDeliveryGenerationClosed())
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
      };

      const sendCustomerConfirmation = Effect.fnUntraced(function* (input: {
        readonly orderId: WorkspaceReservationId;
        readonly claimed: WorkspaceReservation;
        readonly reservationForDelivery: WorkspaceReservationDetails;
        readonly customerEmailLocale: Locale;
      }) {
        const { claimed, reservationForDelivery } = input;
        // The author confirmation goes out with the first customer delivery
        // only; a recovery delivery after a bounce re-sends the customer's
        // email alone, so the author never gets a duplicate once the
        // provider's idempotency window has passed.
        const author = claimed.activeCustomerEmailDeliveryId
          ? null
          : yield* describeReservationAuthor(claimed);
        return yield* reservationEmails
          .sendPaidReservationEmails({
            reservation: reservationForDelivery,
            customerEmailLocale: input.customerEmailLocale,
            author,
            customerEmailIdempotencyKey: claimed.activeCustomerEmailDeliveryId
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
      });

      // Completes an accepted send that no delivery report will follow, and
      // otherwise awaits the report.
      const settleAcceptedDelivery = Effect.fnUntraced(function* (input: {
        readonly orderId: WorkspaceReservationId;
        readonly claimed: WorkspaceReservation;
        readonly customerEmailDeliveryId: EmailDeliveryId;
      }) {
        const { claimed, customerEmailDeliveryId } = input;
        // Console never reports delivery, and protected Previews cannot
        // receive Resend callbacks, so acceptance is final for both.
        const acceptedByConsole = isConsoleEmailDeliveryId(
          customerEmailDeliveryId
        );
        if (env.VERCEL_ENV !== "production" || acceptedByConsole) {
          yield* ledger.markFulfilled({
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
        yield* ledger
          .markAwaitingCustomerEmailDelivery({
            id: claimed.id,
            customerEmailDeliveryId,
            expectedActiveCustomerEmailDeliveryId:
              claimed.activeCustomerEmailDeliveryId ?? null,
          })
          .pipe(
            // Only a verified generation supersession is benign: another
            // writer owns the reservation row, so this recording is a no-op.
            // Any other invalid-state failure keeps the normal failure
            // handling.
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
      });

      // Issues access, sends the customer confirmation, then completes the
      // fulfillment or awaits its delivery report.
      const deliverPaidReservation = Effect.fnUntraced(function* (input: {
        readonly orderId: WorkspaceReservationId;
        readonly claimed: WorkspaceReservation;
      }) {
        yield* Effect.logInfo("Paid reservation email flow started");
        const reservationForDelivery = yield* loadReservationForDelivery(input);
        yield* issueCustomerAccessCode({
          orderId: input.orderId,
          reservationForDelivery,
        });
        const customerEmailLocale = yield* retainCustomerEmailLocale({
          ...input,
          reservationForDelivery,
        });
        const customerEmailDeliveryId = yield* sendCustomerConfirmation({
          ...input,
          reservationForDelivery,
          customerEmailLocale,
        });
        yield* Effect.logInfo("Paid reservation email flow succeeded");
        yield* settleAcceptedDelivery({ ...input, customerEmailDeliveryId });
      });

      // A report without an attached delivery is retried while the sender's
      // tags name a customer access email, and ignored otherwise.
      const reportUnattachedDelivery = Effect.fnUntraced(function* (
        report: ReservationAccessDeliveryReport
      ) {
        if (report.accessEmail) {
          const workspaceReservationId = report.accessEmail.reservationId;
          yield* Effect.logWarning(
            "Resend webhook arrived before the customer delivery was attached",
            { workspaceReservationId }
          );

          return yield* new ReservationDeliveryReportError({
            reason: "delivery_unattached",
            message:
              "The customer delivery was reported before it was attached to a reservation.",
            workspaceReservationId,
          });
        }

        yield* Effect.logWarning(
          "Resend webhook referenced an unknown customer email delivery"
        );

        return ignoredDelivery("unknown_email_delivery");
      });

      const applyDeliveredReport = Effect.fnUntraced(function* (input: {
        readonly report: ReservationAccessDeliveryReport;
        readonly reservation: WorkspaceReservation;
        readonly workspaceReservationId: WorkspaceReservationId;
      }) {
        const { report, reservation, workspaceReservationId } = input;
        if (reservation.fulfillmentState === "fulfilled") {
          yield* processDeliveredReservationInvoice(reservation);
          return ignoredDelivery("reservation_already_fulfilled");
        }

        if (
          reservation.fulfillmentState === "failed" &&
          reservation.fulfillmentFailureCode !== fulfillmentEmailFailureCode
        ) {
          yield* Effect.logInfo(
            "Resend delivery success ignored: reservation already failed",
            {
              workspaceReservationId,
              fulfillmentFailureCode: reservation.fulfillmentFailureCode,
            }
          );

          return ignoredDelivery("reservation_already_failed");
        }

        const fulfilledAt = report.occurredAt;
        const fulfilledReservation = yield* ledger
          .markCustomerEmailDeliveryFulfilled({
            customerEmailDeliveryId: report.deliveryId,
            fulfilledAt,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new ReservationDeliveryReportError({
                  reason: "reservation_update_failed",
                  message:
                    "The reported delivery could not mark the reservation fulfilled.",
                  workspaceReservationId,
                  cause,
                })
            )
          );

        if (!fulfilledReservation) {
          yield* Effect.logInfo(
            "Resend delivery success ignored: reservation delivery state is newer or changed concurrently",
            {
              workspaceReservationId,
              fulfillmentState: reservation.fulfillmentState,
            }
          );

          return ignoredDelivery("reservation_delivery_state_changed");
        }

        yield* checkoutAnalytics.reservationFulfilled({
          reservation: fulfilledReservation,
          timestamp: fulfilledAt,
        });
        yield* processDeliveredReservationInvoice(fulfilledReservation);

        return appliedDelivery;
      });

      const applyBouncedReport = Effect.fnUntraced(function* (input: {
        readonly report: ReservationAccessDeliveryReport;
        readonly reservation: WorkspaceReservation;
        readonly workspaceReservationId: WorkspaceReservationId;
      }) {
        const { report, workspaceReservationId } = input;
        const failedReservation = yield* ledger
          .markCustomerEmailDeliveryFailed({
            customerEmailDeliveryId: report.deliveryId,
            failureCode: fulfillmentEmailFailureCode,
            failedAt: report.occurredAt,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new ReservationDeliveryReportError({
                  reason: "reservation_update_failed",
                  message:
                    "The reported delivery could not mark the reservation fulfillment failed.",
                  workspaceReservationId,
                  cause,
                })
            )
          );

        if (!failedReservation) {
          yield* Effect.logInfo(
            "Resend delivery failure ignored: reservation delivery state is newer or changed concurrently",
            {
              workspaceReservationId,
              fulfillmentState: input.reservation.fulfillmentState,
            }
          );

          return ignoredDelivery("reservation_delivery_state_changed");
        }

        return appliedDelivery;
      });

      return ReservationFulfillment.of({
        run: Effect.fn("workspacePaidFulfillment.fulfillPaidOrder")(
          function* (orderId) {
            const input = { orderId };
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

            const admitted = yield* admitPaidOrder(reservation);
            if (!admitted) {
              return;
            }
            const staleProcessingBefore =
              yield* staleProcessingCutoff(admitted);
            if (!staleProcessingBefore) {
              return;
            }

            const claimed = yield* claimPaidOrder({
              orderId: input.orderId,
              reservation: admitted,
              staleProcessingBefore,
            });
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

            yield* confirmClaimedReservation({
              orderId: input.orderId,
              claimed,
            });
            yield* deliverPaidReservation({ orderId: input.orderId, claimed });
          },
          (effect, orderId) =>
            effect.pipe(
              Effect.catch((cause) =>
                Predicate.isTagged(cause, "WorkspacePaidFulfillmentError")
                  ? Effect.fail(cause)
                  : failFulfillment({
                      orderId,
                      failureCode: "fulfillment_completion_failed",
                      cause,
                    })
              ),
              Effect.scoped,
              Effect.annotateLogs({ orderId })
            )
        ),
        // Applies the decoded report in the order the webhook always has:
        // the active delivery lookup first, then the sender's tags, then the
        // outcome. Every transition is fenced again in the ledger.
        recordDelivery: Effect.fn("reservationFulfillment.recordDelivery")(
          function* (report) {
            const { accessEmail } = report;

            const reservation = yield* ledger
              .findByActiveCustomerEmailDeliveryId(report.deliveryId)
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new ReservationDeliveryReportError({
                      reason: "reservation_load_failed",
                      message:
                        "The reservation of the reported delivery could not be loaded.",
                      cause,
                    })
                )
              );

            if (!reservation) {
              return yield* reportUnattachedDelivery(report);
            }

            if (!accessEmail) {
              return ignoredDelivery("unrelated_email");
            }

            const workspaceReservationId = accessEmail.reservationId;
            if (workspaceReservationId !== reservation.id) {
              yield* Effect.logWarning(
                "Resend webhook reservation tag did not match the active delivery",
                { workspaceReservationId }
              );

              return ignoredDelivery("reservation_mismatch");
            }

            const applyReport =
              report.outcome === "delivered"
                ? applyDeliveredReport
                : applyBouncedReport;
            return yield* applyReport({
              report,
              reservation,
              workspaceReservationId,
            });
          }
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
            WorkspaceEmailLayer,
            WorkspaceCheckoutNetworkDetailsService.Default
          ),
          CustomerEmailLocaleService.Live
        )
      )
    ),
    Layer.provide(CheckoutAnalytics.Live),
    Layer.provide(ReservationInvoiceService.Live),
    Layer.provide(WorkspaceReservationService.Default),
    Layer.provide(WorkspaceCheckoutAccessCodeService.Live),
    Layer.provide(WorkspaceReservationRepository.Default),
    Layer.provide(FulfillmentLedger.Default),
    Layer.provide(ReservationAuthorDirectory.Default),
    Layer.provide(WorkspaceDatabase.Default),
    Layer.provide(WorkspaceDotyposLayer),
    Layer.provide(SeatingMapReleaseGate.Live)
  );
}
