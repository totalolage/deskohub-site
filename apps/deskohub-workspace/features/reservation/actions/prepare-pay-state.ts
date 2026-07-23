"use server";

import {
  DotyposService,
  ValidationError as DotyposValidationError,
} from "@deskohub/dotypos";
import {
  Data,
  Duration,
  Effect,
  Layer,
  Match,
  Predicate,
  Schedule,
  Schema,
} from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { captureReservationStarted } from "@/features/checkout/backend/analytics";
import {
  buildCheckoutPayPath,
  buildSignedPayState,
  CheckoutPricingService,
  payStateDefaultTtlMilliseconds,
  sealPayStateForUrl,
} from "@/features/checkout/backend/checkout";
import { CheckoutPricingServiceLiveWithDependencies } from "@/features/checkout/backend/checkout/checkout-pricing.runtime";
import {
  deriveCheckoutAttemptKey,
  deriveCheckoutSessionKey,
} from "@/features/checkout/backend/checkout/checkout-session-key.server";
import { ReservationHoldCleanupScheduleService } from "@/features/checkout/backend/holds";
import {
  LegalEvidenceEventRepository,
  LegalEvidenceEventRepositoryLive,
} from "@/features/checkout/backend/repositories";
import {
  createWorkspaceDotyposReservation,
  splitCustomerName,
  WorkspaceCheckoutAccessCodeService,
  WorkspaceCheckoutAccessCodeServiceLive,
  WorkspaceTableAssignmentService,
} from "@/features/checkout/backend/reservation";
import type { CheckoutSummaryChangedKeys } from "@/features/checkout/checkout-quote";
import {
  legalEvidenceMapSchema,
  reservationSubmitLegalEvidenceSource,
} from "@/features/checkout/legal-evidence";
import type { CheckoutDetails } from "@/features/checkout/schemas/checkout-details";
import { type Locale, m } from "@/features/i18n";
import { getLegalAcceptanceSnapshot } from "@/features/legal/acceptance-snapshot";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import {
  type CreateWorkspaceReservationInput,
  type WorkspaceReservation,
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type DotyposCustomerId,
  dotyposCustomerIdSchema,
} from "@/features/reservation/dotypos-customer";
import { getStoredWorkspaceReservationDetails } from "@/features/reservation/persistence-contracts";
import { PostHogEventServiceLive } from "@/shared/backend/analytics/posthog-event.service";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import {
  ensureCoworkPayStateAvailable,
  getPreparedCoworkCheckoutDetails,
  type PreparedCoworkAdvertisement,
  type PreparedCoworkPayState,
  prepareCoworkAdvertisement,
} from "./prepare-cowork-pay-state";
import {
  ensureMeetingRoomPayStateAvailable,
  getPreparedMeetingRoomCheckoutDetails,
  type PreparedMeetingRoomAdvertisement,
  type PreparedMeetingRoomPayState,
  prepareMeetingRoomAdvertisement,
} from "./prepare-meeting-room-pay-state";
import {
  type PreparePayStateInput,
  preparePayStateSchema,
} from "./prepare-pay-state.schema";

const decodeLegalEvidenceMap = Schema.decodeUnknownSync(
  legalEvidenceMapSchema,
  {
    onExcessProperty: "error",
  }
);

const getReservationHoldExpiresAt = (now: Temporal.Instant) =>
  now.add({ milliseconds: payStateDefaultTtlMilliseconds });

type PreparedAdvertisement =
  | PreparedCoworkAdvertisement
  | PreparedMeetingRoomAdvertisement;

const prepareAdvertisement = Effect.fn("preparePayState.prepareAdvertisement")(
  (input: PreparePayStateInput) =>
    Match.value(input).pipe(
      Match.when(
        { reservation: { kind: "cowork" } },
        prepareCoworkAdvertisement
      ),
      Match.when(
        { reservation: { kind: "meeting-room" } },
        prepareMeetingRoomAdvertisement
      ),
      Match.exhaustive
    )
);

const quotePreparedReservation = Effect.fn(
  "preparePayState.quotePreparedReservation"
)(function* (input: {
  readonly advertisement: PreparedAdvertisement;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
}) {
  const pricing = yield* CheckoutPricingService;

  return yield* pricing.quoteForCustomer({
    ...input.advertisement,
    dotyposCustomerId: input.dotyposCustomerId,
    locale: input.locale,
    affirmedAdvertisement: input.advertisement.discountQuote,
  });
});

const DotyposEntityWithIdSchema = Schema.Struct({
  id: Schema.NonEmptyString,
});

const decodeDotyposEntityId = Effect.fn(
  "preparePayState.decodeDotyposEntityId"
)(function* (input: {
  readonly value: unknown;
  readonly missingIdMessage: string;
}) {
  const entity = yield* Schema.decodeUnknownEffect(DotyposEntityWithIdSchema)(
    input.value
  ).pipe(
    Effect.mapError(
      () =>
        new DotyposValidationError({
          message: input.missingIdMessage,
        })
    )
  );

  return entity.id;
});

const decodeDotyposCustomerId = Schema.decodeUnknownEffect(
  dotyposCustomerIdSchema
);

const getDotyposCustomerId = Effect.fn(
  "prepareWorkspacePayState.getDotyposCustomerId"
)((value: unknown) =>
  decodeDotyposCustomerId(value).pipe(
    Effect.mapError(
      () =>
        new DotyposValidationError({
          message: "Dotypos customer is missing a valid ID",
        })
    )
  )
);

type PreparedPayState = PreparedCoworkPayState | PreparedMeetingRoomPayState;

const getReservationCheckoutDetails = (input: {
  readonly locale: Locale;
  readonly prepared: PreparedPayState;
  readonly legalEvidence: CheckoutDetails["legal"];
}): CheckoutDetails =>
  Match.value(input.prepared).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (prepared) =>
        getPreparedCoworkCheckoutDetails({ ...input, prepared }),
      "meeting-room": (prepared) =>
        getPreparedMeetingRoomCheckoutDetails({ ...input, prepared }),
    })
  );

const getReservationPrivacyEvidence = Effect.fn(
  "preparePayState.getReservationPrivacyEvidence"
)(function* (input: {
  readonly locale: Locale;
  readonly accepted: boolean;
  readonly acceptedAt: string;
}) {
  const documents = yield* getLegalAcceptanceSnapshot(input.locale);
  return decodeLegalEvidenceMap({
    [documents.privacyPolicy.hash]: {
      documentKey: "privacyPolicy",
      documentHash: documents.privacyPolicy.hash,
      accepted: input.accepted,
      acceptedAt: input.acceptedAt,
      locale: input.locale,
      source: reservationSubmitLegalEvidenceSource,
      document: {
        path: documents.privacyPolicy.path,
        hash: documents.privacyPolicy.hash,
        hashAlgorithm: documents.privacyPolicy.hashAlgorithm,
      },
    },
  });
});

const toReadyResult = Effect.fn("preparePayState.toReadyResult")(
  function* (input: {
    readonly locale: Locale;
    readonly prepared: PreparedPayState;
    readonly reservationId: string;
    readonly checkoutSessionId: string;
    readonly changedKeys?: CheckoutSummaryChangedKeys;
  }) {
    const state = yield* buildSignedPayState({
      ...input.prepared,
      locale: input.locale,
      orderId: input.reservationId,
      checkoutSessionId: input.checkoutSessionId,
      changedKeys: input.changedKeys,
    });
    const sealedState = yield* sealPayStateForUrl(state);
    const redirectUrl = buildCheckoutPayPath(input.locale, sealedState, {
      orderId: input.reservationId,
    });

    if (input.changedKeys) {
      return {
        status: "pricing_changed" as const,
        redirectUrl,
        affectedProductKeys: input.changedKeys.itemKeys.flatMap((key) =>
          key.startsWith("product:") ? [key] : []
        ),
      };
    }

    return {
      status: "ready" as const,
      redirectUrl,
    };
  }
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

const mustRotateCheckoutSession = (reservation: WorkspaceReservation) =>
  reservation.paymentState === "pending" ||
  reservation.paymentState === "paid" ||
  reservation.reservationState !== "held";

const enqueueReservationHoldCleanup = Effect.fn(
  "preparePayState.enqueueReservationHoldCleanup"
)(function* (input: {
  readonly orderId: string;
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
  readonly reservations: WorkspaceReservationRepository;
  readonly reservationId: string;
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
    })
  );

const prepareReservationDraft = Effect.fn(
  "preparePayState.prepareReservationDraft"
)(function* (input: {
  readonly checkoutSessionId: string;
  readonly checkoutAttemptId: string;
  readonly reservation: PreparePayStateInput["reservation"];
  readonly draft: Omit<
    CreateWorkspaceReservationInput,
    "checkoutSessionKey" | "checkoutAttemptKey"
  >;
}) {
  const reservations = yield* WorkspaceReservationRepository;
  const dotypos = yield* DotyposService;
  const availability = yield* WorkspaceAvailabilityService;
  let checkoutSessionId = input.checkoutSessionId;

  while (true) {
    const checkoutSessionKey = deriveCheckoutSessionKey(checkoutSessionId);
    const checkoutAttemptKey = deriveCheckoutAttemptKey({
      checkoutSessionId,
      checkoutAttemptId: input.checkoutAttemptId,
      reservation: input.reservation,
    });

    let existingAttempt =
      yield* reservations.findByAttemptKey(checkoutAttemptKey);
    if (
      existingAttempt?.reservationState === "creating_hold" ||
      existingAttempt?.reservationState === "cancelling"
    ) {
      existingAttempt = yield* waitForPendingReservationTransition({
        reservations,
        reservationId: existingAttempt.id,
      });
    }

    if (
      existingAttempt?.reservationState === "creating_hold" ||
      existingAttempt?.reservationState === "cancelling"
    ) {
      return yield* new CheckoutAttemptUnavailableError({
        reservation: existingAttempt,
      });
    }

    if (existingAttempt) {
      if (
        existingAttempt.reservationState === "draft" ||
        (isReusableSubmissionReservation(existingAttempt) &&
          !mustRotateCheckoutSession(existingAttempt))
      ) {
        return {
          checkoutSessionId,
          reservationDraft: existingAttempt,
        };
      }

      if (mustRotateCheckoutSession(existingAttempt)) {
        if (checkoutSessionId === input.checkoutAttemptId) {
          return yield* new CheckoutAttemptUnavailableError({
            reservation: existingAttempt,
          });
        }
        checkoutSessionId = input.checkoutAttemptId;
        continue;
      }

      return yield* new CheckoutAttemptUnavailableError({
        reservation: existingAttempt,
      });
    }

    const currentReservation =
      yield* reservations.findCurrentByCheckoutSessionKey(checkoutSessionKey);
    if (
      currentReservation?.reservationState === "creating_hold" ||
      currentReservation?.reservationState === "cancelling" ||
      currentReservation?.reservationState === "draft"
    ) {
      const settledReservation = yield* waitForPendingReservationTransition({
        reservations,
        reservationId: currentReservation.id,
        pendingStates: ["draft", "creating_hold", "cancelling"],
      });
      if (
        settledReservation?.reservationState === "draft" ||
        settledReservation?.reservationState === "creating_hold" ||
        settledReservation?.reservationState === "cancelling"
      ) {
        return yield* new CheckoutAttemptUnavailableError({
          reservation: settledReservation,
        });
      }
      continue;
    }

    if (currentReservation && mustRotateCheckoutSession(currentReservation)) {
      yield* Effect.logInfo(
        "Checkout session rotated before reservation creation",
        {
          previousReservationId: currentReservation.id,
          previousReservationState: currentReservation.reservationState,
          previousPaymentState: currentReservation.paymentState,
        }
      );
      if (checkoutSessionId === input.checkoutAttemptId) {
        return yield* new CheckoutAttemptUnavailableError({
          reservation: currentReservation,
        });
      }
      checkoutSessionId = input.checkoutAttemptId;
      continue;
    }

    if (currentReservation) {
      const claimed = yield* reservations.claimSupersessionCancellation(
        currentReservation.id
      );
      if (!claimed) {
        continue;
      }

      const dotyposReservationId = claimed.dotyposReservationId;
      if (!dotyposReservationId) {
        return yield* new CheckoutAttemptUnavailableError({
          reservation: claimed,
        });
      }

      const cancelled = yield* Effect.gen(function* () {
        const status =
          yield* dotypos.getReservationStatus(dotyposReservationId);
        if (status === "CANCELLED") return true;
        if (status !== "NEW") {
          yield* Effect.logError(
            "Checkout supersession refused to cancel a non-pending Dotypos reservation",
            {
              reservationId: claimed.id,
              dotyposReservationId,
              status,
            }
          );
          return false;
        }

        yield* dotypos.cancelReservation(dotyposReservationId);
        return true;
      }).pipe(
        Effect.catch(
          Effect.fn(function* (cause) {
            yield* Effect.logError(
              "Checkout supersession Dotypos cancellation failed",
              {
                reservationId: claimed.id,
                dotyposReservationId,
                cause,
              }
            );
            return false;
          })
        )
      );

      if (!cancelled) {
        yield* reservations
          .markCancellationFailed({
            id: claimed.id,
            failureCode: "checkout_supersession_cancel_failed",
          })
          .pipe(
            Effect.tapError((cause) =>
              Effect.logError(
                "Checkout supersession cancellation failure marker failed",
                { reservationId: claimed.id, cause }
              )
            ),
            Effect.ignore
          );
        if (checkoutSessionId === input.checkoutAttemptId) {
          return yield* new CheckoutAttemptUnavailableError({
            reservation: claimed,
          });
        }
        checkoutSessionId = input.checkoutAttemptId;
        continue;
      }

      const cancelledAt = Temporal.Now.instant();
      return yield* ensureReservationAvailable({
        availability,
        reservation: input.reservation,
      }).pipe(
        Effect.andThen(
          reservations.completeSupersessionAndCreateDraft({
            cancelledReservationId: claimed.id,
            cancelledAt,
            replacement: {
              ...input.draft,
              checkoutSessionKey,
              checkoutAttemptKey,
            },
          })
        ),
        Effect.map((reservationDraft) => ({
          checkoutSessionId,
          reservationDraft,
        })),
        Effect.tapError(() =>
          reservations
            .markCancelled({ id: claimed.id, cancelledAt })
            .pipe(Effect.ignore)
        )
      );
    }

    yield* ensureReservationAvailable({
      availability,
      reservation: input.reservation,
    });
    const reservationDraft = yield* reservations.createDraft({
      ...input.draft,
      checkoutSessionKey,
      checkoutAttemptKey,
    });
    if (reservationDraft.checkoutAttemptKey !== checkoutAttemptKey) {
      continue;
    }

    return {
      checkoutSessionId,
      reservationDraft,
    };
  }
});

export const prepareWorkspacePayState = Effect.fn("prepareWorkspacePayState")(
  function* (input: PreparePayStateInput) {
    const botProtection = yield* BotProtectionService;
    yield* botProtection.verifyHuman({ verificationFailurePolicy: "allow" });

    const advertisement = yield* prepareAdvertisement(input);

    const checkoutSessionKey = deriveCheckoutSessionKey(
      input.checkoutSessionId
    );
    const checkoutAttemptKey = deriveCheckoutAttemptKey({
      checkoutSessionId: input.checkoutSessionId,
      checkoutAttemptId: input.checkoutAttemptId,
      reservation: input.reservation,
    });
    yield* Effect.annotateLogsScoped({
      locale: input.locale,
      reservationKind: input.reservation.kind,
      checkoutSessionKey,
      checkoutAttemptKey,
    });
    yield* Effect.logInfo("Workspace reservation submit started");

    const acceptedAt = Temporal.Now.instant().toString();
    const privacyEvidence = yield* getReservationPrivacyEvidence({
      locale: input.locale,
      accepted: input.legalConsent === true,
      acceptedAt,
    });
    yield* Effect.annotateLogsScoped({ privacyEvidence });
    const legalEvents = yield* LegalEvidenceEventRepository;

    if (input.legalConsent !== true) {
      yield* Effect.logInfo(
        "Workspace reservation submit rejected: missing legal consent"
      );

      yield* legalEvents
        .recordMany(
          Object.values(privacyEvidence).map((evidence) => ({
            evidence,
          }))
        )
        .pipe(
          Effect.tapError((cause) =>
            Effect.logError("Reservation legal evidence recording failed", {
              cause,
            })
          ),
          Effect.ignore
        );

      return {
        status: "error" as const,
        message: m.reservationValidationLegalConsentRequired(),
      };
    }

    const reservations = yield* WorkspaceReservationRepository;
    const dotypos = yield* DotyposService;

    const customerName = splitCustomerName(input.reservation.name);
    const customer = yield* dotypos.findOrCreateCustomer(
      {
        ...customerName,
        email: input.reservation.email,
        phone: input.reservation.phone,
      },
      { lookupFields: ["email"] }
    );
    const dotyposCustomerId = yield* getDotyposCustomerId(customer.id);
    yield* Effect.annotateLogsScoped({ dotyposCustomerId });
    yield* Effect.logDebug("Workspace reservation Dotypos customer resolved");

    const prepared = yield* quotePreparedReservation({
      advertisement,
      dotyposCustomerId,
      locale: input.locale,
    });
    yield* Effect.annotateLogsScoped({ quote: prepared.quote });
    yield* Effect.logDebug("Workspace reservation quote built");

    const holdExpiresAt = getReservationHoldExpiresAt(Temporal.Now.instant());
    const accessCodes = yield* WorkspaceCheckoutAccessCodeService;
    const customerAccessCode = yield* accessCodes.generateCustomerAccessCode;

    const preparedDraft = yield* prepareReservationDraft({
      checkoutSessionId: input.checkoutSessionId,
      checkoutAttemptId: input.checkoutAttemptId,
      reservation: input.reservation,
      draft: {
        dotyposCustomerId,
        customerAccessCode,
        reservationDetails: getStoredWorkspaceReservationDetails(
          input.reservation
        ),
        locale: input.locale,
        reservationHoldExpiresAt: holdExpiresAt,
      },
    });
    const { checkoutSessionId, reservationDraft } = preparedDraft;
    yield* Effect.annotateLogsScoped({ reservationDraft });
    yield* Effect.logInfo("Workspace reservation draft ready");

    if (isReusableSubmissionReservation(reservationDraft)) {
      yield* Effect.logInfo(
        "Existing workspace reservation hold reused for an immediate retry"
      );
      yield* reservations.updateReservationDetails({
        id: reservationDraft.id,
        reservationDetails: getStoredWorkspaceReservationDetails(
          input.reservation
        ),
        locale: input.locale,
      });
      yield* legalEvents.recordMany(
        Object.values(privacyEvidence).map((evidence) => ({
          workspaceReservationId: reservationDraft.id,
          evidence,
        }))
      );
      yield* Effect.logInfo("Workspace reservation checkout prep ready");

      return yield* toReadyResult({
        locale: input.locale,
        prepared,
        reservationId: reservationDraft.id,
        checkoutSessionId,
        changedKeys: advertisement.changedKeys,
      });
    }

    const claimed = yield* reservations.claimHoldCreation(reservationDraft.id);
    if (!claimed) {
      const claimConflictReservation =
        yield* waitForPendingReservationTransition({
          reservations,
          reservationId: reservationDraft.id,
        });
      yield* Effect.annotateLogsScoped({ claimConflictReservation });

      if (
        claimConflictReservation &&
        isReusableSubmissionReservation(claimConflictReservation)
      ) {
        yield* Effect.logInfo(
          "Existing workspace reservation hold reused for an immediate retry"
        );

        const reusedPrepared = yield* quotePreparedReservation({
          advertisement,
          dotyposCustomerId: yield* getDotyposCustomerId(
            claimConflictReservation.dotyposCustomerId
          ),
          locale: input.locale,
        });

        yield* reservations.updateReservationDetails({
          id: claimConflictReservation.id,
          reservationDetails: getStoredWorkspaceReservationDetails(
            input.reservation
          ),
          locale: input.locale,
        });
        yield* legalEvents.recordMany(
          Object.values(privacyEvidence).map((evidence) => ({
            workspaceReservationId: claimConflictReservation.id,
            evidence,
          }))
        );
        yield* Effect.logInfo("Workspace reservation checkout prep ready");

        return yield* toReadyResult({
          locale: input.locale,
          prepared: reusedPrepared,
          reservationId: claimConflictReservation.id,
          checkoutSessionId,
          changedKeys: advertisement.changedKeys,
        });
      }

      yield* Effect.logError(
        "Workspace reservation hold creation claim failed"
      );

      return {
        status: "error" as const,
        message: m.reservationErrorMessage({}, { locale: input.locale }),
      };
    }
    yield* Effect.logDebug("Workspace reservation hold creation claimed");

    const checkoutDetails = getReservationCheckoutDetails({
      locale: input.locale,
      prepared,
      legalEvidence: privacyEvidence,
    });
    yield* Effect.annotateLogsScoped({ checkoutDetails });
    const dotyposReservation = yield* createWorkspaceDotyposReservation({
      paymentOrderId: reservationDraft.id,
      dotyposCustomerId,
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

          yield* reservations.releaseHoldCreation(reservationDraft.id).pipe(
            Effect.tapError((releaseCause) =>
              Effect.logError("Reservation hold creation release failed", {
                cause: releaseCause,
              })
            ),
            Effect.ignore
          );
        })
      )
    );
    yield* Effect.annotateLogsScoped({ dotyposReservation });

    const dotyposReservationId = yield* decodeDotyposEntityId({
      value: dotyposReservation,
      missingIdMessage: "Dotypos reservation was created without an ID",
    }).pipe(
      Effect.tapError(
        Effect.fn(function* (cause) {
          yield* Effect.logError(
            "Workspace Dotypos reservation hold was created without an ID",
            {
              cause,
            }
          );

          yield* reservations.releaseHoldCreation(reservationDraft.id).pipe(
            Effect.tapError((releaseCause) =>
              Effect.logError("Reservation hold creation release failed", {
                cause: releaseCause,
              })
            ),
            Effect.ignore
          );
        })
      )
    );
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
              Effect.catch((cancelCause) =>
                Effect.gen(function* () {
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
            yield* reservations.releaseHoldCreation(reservationDraft.id).pipe(
              Effect.tapError((releaseCause) =>
                Effect.logError("Reservation hold creation release failed", {
                  cause: releaseCause,
                })
              ),
              Effect.ignore
            );

            return yield* cause;
          })
        )
      );
    yield* Effect.logInfo("Workspace reservation hold attached");
    yield* enqueueReservationHoldCleanup({
      orderId: reservationDraft.id,
      reservationHoldExpiresAt: holdExpiresAt,
    });
    yield* captureReservationStarted({
      reservation: {
        id: reservationDraft.id,
        dotyposReservationId,
      },
      timestamp: reservationCreatedAt,
    });

    yield* legalEvents.recordMany(
      Object.values(privacyEvidence).map((evidence) => ({
        workspaceReservationId: reservationDraft.id,
        evidence,
      }))
    );

    yield* Effect.logInfo("Workspace reservation checkout prep ready");

    return yield* toReadyResult({
      locale: input.locale,
      prepared,
      reservationId: reservationDraft.id,
      checkoutSessionId,
      changedKeys: advertisement.changedKeys,
    });
  },
  (effect, input) =>
    effect.pipe(
      Effect.scoped,
      Effect.annotateLogs({
        locale: input.locale,
        reservationKind: input.reservation.kind,
      }),
      Effect.mapError(
        (error) =>
          new PublicSafeActionError({
            message: Match.value(error).pipe(
              Match.tag("BotDetectedError", () =>
                m.reservationRateLimitMessage({}, { locale: input.locale })
              ),
              Match.orElse(() =>
                m.reservationErrorMessage({}, { locale: input.locale })
              )
            ),
            cause: error,
          })
      )
    )
);

const PreparePayStateLive = Layer.mergeAll(
  Layer.mergeAll(
    WorkspaceReservationRepositoryLive,
    LegalEvidenceEventRepositoryLive
  ).pipe(Layer.provide(WorkspaceDatabaseLive)),
  WorkspaceAvailabilityService.LiveWithDependencies,
  WorkspaceTableAssignmentService.Live.pipe(
    Layer.provide(
      WorkspaceReservationRepositoryLive.pipe(
        Layer.provide(WorkspaceDatabaseLive)
      )
    ),
    Layer.provide(DotyposServiceLive)
  ),
  WorkspaceCheckoutAccessCodeServiceLive,
  ReservationHoldCleanupScheduleService.Live,
  PostHogEventServiceLive,
  DotyposServiceLive,
  CheckoutPricingServiceLiveWithDependencies
);

const preparePayStateAction = defineWorkspaceAction(
  {
    operation: "checkout.prepare-pay-state",
    schema: preparePayStateSchema,
  },
  (input) =>
    prepareWorkspacePayState(input).pipe(Effect.provide(PreparePayStateLive))
);

export const preparePayState: typeof preparePayStateAction = async (
  ...args: Parameters<typeof preparePayStateAction>
) => {
  "use server";
  return await preparePayStateAction(...args);
};
