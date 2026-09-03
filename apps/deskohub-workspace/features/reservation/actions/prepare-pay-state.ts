"use server";

import {
  DotyposReservationIdSchema,
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
import { WorkspaceDatabase } from "@/db/database.service";
import { OptionalAccountActivityGuard } from "@/features/account";
import {
  captureAvailabilityResult,
  capturePrePaymentOutcome,
  captureReservationStarted,
} from "@/features/checkout/backend/analytics";
import {
  buildCheckoutPayPath,
  buildSignedPayState,
  CheckoutPricingService,
  payStateDefaultTtlMilliseconds,
  sealPayStateForUrl,
} from "@/features/checkout/backend/checkout";
import {
  deriveCheckoutAttemptKey,
  deriveCheckoutSessionKey,
} from "@/features/checkout/backend/checkout/checkout-session-key.server";
import { ReservationHoldCleanupScheduleService } from "@/features/checkout/backend/holds";
import {
  createWorkspaceDotyposReservation,
  splitCustomerName,
  WorkspaceTableAssignmentService,
} from "@/features/checkout/backend/reservation";
import {
  type CheckoutAttemptId,
  type CheckoutSessionId,
  promoteCheckoutAttemptToSessionId,
} from "@/features/checkout/checkout-identifiers";
import {
  type CheckoutSummaryChangedKeys,
  getCheckoutSummaryChangedKeys,
} from "@/features/checkout/checkout-summary";
import { getCoworkCheckoutSummary } from "@/features/checkout/checkout-summary-cowork";
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/checkout-summary-meeting-room";
import { getOfficeCheckoutSummary } from "@/features/checkout/checkout-summary-office";
import { legalEvidenceMapSchema } from "@/features/checkout/legal-evidence";
import type { CheckoutDetails } from "@/features/checkout/schemas/checkout-details";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend";
import { type Locale, m } from "@/features/i18n";
import { getLegalAcceptanceSnapshot } from "@/features/legal/acceptance-snapshot";
import { CustomerMarketingConsentRepository } from "@/features/legal/backend/customer-marketing-consent.repository";
import {
  ensureOfficeReservationsEnabled,
  OfficeReservationFeatureFlagService,
} from "@/features/office/backend/office-reservation-feature-flag.service";
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
import type { ReservationPrePaymentOutcome } from "@/features/reservation/reservation-analytics";
import { defaultReservationBillingSelection } from "@/features/reservation/reservation-billing";
import { PostHogEventService } from "@/shared/backend/analytics/posthog-event.service";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
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
  ensureOfficePayStateAvailable,
  getPreparedOfficeCheckoutDetails,
  type PreparedOfficeAdvertisement,
  type PreparedOfficePayState,
  prepareOfficeAdvertisement,
} from "./prepare-office-pay-state";
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
const emptyLegalEvidence = decodeLegalEvidenceMap({});

const getReservationHoldExpiresAt = (now: Temporal.Instant) =>
  now.add({ milliseconds: payStateDefaultTtlMilliseconds });

type PreparedAdvertisement =
  | PreparedCoworkAdvertisement
  | PreparedMeetingRoomAdvertisement
  | PreparedOfficeAdvertisement;

const prepareAdvertisement = Effect.fn("preparePayState.prepareAdvertisement")(
  (input: PreparePayStateInput) =>
    Match.value(input.reservation).pipe(
      Match.discriminatorsExhaustive("kind")({
        cowork: (reservation) =>
          prepareCoworkAdvertisement({ ...input, reservation }),
        "meeting-room": (reservation) =>
          prepareMeetingRoomAdvertisement({ ...input, reservation }),
        office: (reservation) =>
          prepareOfficeAdvertisement({ ...input, reservation }),
      })
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

  const prepared = yield* pricing.quoteForCustomer({
    ...input.advertisement,
    dotyposCustomerId: input.dotyposCustomerId,
    locale: input.locale,
    affirmedAdvertisement: input.advertisement.discountQuote,
  });
  const advertisedSummary = Match.value(input.advertisement).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (advertisement) =>
        getCoworkCheckoutSummary(
          advertisement.reservation,
          advertisement.advertisedQuote
        ),
      "meeting-room": (advertisement) =>
        getMeetingRoomCheckoutSummary(advertisement.advertisedQuote),
      office: (advertisement) =>
        getOfficeCheckoutSummary(advertisement.advertisedQuote),
    })
  );
  const preparedSummary = Match.value(prepared).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (customerQuote) =>
        getCoworkCheckoutSummary(
          customerQuote.reservation,
          customerQuote.quote
        ),
      "meeting-room": (customerQuote) =>
        getMeetingRoomCheckoutSummary(customerQuote.quote),
      office: (customerQuote) => getOfficeCheckoutSummary(customerQuote.quote),
    })
  );
  const changedKeys =
    input.advertisement.changedKeys || prepared.advertisedPriceChanged
      ? getCheckoutSummaryChangedKeys(advertisedSummary, preparedSummary)
      : undefined;

  return { ...prepared, changedKeys };
});

const DotyposEntityWithIdSchema = Schema.Struct({
  id: DotyposReservationIdSchema,
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
)((value: string | undefined) =>
  decodeDotyposCustomerId(value).pipe(
    Effect.mapError(
      () =>
        new DotyposValidationError({
          message: "Dotypos customer is missing a valid ID",
        })
    )
  )
);

type PreparedPayState =
  | PreparedCoworkPayState
  | PreparedMeetingRoomPayState
  | PreparedOfficePayState;

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
      office: (prepared) =>
        getPreparedOfficeCheckoutDetails({ ...input, prepared }),
    })
  );

const toReadyResult = Effect.fn("preparePayState.toReadyResult")(
  function* (input: {
    readonly locale: Locale;
    readonly prepared: PreparedPayState;
    readonly reservationId: WorkspaceReservationId;
    readonly checkoutSessionId: CheckoutSessionId;
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

const prepareReservationDraft = Effect.fn(
  "preparePayState.prepareReservationDraft"
)(function* (input: {
  readonly checkoutSessionId: CheckoutSessionId;
  readonly checkoutAttemptId: CheckoutAttemptId;
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
        if (
          checkoutSessionId ===
          promoteCheckoutAttemptToSessionId(input.checkoutAttemptId)
        ) {
          return yield* new CheckoutAttemptUnavailableError({
            reservation: existingAttempt,
          });
        }
        checkoutSessionId = promoteCheckoutAttemptToSessionId(
          input.checkoutAttemptId
        );
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
      if (
        checkoutSessionId ===
        promoteCheckoutAttemptToSessionId(input.checkoutAttemptId)
      ) {
        return yield* new CheckoutAttemptUnavailableError({
          reservation: currentReservation,
        });
      }
      checkoutSessionId = promoteCheckoutAttemptToSessionId(
        input.checkoutAttemptId
      );
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
        if (
          checkoutSessionId ===
          promoteCheckoutAttemptToSessionId(input.checkoutAttemptId)
        ) {
          return yield* new CheckoutAttemptUnavailableError({
            reservation: claimed,
          });
        }
        checkoutSessionId = promoteCheckoutAttemptToSessionId(
          input.checkoutAttemptId
        );
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

    // Authoritative account activity must be re-checked before this action
    // creates its first provider or database state: a deletion-marked or
    // removed account stops here, while anonymous callers are unaffected.
    const accountActivity = yield* OptionalAccountActivityGuard;
    yield* accountActivity.require;

    yield* Match.value(input.reservation).pipe(
      Match.discriminatorsExhaustive("kind")({
        cowork: () => Effect.void,
        "meeting-room": () => Effect.void,
        office: () => ensureOfficeReservationsEnabled,
      })
    );

    const advertisement = yield* prepareAdvertisement(input);
    const reservation = advertisement.reservation;

    const checkoutSessionKey = deriveCheckoutSessionKey(
      input.checkoutSessionId
    );
    const checkoutAttemptKey = deriveCheckoutAttemptKey({
      checkoutSessionId: input.checkoutSessionId,
      checkoutAttemptId: input.checkoutAttemptId,
      reservation,
    });
    yield* Effect.annotateLogsScoped({
      locale: input.locale,
      reservationKind: reservation.kind,
      checkoutSessionKey,
      checkoutAttemptKey,
    });
    yield* Effect.logInfo("Workspace reservation submit started");

    const reservations = yield* WorkspaceReservationRepository;
    const dotypos = yield* DotyposService;

    const customerName = splitCustomerName(reservation.name);
    const customer = yield* dotypos.findOrCreateCustomer(
      {
        ...customerName,
        email: reservation.email,
        phone: reservation.phone,
      },
      { lookupFields: ["email"] }
    );
    const dotyposCustomerId = yield* getDotyposCustomerId(customer.id);
    yield* Effect.annotateLogsScoped({ dotyposCustomerId });
    yield* Effect.logDebug("Workspace reservation Dotypos customer resolved");

    const billing = reservation.billing ?? defaultReservationBillingSelection;
    if (input.marketingConsent === true) {
      yield* Effect.gen(function* () {
        const documents = yield* getLegalAcceptanceSnapshot(input.locale);
        const consents = yield* CustomerMarketingConsentRepository;
        yield* consents.grant({
          dotyposCustomerId,
          documentHash: documents.marketingCommunications.hash,
          locale: input.locale,
          grantedAt: Temporal.Now.instant(),
        });
      }).pipe(
        Effect.tapError((cause) =>
          Effect.logError("Customer marketing consent recording failed", {
            cause,
          })
        )
      );
    }

    const prepared = yield* quotePreparedReservation({
      advertisement,
      dotyposCustomerId,
      locale: input.locale,
    });
    yield* Effect.annotateLogsScoped({ quote: prepared.quote });
    yield* Effect.logDebug("Workspace reservation quote built");

    const holdExpiresAt = getReservationHoldExpiresAt(Temporal.Now.instant());

    const preparedDraft = yield* prepareReservationDraft({
      checkoutSessionId: input.checkoutSessionId,
      checkoutAttemptId: input.checkoutAttemptId,
      reservation,
      draft: {
        dotyposCustomerId,
        reservationPurpose: billing.purpose,
        reservationDetails: getStoredWorkspaceReservationDetails(reservation),
        locale: input.locale,
        reservationHoldExpiresAt: holdExpiresAt,
      },
    }).pipe(
      Effect.tap(() =>
        captureAvailabilityResult({
          checkoutAttemptId: input.checkoutAttemptId,
          result: "available",
          timestamp: Temporal.Now.instant(),
        })
      ),
      Effect.tapError((error) =>
        Match.value(error).pipe(
          Match.tag("WorkspaceTableUnavailableError", () =>
            captureAvailabilityResult({
              checkoutAttemptId: input.checkoutAttemptId,
              result: "unavailable",
              timestamp: Temporal.Now.instant(),
            })
          ),
          Match.orElse(() => Effect.void)
        )
      )
    );
    const { checkoutSessionId, reservationDraft } = preparedDraft;
    yield* Effect.annotateLogsScoped({ reservationDraft });
    yield* Effect.logInfo("Workspace reservation draft ready");

    if (isReusableSubmissionReservation(reservationDraft)) {
      yield* Effect.logInfo(
        "Existing workspace reservation hold reused for an immediate retry"
      );
      yield* reservations.updateReservationDetails({
        id: reservationDraft.id,
        reservationDetails: getStoredWorkspaceReservationDetails(reservation),
        locale: input.locale,
      });
      yield* captureReservationStarted({
        reservation: reservationDraft,
        timestamp: reservationDraft.createdAt,
      });
      yield* Effect.logInfo("Workspace reservation checkout prep ready");

      return yield* toReadyResult({
        locale: input.locale,
        prepared,
        reservationId: reservationDraft.id,
        checkoutSessionId,
        changedKeys: prepared.changedKeys,
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
          reservationDetails: getStoredWorkspaceReservationDetails(reservation),
          locale: input.locale,
        });
        yield* captureReservationStarted({
          reservation: claimConflictReservation,
          timestamp: claimConflictReservation.createdAt,
        });
        yield* Effect.logInfo("Workspace reservation checkout prep ready");

        return yield* toReadyResult({
          locale: input.locale,
          prepared: reusedPrepared,
          reservationId: claimConflictReservation.id,
          checkoutSessionId,
          changedKeys: reusedPrepared.changedKeys,
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
      legalEvidence: emptyLegalEvidence,
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

    yield* Effect.logInfo("Workspace reservation checkout prep ready");

    return yield* toReadyResult({
      locale: input.locale,
      prepared,
      reservationId: reservationDraft.id,
      checkoutSessionId,
      changedKeys: prepared.changedKeys,
    });
  },
  (effect, input) => {
    const captureOutcome = (outcome: ReservationPrePaymentOutcome) =>
      capturePrePaymentOutcome({
        checkoutAttemptId: input.checkoutAttemptId,
        outcome,
        timestamp: Temporal.Now.instant(),
      });

    return effect.pipe(
      Effect.scoped,
      Effect.tap((result) =>
        Match.value(result).pipe(
          Match.discriminatorsExhaustive("status")({
            error: () => captureOutcome("reservation_conflict"),
            pricing_changed: () => captureOutcome("pricing_changed"),
            ready: () => captureOutcome("prepared"),
          })
        )
      ),
      Effect.tapError((error) =>
        Match.value(error).pipe(
          Match.tag("WorkspaceTableUnavailableError", () =>
            captureOutcome("availability_changed")
          ),
          Match.tag("AdvertisedPriceMismatchError", () =>
            captureOutcome("validation")
          ),
          Match.tag("CheckoutAttemptUnavailableError", () =>
            captureOutcome("reservation_conflict")
          ),
          Match.tag("BotDetectedError", () => Effect.void),
          Match.orElse(() => captureOutcome("server_error"))
        )
      ),
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
              Match.tag("CustomerAccountAccessError", (cause) => {
                if (
                  cause.reason === "link-required" &&
                  cause.linkReason === "deletion-requested"
                ) {
                  return m.accountDeletionPendingError(
                    {},
                    { locale: input.locale }
                  );
                }
                if (cause.reason === "unauthenticated") {
                  return m.accountSessionExpired({}, { locale: input.locale });
                }
                return m.reservationErrorMessage({}, { locale: input.locale });
              }),
              Match.orElse(() =>
                m.reservationErrorMessage({}, { locale: input.locale })
              )
            ),
            cause: error,
          })
      )
    );
  }
);

const PreparePayStateLive = Layer.mergeAll(
  OptionalAccountActivityGuard.Live.pipe(
    Layer.provide(WorkspaceDatabase.Default)
  ),
  Layer.mergeAll(
    WorkspaceReservationRepository.Default,
    CustomerMarketingConsentRepository.Default
  ).pipe(Layer.provide(WorkspaceDatabase.Default)),
  WorkspaceAvailabilityService.Live,
  WorkspaceTableAssignmentService.Default.pipe(
    Layer.provide(WorkspaceReservationRepository.Live),
    Layer.provide(WorkspaceDotyposLayer)
  ),
  ReservationHoldCleanupScheduleService.Default,
  PostHogEventService.Live,
  WorkspaceDotyposLayer,
  CheckoutPricingService.Live,
  OfficeReservationFeatureFlagService.Default.pipe(
    Layer.provide(WorkspaceFeatureFlagService.Default)
  )
);

const preparePayStateAction = defineWorkspaceAction(
  {
    logInput: false,
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
