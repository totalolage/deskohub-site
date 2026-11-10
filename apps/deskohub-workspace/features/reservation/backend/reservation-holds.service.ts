import {
  type DotyposReservationId,
  DotyposService,
  type DotyposWriteFailure,
} from "@deskohub/dotypos";
import {
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Match,
  Predicate,
  Schedule,
  Schema,
} from "effect";
import type { CustomerAgentClientId } from "@/features/account";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { CheckoutAnalytics } from "@/features/checkout/backend/analytics";
import { payStateDefaultTtlMilliseconds } from "@/features/checkout/backend/checkout";
import {
  deriveCheckoutAttemptKeys,
  deriveCheckoutSessionKeys,
  deriveCheckoutSessionLockKey,
} from "@/features/checkout/backend/checkout/checkout-lookup-keys.server";
import {
  DotyposHoldRelease,
  ReservationHoldCleanupScheduleService,
  UnpaidHoldRelease,
} from "@/features/checkout/backend/holds";
import {
  createWorkspaceDotyposReservation,
  WorkspaceTableAssignmentService,
} from "@/features/checkout/backend/reservation";
import {
  type CheckoutAttemptId,
  type CheckoutSessionId,
  promoteCheckoutAttemptToSessionId,
} from "@/features/checkout/checkout-identifiers";
import type { CheckoutDetails } from "@/features/checkout/schemas/checkout-details";
import type { Locale } from "@/features/i18n";
import { ensureCoworkPayStateAvailable } from "@/features/reservation/actions/prepare-cowork-pay-state";
import { ensureMeetingRoomPayStateAvailable } from "@/features/reservation/actions/prepare-meeting-room-pay-state";
import { ensureOfficePayStateAvailable } from "@/features/reservation/actions/prepare-office-pay-state";
import type { PreparePayStateInput } from "@/features/reservation/actions/prepare-pay-state.schema";
import {
  AgentBookingPaymentInProgressError,
  type AgentSelectionKey,
  type BookingAgent,
  deriveAgentCheckoutAttemptId,
} from "@/features/reservation/backend/booking-agent";
import { supersedableReservationPaymentStates } from "@/features/reservation/backend/reservation-supersession";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import {
  type CreateWorkspaceReservationInput,
  type IWorkspaceReservationRepository,
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type DotyposCustomerId,
  dotyposCustomerIdSchema,
} from "@/features/reservation/dotypos-customer";
import {
  getStoredWorkspaceReservationDetails,
  type WorkspaceReservationId,
} from "@/features/reservation/persistence-contracts";
import type { ReservationPurpose } from "@/features/reservation/reservation-purpose";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { MissingDotyposId } from "@/shared/backend/missing-dotypos-id";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";

/** One checkout attempt's hold request, as a submission books it. */
type ReservationHoldRequest = {
  readonly checkout: {
    readonly sessionId: CheckoutSessionId;
    readonly attemptId: CheckoutAttemptId;
  };
  /** The normalized reservation the advertisement priced; attempt keys bind it. */
  readonly reservation: PreparePayStateInput["reservation"];
  /** Who books, for whom, and how the stored draft is attributed. */
  readonly booking: {
    readonly author: CustomerAccountId;
    readonly customer: DotyposCustomerId;
    readonly locale: Locale;
    readonly purpose: ReservationPurpose;
    /** The submission's booking instant, which an agent's hold is anchored at. */
    readonly bookedAt: Temporal.Instant;
    /** The customer agent that books, absent for the site and native apps. */
    readonly agent?: BookingAgent["Service"];
  };
  /** What a new Dotypos hold carries, from the customer's quote. */
  readonly checkoutDetails: CheckoutDetails;
};

/** Where the attempt's hold stands once the request returns. */
export type ReservationHold =
  /** The request created and attached a new hold. */
  | {
      readonly kind: "created";
      readonly reservationId: WorkspaceReservationId;
      readonly checkoutSessionId: CheckoutSessionId;
    }
  /**
   * The attempt's live hold, reused for an immediate retry. `pricedFor` is set
   * when another request created it: the customer to quote its Pay state for.
   */
  | {
      readonly kind: "reused";
      readonly reservation: WorkspaceReservation;
      readonly checkoutSessionId: CheckoutSessionId;
      readonly pricedFor?: DotyposCustomerId;
    }
  /** An agent request whose earlier hold has a payment in progress, kept as is. */
  | {
      readonly kind: "payment_pending";
      readonly reservation: WorkspaceReservation;
      readonly checkoutSessionId: CheckoutSessionId;
    }
  /** Another request holds the attempt's hold creation and left nothing reusable. */
  | { readonly kind: "contended" };

interface IReservationHolds {
  /**
   * Finds, reuses, supersedes or creates the hold for one checkout attempt.
   * It never creates a second Dotypos hold for one attempt key: drafts are
   * created behind the checkout session lock, and only the request that
   * claims a draft's hold creation writes to Dotypos. A failed Dotypos write
   * or attach is compensated before the failure surfaces.
   */
  readonly holdForAttempt: (
    request: ReservationHoldRequest
  ) => Effect.Effect<
    ReservationHold,
    Effect.Error<ReturnType<typeof holdForAttempt>>
  >;
}

/**
 * The capabilities holding an attempt uses, captured when the service is
 * built. Only these are captured, so a call keeps its own log annotations,
 * spans and request references.
 */
const holdCapabilities = [
  WorkspaceReservationRepository,
  WorkspaceAvailabilityService,
  DotyposService,
  WorkspaceTableAssignmentService,
  ReservationHoldCleanupScheduleService,
  CheckoutAnalytics,
  SealedStateKeys,
] as const;

type HoldCapabilities =
  | WorkspaceReservationRepository
  | WorkspaceAvailabilityService
  | DotyposService
  | WorkspaceTableAssignmentService
  | ReservationHoldCleanupScheduleService
  | CheckoutAnalytics
  | SealedStateKeys;

/** Reservation hold acquisition for checkout attempts. */
export class ReservationHolds extends Context.Service<
  ReservationHolds,
  IReservationHolds
>()("ReservationHolds") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const context = Context.pick(...holdCapabilities)(
        yield* Effect.context<HoldCapabilities>()
      );
      return ReservationHolds.of({
        holdForAttempt: (request) =>
          holdForAttempt(request).pipe(
            Effect.scoped,
            Effect.provideContext(context)
          ),
      });
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceReservationRepository.Live,
        WorkspaceAvailabilityService.Live,
        WorkspaceTableAssignmentService.Default.pipe(
          Layer.provide(WorkspaceReservationRepository.Live),
          Layer.provide(WorkspaceDotyposLayer)
        ),
        ReservationHoldCleanupScheduleService.Live,
        CheckoutAnalytics.Live,
        WorkspaceDotyposLayer,
        SealedStateKeys.Default
      )
    )
  );
}

const holdForAttempt = Effect.fn("ReservationHolds.holdForAttempt")(function* (
  request: ReservationHoldRequest
) {
  const { booking } = request;
  const reservation = request.reservation;
  const reservations = yield* WorkspaceReservationRepository;
  const dotypos = yield* DotyposService;
  const checkoutAnalytics = yield* CheckoutAnalytics;

  const releaseHoldCreation = (reservationId: WorkspaceReservationId) =>
    reservations.releaseHoldCreation(reservationId).pipe(
      Effect.tapError((releaseCause) =>
        Effect.logError("Reservation hold creation release failed", {
          cause: releaseCause,
        })
      ),
      Effect.ignore
    );

  const checkout: AgentCheckout =
    booking.agent === undefined
      ? {
          kind: "attempt",
          checkoutSessionId: request.checkout.sessionId,
          checkoutAttemptId: request.checkout.attemptId,
        }
      : yield* resolveAgentCheckout({
          selectionKey: booking.agent.selectionKey,
          clientId: booking.agent.clientId,
          authorAccountId: booking.author,
          checkoutSessionId: request.checkout.sessionId,
          reservation,
        });
  if (checkout.kind === "payment_pending") {
    return {
      kind: "payment_pending",
      reservation: checkout.reservation,
      checkoutSessionId: checkout.checkoutSessionId,
    } satisfies ReservationHold;
  }

  const holdExpiresAt = getReservationHoldExpiresAt(
    booking.agent === undefined ? Temporal.Now.instant() : booking.bookedAt
  );

  const preparedDraft = yield* prepareReservationDraft({
    checkoutSessionId: checkout.checkoutSessionId,
    checkoutAttemptId: checkout.checkoutAttemptId,
    reservation,
    draft: {
      dotyposCustomerId: booking.customer,
      authorAccountId: booking.author,
      ...(booking.agent && {
        agentClientId: booking.agent.clientId,
        agentSelectionKey: booking.agent.selectionKey,
      }),
      reservationPurpose: booking.purpose,
      reservationDetails: getStoredWorkspaceReservationDetails(reservation),
      locale: booking.locale,
      reservationHoldExpiresAt: holdExpiresAt,
    },
  }).pipe(
    Effect.tap(() =>
      checkoutAnalytics.availabilityResult({
        checkoutAttemptId: request.checkout.attemptId,
        result: "available",
        timestamp: Temporal.Now.instant(),
      })
    ),
    Effect.tapError((error) =>
      Match.value(error).pipe(
        Match.tag("WorkspaceTableUnavailableError", () =>
          checkoutAnalytics.availabilityResult({
            checkoutAttemptId: request.checkout.attemptId,
            result: "unavailable",
            timestamp: Temporal.Now.instant(),
          })
        ),
        Match.orElse(() => Effect.void)
      )
    )
  );

  /**
   * Another request claimed the draft's hold creation: reuses the hold it
   * created for an immediate retry, or reports the conflict.
   */
  const resumeClaimConflict = Effect.fnUntraced(function* (
    reservationDraft: WorkspaceReservation,
    checkoutSessionId: CheckoutSessionId
  ) {
    const claimConflictReservation = yield* waitForPendingReservationTransition(
      {
        reservations,
        reservationId: reservationDraft.id,
      }
    );
    yield* Effect.annotateLogsScoped({ claimConflictReservation });

    if (
      claimConflictReservation &&
      isReusableSubmissionReservation(claimConflictReservation)
    ) {
      yield* Effect.logInfo(
        "Existing workspace reservation hold reused for an immediate retry"
      );

      const pricedFor = yield* getDotyposCustomerId(
        claimConflictReservation.dotyposCustomerId
      );

      yield* reservations.updateReservationDetails({
        id: claimConflictReservation.id,
        reservationDetails: getStoredWorkspaceReservationDetails(reservation),
        locale: booking.locale,
      });
      yield* checkoutAnalytics.reservationStarted({
        reservation: claimConflictReservation,
        timestamp: claimConflictReservation.createdAt,
      });
      yield* Effect.logInfo("Workspace reservation checkout prep ready");

      return {
        kind: "reused",
        reservation: claimConflictReservation,
        checkoutSessionId,
        pricedFor,
      } satisfies ReservationHold;
    }

    yield* Effect.logError("Workspace reservation hold creation claim failed");

    return { kind: "contended" } satisfies ReservationHold;
  });

  /** Resumes the draft's hold, or creates it in Dotypos and attaches it. */
  const holdReservationDraft = Effect.fnUntraced(function* ({
    checkoutSessionId,
    reservationDraft,
  }: typeof preparedDraft) {
    yield* Effect.annotateLogsScoped({ reservationDraft });

    // A draft another account authored isn't this account's to resume.
    if (reservationDraft.authorAccountId !== booking.author) {
      return yield* new CheckoutAttemptUnavailableError({
        reservation: reservationDraft,
      });
    }
    yield* Effect.logInfo("Workspace reservation draft ready");

    if (isReusableSubmissionReservation(reservationDraft)) {
      yield* Effect.logInfo(
        "Existing workspace reservation hold reused for an immediate retry"
      );
      yield* reservations.updateReservationDetails({
        id: reservationDraft.id,
        reservationDetails: getStoredWorkspaceReservationDetails(reservation),
        locale: booking.locale,
      });
      yield* checkoutAnalytics.reservationStarted({
        reservation: reservationDraft,
        timestamp: reservationDraft.createdAt,
      });
      yield* Effect.logInfo("Workspace reservation checkout prep ready");

      return {
        kind: "reused",
        reservation: reservationDraft,
        checkoutSessionId,
      } satisfies ReservationHold;
    }

    const claimed = yield* reservations.claimHoldCreation(reservationDraft.id);
    if (!claimed) {
      return yield* resumeClaimConflict(reservationDraft, checkoutSessionId);
    }
    yield* Effect.logDebug("Workspace reservation hold creation claimed");

    const { checkoutDetails } = request;
    yield* Effect.annotateLogsScoped({ checkoutDetails });

    const dotyposReservation = yield* createWorkspaceDotyposReservation({
      paymentOrderId: reservationDraft.id,
      dotyposCustomerId: booking.customer,
      checkoutDetails,
      reservation: checkoutDetails.reservation,
      status: "NEW",
    }).pipe(
      Effect.tapError(
        Effect.fn(function* (cause) {
          yield* Effect.logError(
            "Workspace Dotypos reservation hold creation failed",
            {
              cause,
            }
          );

          yield* releaseHoldCreation(reservationDraft.id);
        })
      )
    );
    yield* Effect.annotateLogsScoped({ dotyposReservation });

    const dotyposReservationId = dotyposReservation.id;
    yield* Effect.annotateLogsScoped({ dotyposReservationId });
    yield* Effect.logInfo("Workspace Dotypos reservation hold created");

    const reservationCreatedAt = Temporal.Now.instant();

    yield* reservations
      .attachHold({
        id: reservationDraft.id,
        dotyposReservationId,
        reservationCreatedAt,
        reservationHoldExpiresAt: holdExpiresAt,
      })
      .pipe(
        Effect.catch(
          Effect.fn(function* (cause) {
            yield* Effect.logError(
              "Workspace reservation hold attach failed; cancelling Dotypos hold",
              {
                cause,
              }
            );

            yield* dotypos.cancelReservation(dotyposReservationId).pipe(
              Effect.catch(
                Effect.fn(function* (cancelCause) {
                  yield* Effect.logFatal(
                    "Workspace reservation hold attach cleanup failed",
                    {
                      reservationDraftId: reservationDraft.id,
                      dotyposReservationId,
                      cause: cancelCause,
                    }
                  );

                  yield* reservations
                    .markAttachFailedCancellationRequired({
                      id: reservationDraft.id,
                      dotyposReservationId,
                      reservationCreatedAt: Temporal.Now.instant(),
                      failureCode: "attach_failed_cancel_failed",
                    })
                    .pipe(
                      Effect.tapError((markerCause) =>
                        Effect.logFatal(
                          "Workspace reservation hold attach cleanup marker failed",
                          {
                            reservationDraftId: reservationDraft.id,
                            dotyposReservationId,
                            cause: markerCause,
                          }
                        )
                      )
                    );

                  yield* Effect.logWarning(
                    "Workspace reservation hold cancellation marked for retry",
                    {
                      reservationDraftId: reservationDraft.id,
                      dotyposReservationId,
                    }
                  );
                  return yield* cancelCause;
                })
              )
            );
            yield* releaseHoldCreation(reservationDraft.id);

            return yield* cause;
          })
        )
      );
    yield* Effect.logInfo("Workspace reservation hold attached");
    yield* enqueueReservationHoldCleanup({
      orderId: reservationDraft.id,
      reservationHoldExpiresAt: holdExpiresAt,
    });
    yield* checkoutAnalytics.reservationStarted({
      reservation: { id: reservationDraft.id },
      timestamp: reservationCreatedAt,
    });

    yield* Effect.logInfo("Workspace reservation checkout prep ready");

    return {
      kind: "created",
      reservationId: reservationDraft.id,
      checkoutSessionId,
    } satisfies ReservationHold;
  });

  return yield* holdReservationDraft(preparedDraft);
});

const getReservationHoldExpiresAt = (now: Temporal.Instant) =>
  now.add({ milliseconds: payStateDefaultTtlMilliseconds });

const decodeDotyposCustomerId = Schema.decodeUnknownEffect(
  dotyposCustomerIdSchema
);

export const getDotyposCustomerId = Effect.fn(
  "prepareWorkspacePayState.getDotyposCustomerId"
)((value: string | undefined) =>
  decodeDotyposCustomerId(value).pipe(
    Effect.mapError(
      () =>
        new MissingDotyposId({
          entity: "customer",
          message: "Dotypos customer is missing a valid ID",
        })
    )
  )
);

const isReusableSubmissionReservation = (reservation: WorkspaceReservation) =>
  reservation.reservationState === "held" &&
  reservation.paymentState === "not_started" &&
  Boolean(reservation.dotyposReservationId) &&
  (!reservation.reservationHoldExpiresAt ||
    Temporal.Instant.compare(
      reservation.reservationHoldExpiresAt,
      Temporal.Now.instant()
    ) > 0);

/**
 * A session's current reservation another account authored is never this
 * account's to supersede: the submission starts its own session instead.
 */
const isAnotherAccountsReservation = (
  reservation: WorkspaceReservation,
  authorAccountId: CustomerAccountId | null
) =>
  reservation.authorAccountId !== null &&
  reservation.authorAccountId !== authorAccountId;

const mustRotateCheckoutSession = (reservation: WorkspaceReservation) =>
  reservation.reservationState !== "held" ||
  !supersedableReservationPaymentStates.some(
    (paymentState) => paymentState === reservation.paymentState
  );

const enqueueReservationHoldCleanup = Effect.fn(
  "preparePayState.enqueueReservationHoldCleanup"
)(function* (input: {
  readonly orderId: WorkspaceReservationId;
  readonly reservationHoldExpiresAt: Temporal.Instant | null;
}) {
  if (!input.reservationHoldExpiresAt) {
    yield* Effect.logWarning(
      "Workspace reservation hold cleanup enqueue skipped: missing hold expiry",
      { orderId: input.orderId }
    );
    return;
  }

  const cleanupSchedule = yield* ReservationHoldCleanupScheduleService;
  const enqueue = cleanupSchedule
    .enqueueCleanup({
      orderId: input.orderId,
      reservationHoldExpiresAt: input.reservationHoldExpiresAt,
    })
    .pipe(
      Effect.tapError((cause) =>
        Effect.logError("Workspace reservation hold cleanup enqueue failed", {
          orderId: input.orderId,
          cause,
        })
      )
    );

  yield* enqueue.pipe(
    Effect.timeoutOrElse({
      duration: Duration.seconds(2),
      orElse: () =>
        Effect.logWarning(
          "Workspace reservation hold cleanup enqueue timed out",
          {
            orderId: input.orderId,
          }
        ),
    }),
    Effect.ignore
  );
});

class PendingReservationTransition extends Data.TaggedError(
  "PendingReservationTransition"
)<{
  readonly reservation: WorkspaceReservation;
}> {}

const pendingHoldCreationRetryPolicy = Schedule.exponential("250 millis").pipe(
  Schedule.modifyDelay((_, delay) =>
    Effect.succeed(Duration.min(delay, Duration.seconds(5)))
  ),
  Schedule.collectWhile(
    (metadata) =>
      metadata.elapsed < 40_000 &&
      Predicate.isTagged(metadata.input, "PendingReservationTransition")
  )
);

const waitForPendingReservationTransition = Effect.fn(
  "preparePayState.waitForPendingReservationTransition"
)(function* (input: {
  readonly reservations: IWorkspaceReservationRepository;
  readonly reservationId: WorkspaceReservationId;
  readonly pendingStates?: readonly WorkspaceReservation["reservationState"][];
}) {
  const pendingStates = input.pendingStates ?? ["creating_hold", "cancelling"];
  const findSettledReservation = input.reservations
    .findById(input.reservationId)
    .pipe(
      Effect.flatMap((reservation) => {
        if (
          !reservation ||
          !pendingStates.includes(reservation.reservationState)
        ) {
          return Effect.succeed(reservation);
        }

        return Effect.logWarning(
          "Waiting for in-flight workspace reservation transition"
        ).pipe(
          Effect.andThen(
            Effect.fail(new PendingReservationTransition({ reservation }))
          )
        );
      })
    );

  return yield* findSettledReservation.pipe(
    Effect.retry(pendingHoldCreationRetryPolicy),
    Effect.catchTag("PendingReservationTransition", (error) =>
      Effect.succeed(error.reservation)
    )
  );
});

class CheckoutAttemptUnavailableError extends Data.TaggedError(
  "CheckoutAttemptUnavailableError"
)<{
  readonly reservation: WorkspaceReservation;
}> {}

const ensureReservationAvailable = (input: {
  readonly availability: typeof WorkspaceAvailabilityService.Service;
  readonly reservation: PreparePayStateInput["reservation"];
}) =>
  Match.value(input.reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (reservation) =>
        ensureCoworkPayStateAvailable({
          availability: input.availability,
          reservation,
        }),
      "meeting-room": (reservation) =>
        ensureMeetingRoomPayStateAvailable({
          availability: input.availability,
          reservation,
        }),
      office: (reservation) =>
        ensureOfficePayStateAvailable({
          availability: input.availability,
          reservation,
        }),
    })
  );

/**
 * Cancels the Dotypos hold of a reservation claimed for supersession. A hold
 * Dotypos no longer keeps pending is never cancelled. A failed cancellation
 * is recorded on the reservation and yields false.
 */
const cancelSupersededHold = Effect.fn("preparePayState.cancelSupersededHold")(
  function* (input: {
    readonly reservationId: WorkspaceReservationId;
    readonly dotyposReservationId: DotyposReservationId;
  }) {
    const holdRelease = yield* DotyposHoldRelease;
    const { reservationId, dotyposReservationId } = input;
    return yield* holdRelease
      .release({
        reservationId,
        dotyposReservationId,
        liveStatus: "require_new",
        failureCode: "checkout_supersession_cancel_failed",
      })
      .pipe(
        Effect.flatMap((release) =>
          Predicate.isString(release)
            ? Effect.succeed(true)
            : Effect.logError(
                "Checkout supersession refused to cancel a non-pending Dotypos reservation",
                { reservationId, dotyposReservationId, status: release.refused }
              ).pipe(Effect.as(false))
        ),
        Effect.catch((cause) =>
          Effect.logError("Checkout supersession Dotypos cancellation failed", {
            reservationId,
            dotyposReservationId,
            cause,
          }).pipe(Effect.as(false))
        )
      );
  },
  Effect.provide(DotyposHoldRelease.Default)
);

/** A reservation whose hold creation or cancellation is still in flight. */
const isHoldTransitionPending = (
  reservation: WorkspaceReservation | null | undefined
): reservation is WorkspaceReservation & {
  readonly reservationState: "creating_hold" | "cancelling";
} =>
  reservation?.reservationState === "creating_hold" ||
  reservation?.reservationState === "cancelling";

/** A session's current reservation still on its way to a hold or an end. */
const isSessionReservationPending = (
  reservation: WorkspaceReservation | null | undefined
): reservation is WorkspaceReservation & {
  readonly reservationState: "draft" | "creating_hold" | "cancelling";
} =>
  isHoldTransitionPending(reservation) ||
  reservation?.reservationState === "draft";

type ReservationDraftRequest = {
  readonly checkoutSessionId: CheckoutSessionId;
  readonly checkoutAttemptId: CheckoutAttemptId;
  readonly reservation: PreparePayStateInput["reservation"];
  readonly draft: Omit<
    CreateWorkspaceReservationInput,
    "checkoutSessionKey" | "checkoutAttemptKey"
  >;
};

type ReservationDraftServices = {
  readonly reservations: IWorkspaceReservationRepository;
  readonly availability: typeof WorkspaceAvailabilityService.Service;
};

type CheckoutSessionKeys = Effect.Success<
  ReturnType<typeof deriveCheckoutSessionKeys>
>;
type CheckoutAttemptKeys = Effect.Success<
  ReturnType<typeof deriveCheckoutAttemptKeys>
>;

/**
 * One pass of draft preparation: the attempt's draft is ready, or the
 * preparation looks again, in the same or a rotated checkout session.
 */
type ReservationDraftStep =
  | {
      readonly kind: "prepared";
      readonly checkoutSessionId: CheckoutSessionId;
      readonly reservationDraft: WorkspaceReservation;
    }
  | {
      readonly kind: "retry";
      readonly checkoutSessionId: CheckoutSessionId;
    };

/**
 * Moves a submission whose session can't take its attempt into the attempt's
 * own session. A submission already there is refused.
 */
const rotateCheckoutSession = (input: {
  readonly checkoutSessionId: CheckoutSessionId;
  readonly checkoutAttemptId: CheckoutAttemptId;
  readonly reservation: WorkspaceReservation;
}) =>
  input.checkoutSessionId ===
  promoteCheckoutAttemptToSessionId(input.checkoutAttemptId)
    ? Effect.fail(
        new CheckoutAttemptUnavailableError({ reservation: input.reservation })
      )
    : Effect.succeed({
        kind: "retry",
        checkoutSessionId: promoteCheckoutAttemptToSessionId(
          input.checkoutAttemptId
        ),
      } satisfies ReservationDraftStep);

/** The attempt's own reservation, once no hold transition is in flight. */
const findSettledAttemptReservation = Effect.fnUntraced(function* (
  reservations: IWorkspaceReservationRepository,
  checkoutAttemptKeys: CheckoutAttemptKeys
) {
  let existingAttempt = yield* reservations.findByAttemptKeys(
    checkoutAttemptKeys.accepted
  );
  if (isHoldTransitionPending(existingAttempt)) {
    existingAttempt = yield* waitForPendingReservationTransition({
      reservations,
      reservationId: existingAttempt.id,
    });
  }

  if (isHoldTransitionPending(existingAttempt)) {
    return yield* new CheckoutAttemptUnavailableError({
      reservation: existingAttempt,
    });
  }
  return existingAttempt;
});

/** Resumes the attempt's own reservation, rotates past it, or refuses it. */
const continueExistingAttempt = Effect.fnUntraced(function* (
  request: ReservationDraftRequest,
  checkoutSessionId: CheckoutSessionId,
  existingAttempt: WorkspaceReservation
) {
  if (
    existingAttempt.reservationState === "draft" ||
    (isReusableSubmissionReservation(existingAttempt) &&
      !mustRotateCheckoutSession(existingAttempt))
  ) {
    return {
      kind: "prepared",
      checkoutSessionId,
      reservationDraft: existingAttempt,
    } satisfies ReservationDraftStep;
  }

  if (mustRotateCheckoutSession(existingAttempt)) {
    return yield* rotateCheckoutSession({
      checkoutSessionId,
      checkoutAttemptId: request.checkoutAttemptId,
      reservation: existingAttempt,
    });
  }

  return yield* new CheckoutAttemptUnavailableError({
    reservation: existingAttempt,
  });
});

/** Waits out the session's in-flight reservation, then looks again. */
const awaitSessionReservation = Effect.fnUntraced(function* (
  reservations: IWorkspaceReservationRepository,
  checkoutSessionId: CheckoutSessionId,
  currentReservation: WorkspaceReservation
) {
  const settledReservation = yield* waitForPendingReservationTransition({
    reservations,
    reservationId: currentReservation.id,
    pendingStates: ["draft", "creating_hold", "cancelling"],
  });
  if (isSessionReservationPending(settledReservation)) {
    return yield* new CheckoutAttemptUnavailableError({
      reservation: settledReservation,
    });
  }
  return { kind: "retry", checkoutSessionId } satisfies ReservationDraftStep;
});

/**
 * Cancels the session's current hold and creates the attempt's draft in its
 * place. A hold whose cancellation fails is left to its own session, and the
 * attempt moves to a rotated one.
 */
const supersedeSessionReservation = Effect.fnUntraced(function* (input: {
  readonly services: ReservationDraftServices;
  readonly request: ReservationDraftRequest;
  readonly checkoutSessionId: CheckoutSessionId;
  readonly currentReservation: WorkspaceReservation;
  readonly checkoutSessionKey: CheckoutSessionKeys["current"];
  readonly checkoutAttemptKey: CheckoutAttemptKeys["current"];
}) {
  const { reservations, availability } = input.services;
  const { checkoutSessionId, request } = input;
  const claimed = yield* reservations.claimSupersessionCancellation(
    input.currentReservation.id
  );
  if (!claimed) {
    return { kind: "retry", checkoutSessionId } satisfies ReservationDraftStep;
  }

  const dotyposReservationId = claimed.dotyposReservationId;
  if (!dotyposReservationId) {
    return yield* new CheckoutAttemptUnavailableError({
      reservation: claimed,
    });
  }

  const cancelled = yield* cancelSupersededHold({
    reservationId: claimed.id,
    dotyposReservationId,
  });
  if (!cancelled) {
    return yield* rotateCheckoutSession({
      checkoutSessionId,
      checkoutAttemptId: request.checkoutAttemptId,
      reservation: claimed,
    });
  }

  const cancelledAt = Temporal.Now.instant();
  return yield* ensureReservationAvailable({
    availability,
    reservation: request.reservation,
  }).pipe(
    Effect.andThen(
      reservations.completeSupersessionAndCreateDraft({
        cancelledReservationId: claimed.id,
        cancelledAt,
        replacement: {
          ...request.draft,
          checkoutSessionKey: input.checkoutSessionKey,
          checkoutAttemptKey: input.checkoutAttemptKey,
        },
      })
    ),
    Effect.map(
      (reservationDraft) =>
        ({
          kind: "prepared",
          checkoutSessionId,
          reservationDraft,
        }) satisfies ReservationDraftStep
    ),
    Effect.tapError(() =>
      reservations
        .markCancelled({ id: claimed.id, cancelledAt })
        .pipe(Effect.ignore)
    )
  );
});

/**
 * Settles the session's current reservation: waits out one in flight,
 * rotates past one the submission may not supersede, or supersedes it.
 */
const resolveSessionReservation = Effect.fnUntraced(function* (input: {
  readonly services: ReservationDraftServices;
  readonly request: ReservationDraftRequest;
  readonly checkoutSessionId: CheckoutSessionId;
  readonly currentReservation: WorkspaceReservation;
  readonly checkoutSessionKey: CheckoutSessionKeys["current"];
  readonly checkoutAttemptKey: CheckoutAttemptKeys["current"];
}) {
  const { checkoutSessionId, currentReservation } = input;
  if (isSessionReservationPending(currentReservation)) {
    return yield* awaitSessionReservation(
      input.services.reservations,
      checkoutSessionId,
      currentReservation
    );
  }

  if (
    mustRotateCheckoutSession(currentReservation) ||
    isAnotherAccountsReservation(
      currentReservation,
      input.request.draft.authorAccountId
    )
  ) {
    yield* Effect.logInfo(
      "Checkout session rotated before reservation creation",
      {
        previousReservationId: currentReservation.id,
        previousReservationState: currentReservation.reservationState,
        previousPaymentState: currentReservation.paymentState,
      }
    );
    return yield* rotateCheckoutSession({
      checkoutSessionId,
      checkoutAttemptId: input.request.checkoutAttemptId,
      reservation: currentReservation,
    });
  }

  return yield* supersedeSessionReservation(input);
});

/** Creates the attempt's draft in a session with no current reservation. */
const createSessionDraft = Effect.fnUntraced(function* (input: {
  readonly services: ReservationDraftServices;
  readonly request: ReservationDraftRequest;
  readonly checkoutSessionId: CheckoutSessionId;
  readonly checkoutSessionKeys: CheckoutSessionKeys;
  readonly checkoutAttemptKeys: CheckoutAttemptKeys;
  readonly checkoutSessionKey: CheckoutSessionKeys["current"];
}) {
  const { reservations, availability } = input.services;
  const { checkoutSessionId, checkoutAttemptKeys, request } = input;
  yield* ensureReservationAvailable({
    availability,
    reservation: request.reservation,
  });
  const reservationDraft = yield* reservations.createDraft({
    ...request.draft,
    checkoutSessionKey: input.checkoutSessionKey,
    checkoutAttemptKey: checkoutAttemptKeys.current,
    checkoutSessionLockKey: deriveCheckoutSessionLockKey(checkoutSessionId),
    acceptedCheckoutSessionKeys: input.checkoutSessionKeys.accepted,
    acceptedCheckoutAttemptKeys: checkoutAttemptKeys.accepted,
  });
  // Another worker may have created this attempt under a different
  // active key or lookup-key format; any other row is the session's
  // current reservation.
  if (
    !checkoutAttemptKeys.accepted.includes(reservationDraft.checkoutAttemptKey)
  ) {
    return { kind: "retry", checkoutSessionId } satisfies ReservationDraftStep;
  }

  return {
    kind: "prepared",
    checkoutSessionId,
    reservationDraft,
  } satisfies ReservationDraftStep;
});

/**
 * One pass over a checkout session: resumes the attempt's own reservation,
 * settles the session's current one, or drafts the attempt.
 */
const prepareDraftInSession = Effect.fnUntraced(function* (
  services: ReservationDraftServices,
  request: ReservationDraftRequest,
  checkoutSessionId: CheckoutSessionId
) {
  const { reservations } = services;
  const checkoutSessionKeys =
    yield* deriveCheckoutSessionKeys(checkoutSessionId);
  const checkoutAttemptKeys = yield* deriveCheckoutAttemptKeys({
    checkoutSessionId,
    checkoutAttemptId: request.checkoutAttemptId,
    reservation: request.reservation,
  });

  const existingAttempt = yield* findSettledAttemptReservation(
    reservations,
    checkoutAttemptKeys
  );
  if (existingAttempt) {
    return yield* continueExistingAttempt(
      request,
      checkoutSessionId,
      existingAttempt
    );
  }

  // Rows of one session keep the key stored by its first row, so a
  // session that spans a Pay-state key rotation still groups as one.
  const checkoutSessionKey =
    (yield* reservations.findStoredCheckoutSessionKey(
      checkoutSessionKeys.accepted
    )) ?? checkoutSessionKeys.current;
  const currentReservation =
    yield* reservations.findCurrentByCheckoutSessionKey(checkoutSessionKey);
  if (currentReservation) {
    return yield* resolveSessionReservation({
      services,
      request,
      checkoutSessionId,
      currentReservation,
      checkoutSessionKey,
      checkoutAttemptKey: checkoutAttemptKeys.current,
    });
  }

  return yield* createSessionDraft({
    services,
    request,
    checkoutSessionId,
    checkoutSessionKeys,
    checkoutAttemptKeys,
    checkoutSessionKey,
  });
});

const prepareReservationDraft = Effect.fn(
  "preparePayState.prepareReservationDraft"
)(function* (input: ReservationDraftRequest) {
  const services: ReservationDraftServices = {
    reservations: yield* WorkspaceReservationRepository,
    availability: yield* WorkspaceAvailabilityService,
  };
  let checkoutSessionId = input.checkoutSessionId;

  while (true) {
    const step = yield* prepareDraftInSession(
      services,
      input,
      checkoutSessionId
    );
    if (step.kind === "prepared") {
      return {
        checkoutSessionId: step.checkoutSessionId,
        reservationDraft: step.reservationDraft,
      };
    }
    checkoutSessionId = step.checkoutSessionId;
  }
});

/**
 * The booking instant of an agent's hold. An agent hold lasts one Pay-state
 * lifetime from it and its Pay state is issued as of it, so a repeated
 * request rebuilds the same Pay link, which never outlives the hold. Null for
 * a reservation without a hold deadline.
 */
export const getAgentHoldBookedAt = (reservation: WorkspaceReservation) =>
  reservation.reservationHoldExpiresAt?.subtract({
    milliseconds: payStateDefaultTtlMilliseconds,
  }) ?? null;

/**
 * Cancels the agent client's holds outside its own session before a request
 * starts a new attempt. The agent session's current hold is superseded as
 * usual, but once that session's reservation can't be superseded, such as a
 * paid one, every new request rotates into a fresh session, which would leave
 * the client's previous hold open beside the new one. A hold with a pending
 * or completed payment is never cancelled, nor is another client's or another
 * account's.
 */
const supersedeRotatedAgentHolds = Effect.fn(
  "preparePayState.supersedeRotatedAgentHolds"
)(function* (input: {
  readonly authorAccountId: CustomerAccountId;
  readonly agentClientId: CustomerAgentClientId;
  readonly agentCheckoutSessionId: CheckoutSessionId;
}) {
  const reservations = yield* WorkspaceReservationRepository;
  const agentSessionKeys = yield* deriveCheckoutSessionKeys(
    input.agentCheckoutSessionId
  );
  const holds = yield* reservations.findSupersedableByAgentClient({
    authorAccountId: input.authorAccountId,
    agentClientId: input.agentClientId,
  });
  const rotatedHolds = holds.filter(
    (hold) =>
      !hold.checkoutSessionKey ||
      !agentSessionKeys.accepted.includes(hold.checkoutSessionKey)
  );

  const unpaidHoldRelease = yield* UnpaidHoldRelease;
  yield* Effect.forEach(
    rotatedHolds,
    Effect.fn(function* (hold) {
      const dotyposReleaseFailed = (cause: DotyposWriteFailure) =>
        Effect.logError("Checkout supersession Dotypos cancellation failed", {
          reservationId: hold.id,
          dotyposReservationId: hold.dotyposReservationId,
          cause,
        });
      // A hold Dotypos refused or failed to cancel is left to its own
      // lifecycle, marked `cancellation_failed`.
      const released = yield* unpaidHoldRelease
        .release({ reason: "agent_rotated", reservationId: hold.id })
        .pipe(
          Effect.catchTags({
            DotyposUnavailable: dotyposReleaseFailed,
            DotyposRejected: dotyposReleaseFailed,
            DotyposUncertain: dotyposReleaseFailed,
          })
        );
      if (Predicate.hasProperty(released, "refused")) {
        yield* Effect.logError(
          "Checkout supersession refused to cancel a non-pending Dotypos reservation",
          {
            reservationId: hold.id,
            dotyposReservationId: hold.dotyposReservationId,
            status: released.refused,
          }
        );
      }
      if (Predicate.hasProperty(released, "released")) {
        yield* Effect.logInfo(
          "Agent client's hold in a rotated checkout session superseded",
          { reservationId: hold.id }
        );
      }
    }),
    { discard: true }
  );
}, Effect.provide(UnpaidHoldRelease.Default));

type AgentCheckout =
  | {
      readonly kind: "attempt";
      readonly checkoutSessionId: CheckoutSessionId;
      readonly checkoutAttemptId: CheckoutAttemptId;
    }
  | {
      readonly kind: "payment_pending";
      readonly checkoutSessionId: CheckoutSessionId;
      readonly reservation: WorkspaceReservation;
    };

/** Whether a stored lookup key is one of the keys a request accepts. */
const isAcceptedLookupKey = <Key extends string>(
  key: Key | null,
  acceptedKeys: readonly Key[]
) => Boolean(key && acceptedKeys.includes(key));

/** An agent's latest reservation once no hold transition is in flight. */
const settleLatestAgentReservation = (
  reservations: IWorkspaceReservationRepository,
  latestFound: WorkspaceReservation
) =>
  isHoldTransitionPending(latestFound)
    ? waitForPendingReservationTransition({
        reservations,
        reservationId: latestFound.id,
      }).pipe(Effect.map((settled) => settled ?? latestFound))
    : Effect.succeed(latestFound);

/** A held reservation whose payment has started and decides the booking. */
const isAwaitingPayment = (reservation: WorkspaceReservation) =>
  reservation.reservationState === "held" &&
  reservation.paymentState === "pending";

/**
 * Keeps an agent booking whose payment is pending: a repeat neither holds
 * again nor cancels. The Pay link resumes the payment until it expires, at
 * the whole second its sealed state carries; after that the repeat is
 * refused.
 */
const keepPendingAgentPayment = (
  reservation: WorkspaceReservation,
  checkoutSessionId: CheckoutSessionId
) => {
  const holdBookedAt = getAgentHoldBookedAt(reservation);
  if (
    !holdBookedAt ||
    Math.floor(
      (holdBookedAt.epochMilliseconds + payStateDefaultTtlMilliseconds) / 1000
    ) *
      1000 <=
      Temporal.Now.instant().epochMilliseconds
  ) {
    return Effect.fail(
      new AgentBookingPaymentInProgressError({ reservationId: reservation.id })
    );
  }
  return Effect.succeed({
    kind: "payment_pending",
    checkoutSessionId,
    reservation,
  } satisfies AgentCheckout);
};

/** A reservation the agent request's checkout may still resume. */
const isOpenAgentReservation = (reservation: WorkspaceReservation) =>
  reservation.reservationState === "draft" ||
  isHoldTransitionPending(reservation) ||
  isReusableSubmissionReservation(reservation);

/**
 * Where an agent booking request continues. The request's latest reservation
 * decides:
 * - An open one (a draft, an in-flight transition, or a live unpaid hold)
 *   continues under the session and attempt that created it, so the
 *   checkout's idempotency reuses it.
 * - One waiting for payment is kept as it is; once its Pay link expired the
 *   request is refused.
 * - Any other ended, and the request starts its next attempt in the agent's
 *   session, which supersedes or rotates past the session's current
 *   reservation as usual. Before it does, the client's holds in rotated
 *   sessions are cancelled, so a new selection replaces the previous hold
 *   even after the agent session holds a paid reservation.
 * An open reservation whose attempt no longer matches, such as after the
 * customer edited the profile, counts as ended when the agent session holds
 * it, and is refused until it ends when it sits in a rotated session.
 */
const resolveAgentCheckout = Effect.fn("preparePayState.resolveAgentCheckout")(
  function* (input: {
    readonly selectionKey: AgentSelectionKey;
    readonly clientId: CustomerAgentClientId;
    readonly authorAccountId: CustomerAccountId;
    readonly checkoutSessionId: CheckoutSessionId;
    readonly reservation: PreparePayStateInput["reservation"];
  }) {
    const reservations = yield* WorkspaceReservationRepository;
    const [latestFound, previous] =
      yield* reservations.findLatestByAgentSelectionKey({
        authorAccountId: input.authorAccountId,
        agentSelectionKey: input.selectionKey,
      });
    const startNextAttempt = (latest?: WorkspaceReservation) =>
      supersedeRotatedAgentHolds({
        authorAccountId: input.authorAccountId,
        agentClientId: input.clientId,
        agentCheckoutSessionId: input.checkoutSessionId,
      }).pipe(
        Effect.as({
          kind: "attempt",
          checkoutSessionId: input.checkoutSessionId,
          checkoutAttemptId: deriveAgentCheckoutAttemptId(
            input.selectionKey,
            latest?.id
          ),
        } satisfies AgentCheckout)
      );
    if (!latestFound) return yield* startNextAttempt();

    const latest = yield* settleLatestAgentReservation(
      reservations,
      latestFound
    );
    const checkoutAttemptId = deriveAgentCheckoutAttemptId(
      input.selectionKey,
      previous?.id
    );
    const agentSessionKeys = yield* deriveCheckoutSessionKeys(
      input.checkoutSessionId
    );
    const inAgentSession = isAcceptedLookupKey(
      latest.checkoutSessionKey,
      agentSessionKeys.accepted
    );
    const checkoutSessionId = inAgentSession
      ? input.checkoutSessionId
      : promoteCheckoutAttemptToSessionId(checkoutAttemptId);

    if (isAwaitingPayment(latest)) {
      return yield* keepPendingAgentPayment(latest, checkoutSessionId);
    }

    if (!isOpenAgentReservation(latest)) return yield* startNextAttempt(latest);

    const attemptKeys = yield* deriveCheckoutAttemptKeys({
      checkoutSessionId,
      checkoutAttemptId,
      reservation: input.reservation,
    });
    if (isAcceptedLookupKey(latest.checkoutAttemptKey, attemptKeys.accepted)) {
      return {
        kind: "attempt",
        checkoutSessionId,
        checkoutAttemptId,
      } satisfies AgentCheckout;
    }
    // The agent session's current reservation is superseded as usual, but a
    // hold in a rotated session would only be left behind beside a new one.
    if (!inAgentSession) {
      return yield* new CheckoutAttemptUnavailableError({
        reservation: latest,
      });
    }
    return yield* startNextAttempt(latest);
  }
);
