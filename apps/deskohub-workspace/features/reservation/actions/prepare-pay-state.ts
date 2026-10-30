"use server";

import {
  type DotyposReservationId,
  DotyposReservationIdSchema,
  DotyposService,
} from "@deskohub/dotypos";
import { EmailRecipientDomainService } from "@deskohub/email/backend/recipient-domain.service";
import {
  Data,
  Duration,
  Effect,
  Layer,
  Match,
  Option,
  Predicate,
  Ref,
  Schedule,
  Schema,
} from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { env } from "@/env";
import {
  CustomerAccountAccessError,
  CustomerAccountContactService,
  type CustomerAgentClientId,
  OptionalAccountActivityGuard,
} from "@/features/account";
import type { CustomerAccountId } from "@/features/account/customer-account";
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
  deriveCheckoutAttemptKeys,
  deriveCheckoutSessionKeys,
  deriveCheckoutSessionLockKey,
} from "@/features/checkout/backend/checkout/checkout-lookup-keys.server";
import { ReservationHoldCleanupScheduleService } from "@/features/checkout/backend/holds";
import {
  createWorkspaceDotyposReservation,
  splitCustomerName,
} from "@/features/checkout/backend/reservation";
import {
  type CheckoutAttemptId,
  type CheckoutSessionId,
  promoteCheckoutAttemptToSessionId,
} from "@/features/checkout/checkout-identifiers";
import { addCheckoutReferralAppliedMarker } from "@/features/checkout/checkout-referral-notice";
import {
  type CheckoutSummaryChangedKeys,
  getCheckoutSummaryChangedKeys,
} from "@/features/checkout/checkout-summary";
import { getCoworkCheckoutSummary } from "@/features/checkout/checkout-summary-cowork";
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/checkout-summary-meeting-room";
import { getOfficeCheckoutSummary } from "@/features/checkout/checkout-summary-office";
import { legalEvidenceMapSchema } from "@/features/checkout/legal-evidence";
import type { CheckoutDetails } from "@/features/checkout/schemas/checkout-details";
import type { CanonicalPromotionCode } from "@/features/discounts/contracts";
import { type Locale, m } from "@/features/i18n";
import { MarketingConsentLedger } from "@/features/legal/backend/marketing-consent-ledger";
import { ensureOfficeReservationsEnabled } from "@/features/office/backend/office-reservation-feature-flag.service";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import {
  AgentBookingPaymentInProgressError,
  AgentBookingProfileRequiredError,
  type AgentSelectionKey,
  BookingAgent,
  deriveAgentCheckoutAttemptId,
} from "@/features/reservation/backend/booking-agent";
import { payStatePreparationServices } from "@/features/reservation/backend/pay-state-preparation-services";
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
import { getReservationCustomerProfile } from "@/features/reservation/reservation-customer-profile";
import { ReviewAccounts, ReviewSandbox } from "@/features/review-accounts";
import { MissingDotyposId } from "@/shared/backend/missing-dotypos-id";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import {
  currentInstant,
  instantStringSchema,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
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
import { getPreparePayStateDeadline } from "./prepare-pay-state-deadline";
import {
  toReservationFormError,
  verifyReservationFormHuman,
} from "./prepare-pay-state-form";

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
  (
    input: PreparePayStateInput & {
      readonly bookedAt: Temporal.Instant;
    }
  ) =>
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
  readonly referralCodePrefill: CanonicalPromotionCode | undefined;
  readonly referralCode: CanonicalPromotionCode | undefined;
}) {
  const pricing = yield* CheckoutPricingService;
  const referral =
    input.referralCode === undefined
      ? {}
      : { referralCode: input.referralCode };

  const prepared = yield* pricing.quoteForCustomer({
    ...input.advertisement,
    dotyposCustomerId: input.dotyposCustomerId,
    locale: input.locale,
    affirmedAdvertisement: input.advertisement.discountQuote,
    ...referral,
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

  return {
    ...prepared,
    ...referral,
    requestedDiscountCode:
      input.advertisement.requestedDiscountCode ?? input.referralCodePrefill,
    changedKeys,
  };
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
        new MissingDotyposId({
          entity: "reservation",
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
        new MissingDotyposId({
          entity: "customer",
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
    readonly bookedAt: Temporal.Instant;
    readonly changedKeys?: CheckoutSummaryChangedKeys;
    /**
     * Issues the Pay state as of `bookedAt` and seals it deterministically,
     * so rebuilding it for the same hold returns the same link.
     */
    readonly stableLink?: boolean;
  }) {
    const linkOptions = input.stableLink
      ? {
          now: () => new Date(input.bookedAt.epochMilliseconds),
          syntheticIv: true,
        }
      : {};
    const state = yield* buildSignedPayState(
      {
        ...input.prepared,
        locale: input.locale,
        orderId: input.reservationId,
        bookedAt: instantStringSchema.make(
          temporalInstantToIsoString(input.bookedAt)
        ),
        checkoutSessionId: input.checkoutSessionId,
        changedKeys: input.changedKeys,
      },
      linkOptions
    );
    const sealedState = yield* sealPayStateForUrl(state, linkOptions);
    const redirectUrl = buildCheckoutPayPath(input.locale, sealedState, {
      orderId: input.reservationId,
    });
    // The Pay page accepts its sealed state until this instant.
    const expiresAt = temporalInstantToIsoString(
      Temporal.Instant.fromEpochMilliseconds(state.exp * 1000)
    );

    if (input.changedKeys) {
      return {
        status: "pricing_changed" as const,
        orderId: input.reservationId,
        redirectUrl,
        expiresAt,
        affectedProductKeys: input.changedKeys.itemKeys.flatMap((key) =>
          key.startsWith("product:") ? [key] : []
        ),
      };
    }

    return {
      status: "ready" as const,
      orderId: input.reservationId,
      redirectUrl,
      expiresAt,
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
    const reservations = yield* WorkspaceReservationRepository;
    const dotypos = yield* DotyposService;
    const { reservationId, dotyposReservationId } = input;
    const cancelled = yield* Effect.gen(function* () {
      const status = yield* dotypos.getReservationStatus(dotyposReservationId);
      if (status === "CANCELLED") return true;
      if (status !== "NEW") {
        yield* Effect.logError(
          "Checkout supersession refused to cancel a non-pending Dotypos reservation",
          { reservationId, dotyposReservationId, status }
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
            { reservationId, dotyposReservationId, cause }
          );
          return false;
        })
      )
    );

    if (!cancelled) {
      yield* reservations
        .markCancellationFailed({
          id: reservationId,
          failureCode: "checkout_supersession_cancel_failed",
        })
        .pipe(
          Effect.tapError((cause) =>
            Effect.logError(
              "Checkout supersession cancellation failure marker failed",
              { reservationId, cause }
            )
          ),
          Effect.ignore
        );
    }
    return cancelled;
  }
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
  const availability = yield* WorkspaceAvailabilityService;
  let checkoutSessionId = input.checkoutSessionId;

  while (true) {
    const checkoutSessionKeys =
      yield* deriveCheckoutSessionKeys(checkoutSessionId);
    const checkoutAttemptKeys = yield* deriveCheckoutAttemptKeys({
      checkoutSessionId,
      checkoutAttemptId: input.checkoutAttemptId,
      reservation: input.reservation,
    });
    const checkoutAttemptKey = checkoutAttemptKeys.current;

    let existingAttempt = yield* reservations.findByAttemptKeys(
      checkoutAttemptKeys.accepted
    );
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

    // Rows of one session keep the key stored by its first row, so a
    // session that spans a Pay-state key rotation still groups as one.
    const checkoutSessionKey =
      (yield* reservations.findStoredCheckoutSessionKey(
        checkoutSessionKeys.accepted
      )) ?? checkoutSessionKeys.current;
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

    if (
      currentReservation &&
      (mustRotateCheckoutSession(currentReservation) ||
        isAnotherAccountsReservation(
          currentReservation,
          input.draft.authorAccountId
        ))
    ) {
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

      const cancelled = yield* cancelSupersededHold({
        reservationId: claimed.id,
        dotyposReservationId,
      });
      if (!cancelled) {
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
      checkoutSessionLockKey: deriveCheckoutSessionLockKey(checkoutSessionId),
      acceptedCheckoutSessionKeys: checkoutSessionKeys.accepted,
      acceptedCheckoutAttemptKeys: checkoutAttemptKeys.accepted,
    });
    // Another worker may have created this attempt under a different
    // active key or lookup-key format; any other row is the session's
    // current reservation.
    if (
      !checkoutAttemptKeys.accepted.includes(
        reservationDraft.checkoutAttemptKey
      )
    ) {
      continue;
    }

    return {
      checkoutSessionId,
      reservationDraft,
    };
  }
});

/**
 * The booking instant of an agent's hold. An agent hold lasts one Pay-state
 * lifetime from it and its Pay state is issued as of it, so a repeated
 * request rebuilds the same Pay link, which never outlives the hold. Null for
 * a reservation without a hold deadline.
 */
const getAgentHoldBookedAt = (reservation: WorkspaceReservation) =>
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

  yield* Effect.forEach(
    rotatedHolds,
    Effect.fn(function* (hold) {
      const claimed = yield* reservations.claimSupersessionCancellation(
        hold.id
      );
      // workspace_reservations_hold_id_check rejects a held or cancelling
      // row without its Dotypos hold, so a claimed row always carries one.
      if (!claimed?.dotyposReservationId) return;

      yield* Effect.logInfo(
        "Agent client's hold in a rotated checkout session superseded",
        { reservationId: claimed.id }
      );
      const cancelled = yield* cancelSupersededHold({
        reservationId: claimed.id,
        dotyposReservationId: claimed.dotyposReservationId,
      });
      if (cancelled) {
        yield* reservations.markCancelled({
          id: claimed.id,
          cancelledAt: Temporal.Now.instant(),
        });
      }
    }),
    { discard: true }
  );
});

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

    const latest =
      latestFound.reservationState === "creating_hold" ||
      latestFound.reservationState === "cancelling"
        ? ((yield* waitForPendingReservationTransition({
            reservations,
            reservationId: latestFound.id,
          })) ?? latestFound)
        : latestFound;
    const checkoutAttemptId = deriveAgentCheckoutAttemptId(
      input.selectionKey,
      previous?.id
    );
    const agentSessionKeys = yield* deriveCheckoutSessionKeys(
      input.checkoutSessionId
    );
    const inAgentSession = Boolean(
      latest.checkoutSessionKey &&
        agentSessionKeys.accepted.includes(latest.checkoutSessionKey)
    );
    const checkoutSessionId = inAgentSession
      ? input.checkoutSessionId
      : promoteCheckoutAttemptToSessionId(checkoutAttemptId);

    if (
      latest.reservationState === "held" &&
      latest.paymentState === "pending"
    ) {
      // The payment decides this booking; a repeat neither holds again nor
      // cancels. The Pay link resumes the payment until it expires, at the
      // whole second its sealed state carries.
      const holdBookedAt = getAgentHoldBookedAt(latest);
      if (
        !holdBookedAt ||
        Math.floor(
          (holdBookedAt.epochMilliseconds + payStateDefaultTtlMilliseconds) /
            1000
        ) *
          1000 <=
          Temporal.Now.instant().epochMilliseconds
      ) {
        return yield* new AgentBookingPaymentInProgressError({
          reservationId: latest.id,
        });
      }
      return {
        kind: "payment_pending",
        checkoutSessionId,
        reservation: latest,
      } satisfies AgentCheckout;
    }

    const open =
      latest.reservationState === "draft" ||
      latest.reservationState === "creating_hold" ||
      latest.reservationState === "cancelling" ||
      isReusableSubmissionReservation(latest);
    if (!open) return yield* startNextAttempt(latest);

    const attemptKeys = yield* deriveCheckoutAttemptKeys({
      checkoutSessionId,
      checkoutAttemptId,
      reservation: input.reservation,
    });
    if (
      latest.checkoutAttemptKey &&
      attemptKeys.accepted.includes(latest.checkoutAttemptKey)
    ) {
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

/**
 * The account a reservation booked "as the account" belongs to: the linked
 * Dotypos customer and the contact the reservation must carry. An account
 * without a profile yet saves the submitted contact and billing as its
 * profile first, except through a customer agent: the customer completes
 * the profile on the site. The account advisory lock is already held, so
 * this reads the existing link and creates one without taking the lock
 * again.
 */
const resolveAccountCustomer = Effect.fn(
  "preparePayState.resolveAccountCustomer"
)(function* ({
  input,
  bookingAgent,
}: {
  readonly input: PreparePayStateInput;
  readonly bookingAgent: Option.Option<BookingAgent["Service"]>;
}) {
  if (input.customer !== "account") return undefined;

  const contacts = yield* CustomerAccountContactService;
  const account = yield* contacts.currentAccount;
  const contact = yield* Match.value(account).pipe(
    Match.discriminatorsExhaustive("status")({
      "signed-out": () => Effect.succeed(null),
      unlinked: (unlinked) =>
        Option.isSome(bookingAgent)
          ? Effect.fail(new AgentBookingProfileRequiredError({}))
          : contacts.completeProfileUnderHeldLock(
              unlinked,
              getReservationCustomerProfile(input.reservation)
            ),
      linked: (linked) => contacts.linkedContact(linked),
    })
  );
  if (!contact) {
    return yield* account.status === "linked" && Option.isSome(bookingAgent)
      ? new AgentBookingProfileRequiredError({})
      : new CustomerAccountAccessError({ reason: "unauthenticated" });
  }
  if (!contact.phone && Option.isSome(bookingAgent)) {
    return yield* new AgentBookingProfileRequiredError({});
  }

  return {
    dotyposCustomerId: contact.dotyposCustomerId,
    contact: {
      name: contact.name,
      email: contact.email,
      phone: contact.phone ?? input.reservation.phone,
    },
  };
});

class UndeliverableContactEmailError extends Data.TaggedError(
  "UndeliverableContactEmailError"
)<Record<string, never>> {}

/**
 * The confirmation and access link go to the contact email, so a domain that
 * cannot receive mail would leave a paid customer without them. Rejects only a
 * definitive DNS answer; an inconclusive lookup lets the booking continue.
 */
const ensureContactEmailAcceptsMail = Effect.fn(
  "preparePayState.ensureContactEmailAcceptsMail"
)(function* (email: string) {
  const domains = yield* EmailRecipientDomainService;
  const status = yield* domains.check(email);
  if (status !== "rejects_mail") return;

  yield* Effect.logWarning(
    "Workspace reservation contact email cannot receive mail"
  );
  return yield* new UndeliverableContactEmailError({});
});

/**
 * A review account's booking, priced like any other and held in its sandbox:
 * no Dotypos customer or reservation, no availability check, no payment, and
 * no hold cleanup. The sandbox keeps the advertised price.
 */
const prepareReviewSandboxHold = Effect.fn(
  "preparePayState.prepareReviewSandboxHold"
)(function* ({
  input,
  accountId,
  bookingAgent,
}: {
  readonly input: PreparePayStateInput;
  readonly accountId: CustomerAccountId;
  readonly bookingAgent: Option.Option<BookingAgent["Service"]>;
}) {
  const bookedAt = yield* currentInstant;
  const advertisement = yield* prepareAdvertisement({ ...input, bookedAt });
  const sandbox = yield* ReviewSandbox;
  return yield* sandbox.prepareHold({
    accountId,
    locale: input.locale,
    checkoutSessionId: input.checkoutSessionId,
    selection: Option.match(bookingAgent, {
      onNone: () => input.checkoutAttemptId,
      onSome: (agent) => agent.selectionKey,
    }),
    agentClientId: Option.getOrUndefined(
      Option.map(bookingAgent, (agent) => agent.clientId)
    ),
    reservation: advertisement.reservation,
    total: advertisement.advertisedQuote.payment.expectedPrice,
    bookedAt,
  });
});

/**
 * Prepares the Pay page for one submission: the shared booking operation of
 * the reservation form's Server Action and the customer MCP server. Each
 * caller authenticates its own channel first, the form with BotID and the MCP
 * server with the agent's OAuth token; a booking the MCP server makes carries
 * its {@link BookingAgent}.
 */
export const prepareWorkspacePayState = Effect.fn("prepareWorkspacePayState")(
  function* (input: PreparePayStateInput) {
    // A review account books in its sandbox, which captures no checkout
    // analytics, whatever the outcome.
    const inReviewSandbox = yield* Ref.make(false);
    const captureOutcome = (outcome: ReservationPrePaymentOutcome) =>
      capturePrePaymentOutcome({
        checkoutAttemptId: input.checkoutAttemptId,
        outcome,
        timestamp: Temporal.Now.instant(),
      }).pipe(
        Effect.when(
          Ref.get(inReviewSandbox).pipe(Effect.map((sandboxed) => !sandboxed))
        )
      );

    return yield* prepareSubmission(input, inReviewSandbox).pipe(
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
          Match.tag("UndeliverableContactEmailError", () =>
            captureOutcome("validation")
          ),
          Match.tag("CheckoutAttemptUnavailableError", () =>
            captureOutcome("reservation_conflict")
          ),
          Match.tag("AgentBookingProfileRequiredError", () =>
            captureOutcome("validation")
          ),
          Match.tag("AgentBookingPaymentInProgressError", () =>
            captureOutcome("reservation_conflict")
          ),
          Match.orElse(() => captureOutcome("server_error"))
        )
      ),
      Effect.annotateLogs({
        locale: input.locale,
        reservationKind: input.reservation.kind,
      })
    );
  }
);

const prepareSubmission = Effect.fn("prepareWorkspacePayState.submission")(
  function* (input: PreparePayStateInput, inReviewSandbox: Ref.Ref<boolean>) {
    const bookingAgent = yield* Effect.serviceOption(BookingAgent);
    const accountActivity = yield* OptionalAccountActivityGuard;
    const rememberedReferral = yield* RememberedReferral;
    const bookedCustomer = yield* Ref.make<DotyposCustomerId | undefined>(
      undefined
    );
    // Whether the account booking carries the remembered referral, which the
    // guarded section evaluates once it knows the account's customer.
    const carriesAccountReferral = yield* Ref.make(false);

    // The full state-creating section runs inside the account advisory
    // lock: authority is re-checked under the lock and the same lock is
    // held until the section completes, so deletion cannot interleave
    // between the check and the created state. Only a signed-in account
    // books; a session-authority failure fails closed.
    const result = yield* accountActivity.guardStateCreation(
      Effect.fn(function* (accountId) {
        if (!accountId) {
          return yield* new CustomerAccountAccessError({
            reason: "unauthenticated",
          });
        }
        const reviewAccount = yield* ReviewAccounts.pipe(
          Effect.flatMap((accounts) => accounts.isReviewAccount(accountId))
        );
        yield* Ref.set(inReviewSandbox, reviewAccount);
        yield* Match.value(input.reservation).pipe(
          Match.discriminatorsExhaustive("kind")({
            cowork: () => Effect.void,
            "meeting-room": () => Effect.void,
            office: () => ensureOfficeReservationsEnabled,
          })
        );
        if (reviewAccount) {
          return yield* prepareReviewSandboxHold({
            input,
            accountId,
            bookingAgent,
          });
        }

        const accountCustomer = yield* resolveAccountCustomer({
          input,
          bookingAgent,
        });
        // An account booking carries the remembered referral into its first
        // Pay state, so the first quote already prices the invitation; the
        // attribution is recorded only when that order is paid. A booking for
        // someone else gets a usable code as the code box prefill instead.
        const referralForBooking = yield* rememberedReferral.forBooking(
          accountCustomer
            ? { for: "account", customerId: accountCustomer.dotyposCustomerId }
            : { for: "someone-else" }
        );
        const accountReferral =
          referralForBooking.kind === "carried"
            ? referralForBooking
            : undefined;
        const referralCodePrefill =
          referralForBooking.kind === "prefill"
            ? referralForBooking.code
            : undefined;
        yield* Ref.set(carriesAccountReferral, accountReferral !== undefined);

        // Submission locks the price: calendar sales are evaluated at this
        // booking moment here and at every later checkout re-check.
        const bookedAt = yield* currentInstant;
        const advertisement = yield* prepareAdvertisement({
          ...input,
          ...(accountCustomer && {
            reservation: { ...input.reservation, ...accountCustomer.contact },
          }),
          bookedAt,
        });
        const reservation = advertisement.reservation;

        const checkoutSessionKeys = yield* deriveCheckoutSessionKeys(
          input.checkoutSessionId
        );
        const checkoutAttemptKeys = yield* deriveCheckoutAttemptKeys({
          checkoutSessionId: input.checkoutSessionId,
          checkoutAttemptId: input.checkoutAttemptId,
          reservation,
        });
        yield* Effect.annotateLogsScoped({
          locale: input.locale,
          reservationKind: reservation.kind,
          checkoutSessionKey: checkoutSessionKeys.current,
          checkoutAttemptKey: checkoutAttemptKeys.current,
        });
        yield* Effect.logInfo("Workspace reservation submit started");

        const reservations = yield* WorkspaceReservationRepository;
        const dotypos = yield* DotyposService;

        const releaseHoldCreation = (reservationId: WorkspaceReservationId) =>
          reservations.releaseHoldCreation(reservationId).pipe(
            Effect.tapError((releaseCause) =>
              Effect.logError("Reservation hold creation release failed", {
                cause: releaseCause,
              })
            ),
            Effect.ignore
          );

        if (!accountCustomer) {
          yield* ensureContactEmailAcceptsMail(reservation.email);
        }

        const dotyposCustomerId =
          accountCustomer?.dotyposCustomerId ??
          (yield* dotypos
            .findOrCreateCustomer(
              {
                ...splitCustomerName(reservation.name),
                email: reservation.email,
                phone: reservation.phone,
              },
              { lookupFields: ["email"] }
            )
            .pipe(
              Effect.flatMap((customer) => getDotyposCustomerId(customer.id))
            ));
        yield* Effect.annotateLogsScoped({ dotyposCustomerId });
        yield* Effect.logDebug(
          "Workspace reservation Dotypos customer resolved"
        );
        yield* Ref.set(bookedCustomer, dotyposCustomerId);

        const billing =
          reservation.billing ?? defaultReservationBillingSelection;
        if (input.marketingConsent === true) {
          yield* Effect.gen(function* () {
            const ledger = yield* MarketingConsentLedger;
            // A checked box records an initial grant; an unchecked one
            // records nothing, never a withdrawal.
            yield* ledger.record({
              customerId: dotyposCustomerId,
              locale: input.locale,
              choice: "grant",
              mode: "initial",
              channel: Option.isSome(bookingAgent)
                ? "mcp_tool"
                : (input.marketingConsentSource ?? "reservation_form"),
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
          referralCodePrefill,
          referralCode: accountReferral?.referralCode,
        });
        yield* Effect.annotateLogsScoped({ quote: prepared.quote });
        yield* Effect.logDebug("Workspace reservation quote built");

        // An agent's hold is anchored at its booking instant, and a repeated
        // request rebuilds its Pay state as of that instant, so the request
        // gets the same Pay link back for as long as the hold lasts.
        const quoteAt = Effect.fn("preparePayState.quoteAt")(function* (
          at: Temporal.Instant,
          customerId: DotyposCustomerId
        ) {
          const anchoredAdvertisement = yield* prepareAdvertisement({
            ...input,
            ...(accountCustomer && {
              reservation: { ...input.reservation, ...accountCustomer.contact },
            }),
            bookedAt: at,
          });
          return yield* quotePreparedReservation({
            advertisement: anchoredAdvertisement,
            dotyposCustomerId: customerId,
            locale: input.locale,
            referralCodePrefill,
            referralCode: accountReferral?.referralCode,
          });
        });
        const toHeldResult = Effect.fn("preparePayState.toHeldResult")(
          function* (held: {
            readonly reservation: WorkspaceReservation;
            readonly checkoutSessionId: CheckoutSessionId;
            readonly prepared: typeof prepared;
          }) {
            const holdBookedAt = Option.isSome(bookingAgent)
              ? getAgentHoldBookedAt(held.reservation)
              : null;
            if (!holdBookedAt) {
              return yield* toReadyResult({
                locale: input.locale,
                prepared: held.prepared,
                reservationId: held.reservation.id,
                checkoutSessionId: held.checkoutSessionId,
                bookedAt,
                changedKeys: held.prepared.changedKeys,
              });
            }

            const anchoredPrepared = holdBookedAt.equals(bookedAt)
              ? held.prepared
              : yield* quoteAt(
                  holdBookedAt,
                  yield* getDotyposCustomerId(
                    held.reservation.dotyposCustomerId
                  )
                );
            return yield* toReadyResult({
              locale: input.locale,
              prepared: anchoredPrepared,
              reservationId: held.reservation.id,
              checkoutSessionId: held.checkoutSessionId,
              bookedAt: holdBookedAt,
              changedKeys: anchoredPrepared.changedKeys,
              stableLink: true,
            });
          }
        );

        const checkout: AgentCheckout = yield* Option.match(bookingAgent, {
          onNone: () =>
            Effect.succeed({
              kind: "attempt",
              checkoutSessionId: input.checkoutSessionId,
              checkoutAttemptId: input.checkoutAttemptId,
            } satisfies AgentCheckout),
          onSome: ({ clientId, selectionKey }) =>
            resolveAgentCheckout({
              selectionKey,
              clientId,
              authorAccountId: accountId,
              checkoutSessionId: input.checkoutSessionId,
              reservation,
            }),
        });
        if (checkout.kind === "payment_pending") {
          yield* Effect.logInfo(
            "Workspace reservation with a pending payment kept for a repeated agent request",
            { reservationId: checkout.reservation.id }
          );
          const pendingResult = yield* toHeldResult({
            reservation: checkout.reservation,
            checkoutSessionId: checkout.checkoutSessionId,
            prepared,
          });
          // Re-quoting at the anchor may have outlasted the link.
          if (
            Date.parse(pendingResult.expiresAt) <=
            Temporal.Now.instant().epochMilliseconds
          ) {
            return yield* new AgentBookingPaymentInProgressError({
              reservationId: checkout.reservation.id,
            });
          }
          return pendingResult;
        }

        const holdExpiresAt = getReservationHoldExpiresAt(
          Option.isSome(bookingAgent) ? bookedAt : Temporal.Now.instant()
        );

        const preparedDraft = yield* prepareReservationDraft({
          checkoutSessionId: checkout.checkoutSessionId,
          checkoutAttemptId: checkout.checkoutAttemptId,
          reservation,
          draft: {
            dotyposCustomerId,
            authorAccountId: accountId,
            ...Option.match(bookingAgent, {
              onNone: () => ({}),
              onSome: ({ clientId, selectionKey }) => ({
                agentClientId: clientId,
                agentSelectionKey: selectionKey,
              }),
            }),
            reservationPurpose: billing.purpose,
            reservationDetails:
              getStoredWorkspaceReservationDetails(reservation),
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

        // A draft another account authored isn't this account's to resume.
        if (reservationDraft.authorAccountId !== accountId) {
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
            reservationDetails:
              getStoredWorkspaceReservationDetails(reservation),
            locale: input.locale,
          });
          yield* captureReservationStarted({
            reservation: reservationDraft,
            timestamp: reservationDraft.createdAt,
          });
          yield* Effect.logInfo("Workspace reservation checkout prep ready");

          return yield* toHeldResult({
            reservation: reservationDraft,
            checkoutSessionId,
            prepared,
          });
        }

        const claimed = yield* reservations.claimHoldCreation(
          reservationDraft.id
        );
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
              referralCodePrefill,
              referralCode: accountReferral?.referralCode,
            });

            yield* reservations.updateReservationDetails({
              id: claimConflictReservation.id,
              reservationDetails:
                getStoredWorkspaceReservationDetails(reservation),
              locale: input.locale,
            });
            yield* captureReservationStarted({
              reservation: claimConflictReservation,
              timestamp: claimConflictReservation.createdAt,
            });
            yield* Effect.logInfo("Workspace reservation checkout prep ready");

            return yield* toHeldResult({
              reservation: claimConflictReservation,
              checkoutSessionId,
              prepared: reusedPrepared,
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

              yield* releaseHoldCreation(reservationDraft.id);
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

              yield* releaseHoldCreation(reservationDraft.id);
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
        yield* captureReservationStarted({
          reservation: { id: reservationDraft.id },
          timestamp: reservationCreatedAt,
        });

        yield* Effect.logInfo("Workspace reservation checkout prep ready");

        return yield* toReadyResult({
          locale: input.locale,
          prepared,
          reservationId: reservationDraft.id,
          checkoutSessionId,
          bookedAt,
          changedKeys: prepared.changedKeys,
          stableLink: Option.isSome(bookingAgent),
        });
      })
    );

    // Checked after the account lock is released. Booking for someone else
    // checks the booker, never the friend.
    const settlingCustomer = yield* Ref.get(bookedCustomer);
    if (settlingCustomer) {
      yield* rememberedReferral.forgetIfSettled({
        kind: "order",
        paid: false,
        bookedCustomerId: settlingCustomer,
      });
    }

    if (
      !(yield* Ref.get(carriesAccountReferral)) ||
      result.status === "error"
    ) {
      return result;
    }
    return {
      ...result,
      redirectUrl:
        addCheckoutReferralAppliedMarker(result.redirectUrl, input.locale) ??
        result.redirectUrl,
    };
  }
);

const preparePayStateAction = defineWorkspaceAction(
  {
    logInput: false,
    operation: "checkout.prepare-pay-state",
    deadline: getPreparePayStateDeadline(env.VERCEL_ENV),
    schema: preparePayStateSchema,
  },
  (input) =>
    verifyReservationFormHuman(input.locale).pipe(
      Effect.andThen(
        prepareWorkspacePayState(input).pipe(
          Effect.mapError(toReservationFormError(input))
        )
      ),
      Effect.provide(
        RememberedReferral.Cookies.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              payStatePreparationServices,
              OptionalAccountActivityGuard.Live,
              CustomerAccountContactService.Live
            )
          ),
          Layer.provide(WorkspaceDatabase.Default)
        )
      )
    )
);

export const preparePayState: typeof preparePayStateAction = async (
  ...args: Parameters<typeof preparePayStateAction>
) => {
  "use server";
  return await preparePayStateAction(...args);
};
