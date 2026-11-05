"use server";

import { type DotyposReservationId, DotyposService } from "@deskohub/dotypos";
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
import { CheckoutAnalytics } from "@/features/checkout/backend/analytics";
import {
  buildCheckoutPayPath,
  buildSignedPayState,
  CheckoutPricingService,
  type PayStateLinkOptions,
  payStateDefaultTtlMilliseconds,
  sealPayStateForUrl,
} from "@/features/checkout/backend/checkout";
import {
  deriveCheckoutAttemptKeys,
  deriveCheckoutSessionKeys,
  deriveCheckoutSessionLockKey,
} from "@/features/checkout/backend/checkout/checkout-lookup-keys.server";
import {
  DotyposHoldRelease,
  ReservationHoldCleanupScheduleService,
} from "@/features/checkout/backend/holds";
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
import { ensureOfficeReservationsEnabled } from "@/features/office/backend/office-release-gate";
import {
  RememberedReferral,
  type RememberedReferralForBooking,
} from "@/features/referrals/remembered-referral.service";
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
    const linkOptions: PayStateLinkOptions = input.stableLink
      ? { issuedAt: input.bookedAt, deterministic: true }
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
    const checkoutAnalytics = yield* CheckoutAnalytics;
    const captureOutcome = (outcome: ReservationPrePaymentOutcome) =>
      checkoutAnalytics
        .prePaymentOutcome({
          checkoutAttemptId: input.checkoutAttemptId,
          outcome,
          timestamp: Temporal.Now.instant(),
        })
        .pipe(
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

type AccountCustomer = Effect.Success<
  ReturnType<typeof resolveAccountCustomer>
>;

/**
 * What an account booking carries from the remembered referral, and what a
 * booking for someone else prefills.
 */
const splitReferralForBooking = (referral: RememberedReferralForBooking) => ({
  accountReferral: referral.kind === "carried" ? referral : undefined,
  referralCodePrefill: referral.kind === "prefill" ? referral.code : undefined,
});

/**
 * The Dotypos customer a reservation books: the account's linked customer,
 * else the one the submitted contact finds or creates.
 */
const resolveBookedCustomerId = Effect.fnUntraced(function* (
  accountCustomer: AccountCustomer,
  reservation: Pick<
    PreparePayStateInput["reservation"],
    "name" | "email" | "phone"
  >
) {
  const dotypos = yield* DotyposService;
  return (
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
      .pipe(Effect.flatMap((customer) => getDotyposCustomerId(customer.id))))
  );
});

/**
 * Records a checked marketing box as an initial grant; an unchecked one
 * records nothing, never a withdrawal.
 */
const recordCheckoutMarketingConsent = Effect.fnUntraced(function* ({
  input,
  bookingAgent,
  dotyposCustomerId,
}: {
  readonly input: PreparePayStateInput;
  readonly bookingAgent: Option.Option<BookingAgent["Service"]>;
  readonly dotyposCustomerId: DotyposCustomerId;
}) {
  if (input.marketingConsent !== true) return;
  yield* Effect.gen(function* () {
    const ledger = yield* MarketingConsentLedger;
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
});

const prepareSubmission = Effect.fn("prepareWorkspacePayState.submission")(
  function* (input: PreparePayStateInput, inReviewSandbox: Ref.Ref<boolean>) {
    const bookingAgent = yield* Effect.serviceOption(BookingAgent);
    const accountActivity = yield* OptionalAccountActivityGuard;
    const rememberedReferral = yield* RememberedReferral;
    const checkoutAnalytics = yield* CheckoutAnalytics;
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
        const { accountReferral, referralCodePrefill } =
          splitReferralForBooking(referralForBooking);
        yield* Ref.set(carriesAccountReferral, accountReferral !== undefined);

        const advertiseAt = (at: Temporal.Instant) =>
          prepareAdvertisement({
            ...input,
            ...(accountCustomer && {
              reservation: { ...input.reservation, ...accountCustomer.contact },
            }),
            bookedAt: at,
          });
        // Submission locks the price: calendar sales are evaluated at this
        // booking moment here and at every later checkout re-check.
        const bookedAt = yield* currentInstant;
        const advertisement = yield* advertiseAt(bookedAt);
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

        const dotyposCustomerId = yield* resolveBookedCustomerId(
          accountCustomer,
          reservation
        );
        yield* Effect.annotateLogsScoped({ dotyposCustomerId });
        yield* Effect.logDebug(
          "Workspace reservation Dotypos customer resolved"
        );
        yield* Ref.set(bookedCustomer, dotyposCustomerId);

        const billing =
          reservation.billing ?? defaultReservationBillingSelection;
        yield* recordCheckoutMarketingConsent({
          input,
          bookingAgent,
          dotyposCustomerId,
        });

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
          const anchoredAdvertisement = yield* advertiseAt(at);
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
        const keepPendingPayment = Effect.fnUntraced(function* (
          pending: Extract<AgentCheckout, { readonly kind: "payment_pending" }>
        ) {
          yield* Effect.logInfo(
            "Workspace reservation with a pending payment kept for a repeated agent request",
            { reservationId: pending.reservation.id }
          );
          const pendingResult = yield* toHeldResult({
            reservation: pending.reservation,
            checkoutSessionId: pending.checkoutSessionId,
            prepared,
          });
          // Re-quoting at the anchor may have outlasted the link.
          if (
            Date.parse(pendingResult.expiresAt) <=
            Temporal.Now.instant().epochMilliseconds
          ) {
            return yield* new AgentBookingPaymentInProgressError({
              reservationId: pending.reservation.id,
            });
          }
          return pendingResult;
        });
        if (checkout.kind === "payment_pending") {
          return yield* keepPendingPayment(checkout);
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
            checkoutAnalytics.availabilityResult({
              checkoutAttemptId: input.checkoutAttemptId,
              result: "available",
              timestamp: Temporal.Now.instant(),
            })
          ),
          Effect.tapError((error) =>
            Match.value(error).pipe(
              Match.tag("WorkspaceTableUnavailableError", () =>
                checkoutAnalytics.availabilityResult({
                  checkoutAttemptId: input.checkoutAttemptId,
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
            yield* checkoutAnalytics.reservationStarted({
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
        });

        /** Resumes the draft's hold, or creates it in Dotypos and attaches it. */
        const holdReservationDraft = Effect.fnUntraced(function* ({
          checkoutSessionId,
          reservationDraft,
        }: typeof preparedDraft) {
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
            yield* checkoutAnalytics.reservationStarted({
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
            return yield* resumeClaimConflict(
              reservationDraft,
              checkoutSessionId
            );
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

          return yield* toReadyResult({
            locale: input.locale,
            prepared,
            reservationId: reservationDraft.id,
            checkoutSessionId,
            bookedAt,
            changedKeys: prepared.changedKeys,
            stableLink: Option.isSome(bookingAgent),
          });
        });

        return yield* holdReservationDraft(preparedDraft);
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
