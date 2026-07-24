import { randomUUID } from "node:crypto";
import {
  canonicalizeDotyposEntityId,
  DotyposService,
  ValidationError as DotyposValidationError,
  hasValidDotyposReservationRequestEvidence,
} from "@deskohub/dotypos";
import {
  Data,
  Duration,
  Effect,
  Exit,
  Match,
  Predicate,
  Schedule,
  Schema,
} from "effect";
import { captureReservationStarted } from "@/features/checkout/backend/analytics";
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
import {
  enqueueAttachmentCancellationCompensation,
  enqueueProviderHoldCandidateRecovery,
  getDotyposCancellationAction,
  ReservationHoldCleanupScheduleService,
  recoverPersistedProviderHoldCandidate,
  verifyDifferentProviderAttachmentRecoveryEvidence,
} from "@/features/checkout/backend/holds";
import { LegalEvidenceEventRepository } from "@/features/checkout/backend/repositories";
import {
  createWorkspaceDotyposReservation,
  findWorkspaceDotyposReservationsByPaymentOrderId,
  prepareWorkspaceDotyposReservation,
  splitCustomerName,
  WorkspaceCheckoutAccessCodeService,
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
  getAttachCancellationRecovery,
  getAttachedHoldCreationEpoch,
  getDifferentProviderAttachmentRecovery,
  getHoldCreationMarker,
  type HoldCreationRecoveryReason,
  hasUnresolvedProviderAttachmentRecovery,
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type DotyposCustomerId,
  dotyposCustomerIdSchema,
} from "@/features/reservation/dotypos-customer";
import { getStoredWorkspaceReservationDetails } from "@/features/reservation/persistence-contracts";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
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
import type { PreparePayStateInput } from "./prepare-pay-state.schema";

const maxReservationPreparationConflictRetries = 3;

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
  id: Schema.Trim.check(Schema.isNonEmpty()),
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

type ReservationDraft = WorkspaceReservation & {
  readonly reservationState: "draft";
  readonly paymentState: "not_started";
  readonly dotyposReservationId: null;
  readonly reservationHoldExpiresAt: Temporal.Instant;
};

type ReusableReservationHold = WorkspaceReservation & {
  readonly reservationState: "held";
  readonly paymentState: "not_started";
  readonly dotyposReservationId: string;
  readonly reservationHoldExpiresAt: Temporal.Instant;
};

const isReusableSubmissionReservation = (
  reservation: WorkspaceReservation
): reservation is ReusableReservationHold =>
  reservation.reservationState === "held" &&
  reservation.paymentState === "not_started" &&
  typeof reservation.dotyposReservationId === "string" &&
  !hasUnresolvedProviderAttachmentRecovery(reservation) &&
  reservation.reservationHoldExpiresAt !== null &&
  Temporal.Instant.compare(
    reservation.reservationHoldExpiresAt,
    Temporal.Now.instant()
  ) > 0;

const isExactFreshProviderCandidate = (input: {
  readonly reservation: WorkspaceReservation;
  readonly expected: WorkspaceReservation;
  readonly providerCreationEpoch: string;
}) => {
  const marker = getHoldCreationMarker(input.reservation);
  return (
    input.reservation.reservationState === "held" &&
    input.reservation.paymentState === "not_started" &&
    typeof input.reservation.dotyposReservationId === "string" &&
    input.reservation.dotyposReservationId ===
      input.expected.dotyposReservationId &&
    input.reservation.reservationCreatedAt !== null &&
    input.expected.reservationCreatedAt !== null &&
    input.reservation.reservationCreatedAt.equals(
      input.expected.reservationCreatedAt
    ) &&
    input.reservation.reservationHoldExpiresAt !== null &&
    input.expected.reservationHoldExpiresAt !== null &&
    input.reservation.reservationHoldExpiresAt.equals(
      input.expected.reservationHoldExpiresAt
    ) &&
    Temporal.Instant.compare(
      input.reservation.reservationHoldExpiresAt,
      Temporal.Now.instant()
    ) > 0 &&
    marker?._tag === "candidate" &&
    marker.epoch === input.providerCreationEpoch &&
    marker.dotyposReservationId === input.reservation.dotyposReservationId &&
    marker.reservationCreatedAt.equals(input.reservation.reservationCreatedAt)
  );
};

const mustRotateCheckoutSession = (reservation: WorkspaceReservation) =>
  reservation.paymentState === "pending" ||
  reservation.paymentState === "paid" ||
  reservation.reservationState !== "held";

const enqueueReservationHoldCleanup = Effect.fn(
  "preparePayState.enqueueReservationHoldCleanup"
)(function* (input: {
  readonly orderId: string;
  readonly reservationHoldExpiresAt: Temporal.Instant;
}) {
  const cleanupSchedule = yield* ReservationHoldCleanupScheduleService;
  const enqueue = cleanupSchedule
    .enqueueCleanup({
      reason: "hold_expired",
      orderId: input.orderId,
      reservationHoldExpiresAt: input.reservationHoldExpiresAt,
    })
    .pipe(
      Effect.tapError(() =>
        Effect.logError("Workspace reservation hold cleanup enqueue failed", {
          orderId: input.orderId,
        })
      )
    );

  yield* enqueue.pipe(
    Effect.timeoutOrElse({
      duration: Duration.seconds(2),
      orElse: () =>
        Effect.fail(
          new ReservationHoldCleanupScheduleError({
            message: "Workspace reservation hold cleanup enqueue timed out",
          })
        ),
    })
  );
});
class ReservationHoldCleanupScheduleError extends Data.TaggedError(
  "ReservationHoldCleanupScheduleError"
)<{ readonly message: string }> {}

class PendingReservationTransition extends Data.TaggedError(
  "PendingReservationTransition"
)<{
  readonly reservation: WorkspaceReservation;
}> {}

type PendingReservationTransitionResult = Data.TaggedEnum<{
  settled: {
    readonly reservation: WorkspaceReservation | null;
  };
  timed_out: {
    readonly reservation: WorkspaceReservation;
  };
}>;

const PendingReservationTransitionResult =
  Data.taggedEnum<PendingReservationTransitionResult>();

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
  const pendingStates = input.pendingStates ?? [
    "creating_hold",
    "cancelling",
    "cancellation_claimed",
  ];
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
    Effect.map((reservation) =>
      PendingReservationTransitionResult.settled({ reservation })
    ),
    Effect.catchTag("PendingReservationTransition", (error) =>
      Effect.succeed(
        PendingReservationTransitionResult.timed_out({
          reservation: error.reservation,
        })
      )
    )
  );
});

const resolvePendingReservationTransition = Effect.fn(
  "prepareCoworkPayState.resolvePendingReservationTransition"
)(function* (input: {
  readonly reservations: WorkspaceReservationRepository;
  readonly reservation: WorkspaceReservation;
}) {
  const reconcileStaleCompensation = (
    reservation: WorkspaceReservation,
    epoch: string
  ) =>
    reconcileProviderHoldCreation({
      reservations: input.reservations,
      reservation,
      epoch,
      purpose: "compensation",
    });

  if (
    input.reservation.reservationState !== "creating_hold" &&
    input.reservation.reservationState !== "cancelling" &&
    input.reservation.reservationState !== "cancellation_claimed"
  ) {
    return input.reservation;
  }

  if (input.reservation.reservationState === "creating_hold") {
    const marker = getHoldCreationMarker(input.reservation);
    if (
      marker?._tag === "candidate" &&
      input.reservation.dotyposReservationId &&
      input.reservation.reservationHoldExpiresAt
    ) {
      return yield* recoverPersistedProviderHoldCandidate({
        reservation: input.reservation as WorkspaceReservation & {
          readonly dotyposReservationId: string;
          readonly reservationHoldExpiresAt: Temporal.Instant;
        },
        providerCreationEpoch: marker.epoch,
        reservationCreatedAt: marker.reservationCreatedAt,
      });
    }
    if (
      (marker?._tag === "provider_reconciliation" &&
        Temporal.Instant.compare(
          input.reservation.updatedAt,
          Temporal.Now.instant().subtract({ seconds: 60 })
        ) <= 0) ||
      marker?._tag === "recovery_required"
    ) {
      return yield* reconcileProviderHoldCreation({
        ...input,
        epoch: marker.epoch,
        purpose:
          marker._tag === "recovery_required" &&
          marker.reason === "compensation_incomplete"
            ? "compensation"
            : "creation",
      });
    }
    if (
      marker?._tag === "pre_provider" &&
      Temporal.Instant.compare(
        input.reservation.updatedAt,
        Temporal.Now.instant().subtract({ seconds: 60 })
      ) <= 0
    ) {
      const reclaimed =
        yield* input.reservations.reclaimStalePreProviderHoldCreation({
          id: input.reservation.id,
          epoch: marker.epoch,
          staleBefore: Temporal.Now.instant().subtract({ seconds: 60 }),
        });
      if (reclaimed) {
        return yield* input.reservations.findById(input.reservation.id);
      }
    }
    if (
      marker?._tag === "compensating" &&
      Temporal.Instant.compare(
        input.reservation.updatedAt,
        Temporal.Now.instant().subtract({ seconds: 60 })
      ) <= 0
    ) {
      return yield* reconcileStaleCompensation(input.reservation, marker.epoch);
    }
  }

  const transition = yield* waitForPendingReservationTransition({
    reservations: input.reservations,
    reservationId: input.reservation.id,
  });

  const settled = Match.value(transition).pipe(
    Match.tag("settled", ({ reservation }) => reservation),
    Match.tag("timed_out", ({ reservation }) => reservation),
    Match.exhaustive
  );
  if (!settled) return null;
  const marker = getHoldCreationMarker(settled);
  if (
    marker?._tag === "candidate" &&
    settled.dotyposReservationId &&
    settled.reservationHoldExpiresAt
  ) {
    return yield* recoverPersistedProviderHoldCandidate({
      reservation: settled as WorkspaceReservation & {
        readonly dotyposReservationId: string;
        readonly reservationHoldExpiresAt: Temporal.Instant;
      },
      providerCreationEpoch: marker.epoch,
      reservationCreatedAt: marker.reservationCreatedAt,
    });
  }
  if (
    marker?._tag === "compensating" &&
    Temporal.Instant.compare(
      settled.updatedAt,
      Temporal.Now.instant().subtract({ seconds: 60 })
    ) <= 0
  ) {
    return yield* reconcileStaleCompensation(settled, marker.epoch);
  }
  if (marker?._tag !== "pre_provider") return settled;
  const reclaimed =
    yield* input.reservations.reclaimStalePreProviderHoldCreation({
      id: settled.id,
      epoch: marker.epoch,
      staleBefore: Temporal.Now.instant().subtract({ seconds: 60 }),
    });
  return reclaimed ? yield* input.reservations.findById(settled.id) : settled;
});

const currentProviderEvidenceTimestamp = () => {
  const now = Temporal.Now.instant();
  return Temporal.Instant.fromEpochMilliseconds(now.epochMilliseconds);
};

const reconcileProviderHoldCreation = Effect.fn(
  "prepareCoworkPayState.reconcileProviderHoldCreation"
)(function* (input: {
  readonly reservations: WorkspaceReservationRepository;
  readonly reservation: WorkspaceReservation;
  readonly epoch: string;
  readonly purpose?: "creation" | "compensation";
}) {
  const purpose = input.purpose ?? "creation";
  const requireRecovery = (reason: HoldCreationRecoveryReason) =>
    purpose === "compensation"
      ? Effect.void
      : input.reservations.requireHoldCreationRecovery({
          id: input.reservation.id,
          epoch: input.epoch,
          reason,
        });
  const matches = yield* findWorkspaceDotyposReservationsByPaymentOrderId({
    paymentOrderId: input.reservation.id,
    providerCreationEpoch: input.epoch,
  }).pipe(Effect.tapError(() => requireRecovery("read_failed")));
  if (matches.length !== 1) {
    yield* requireRecovery(
      matches.length === 0 ? "zero_matches" : "multiple_matches"
    );
    yield* Effect.logWarning(
      "Workspace Dotypos reservation hold reconciliation remains pending",
      {
        reservationId: input.reservation.id,
        matchCount: matches.length,
      }
    );
    return input.reservation;
  }

  const [match] = matches;
  if (!match) return input.reservation;
  const dotyposReservationId = canonicalizeDotyposEntityId(match.id);
  if (!dotyposReservationId) {
    yield* requireRecovery("missing_id");
    yield* Effect.logWarning(
      "Workspace Dotypos reservation hold reconciliation found no usable ID",
      { reservationId: input.reservation.id }
    );
    return input.reservation;
  }

  if (
    canonicalizeDotyposEntityId(match._customerId) !==
      canonicalizeDotyposEntityId(input.reservation.dotyposCustomerId) ||
    !hasValidDotyposReservationRequestEvidence(match)
  ) {
    yield* requireRecovery("unsafe_status");
    yield* Effect.logWarning(
      "Workspace Dotypos reservation hold reconciliation refused mismatched evidence",
      { reservationId: input.reservation.id }
    );
    return input.reservation;
  }

  if (match.status === "CANCELLED") {
    yield* input.reservations.releaseHoldCreation({
      id: input.reservation.id,
      epoch: input.epoch,
    });
    return yield* input.reservations.findById(input.reservation.id);
  }

  if (purpose === "compensation" && match.status === "NEW") {
    const reservationCreatedAt =
      input.reservation.reservationCreatedAt ??
      currentProviderEvidenceTimestamp();
    yield* enqueueAttachmentCancellationCompensation({
      recoveryKind: "unattached",
      orderId: input.reservation.id,
      providerCreationEpoch: input.epoch,
      dotyposReservationId,
      reservationCreatedAt,
    });
    return (
      (yield* input.reservations.findById(input.reservation.id)) ??
      input.reservation
    );
  }

  if (
    match.status !== "NEW" ||
    input.reservation.reservationHoldExpiresAt === null
  ) {
    yield* requireRecovery("unsafe_status");
    yield* Effect.logWarning(
      "Workspace Dotypos reservation hold reconciliation refused provider state",
      {
        reservationId: input.reservation.id,
        providerStatus: match.status,
      }
    );
    return input.reservation;
  }

  const reservationCreatedAt =
    input.reservation.reservationCreatedAt ??
    currentProviderEvidenceTimestamp();
  yield* input.reservations.recordProviderHoldCandidate({
    epoch: input.epoch,
    id: input.reservation.id,
    dotyposReservationId,
    reservationCreatedAt,
  });
  yield* input.reservations
    .attachHold({
      epoch: input.epoch,
      id: input.reservation.id,
      dotyposReservationId,
      reservationCreatedAt,
    })
    .pipe(
      Effect.catch(
        Effect.fn(function* (cause) {
          yield* enqueueAttachmentCancellationCompensation({
            recoveryKind: "attachment_unknown",
            orderId: input.reservation.id,
            providerCreationEpoch: input.epoch,
            dotyposReservationId,
            reservationCreatedAt,
          });
          const definitive = yield* input.reservations.findById(
            input.reservation.id
          );
          if (
            definitive?.reservationState === "held" &&
            definitive.dotyposReservationId === dotyposReservationId
          ) {
            return;
          }
          return yield* cause;
        })
      )
    );
  yield* enqueueProviderHoldCandidateRecovery({
    orderId: input.reservation.id,
    providerCreationEpoch: input.epoch,
    dotyposReservationId,
    reservationCreatedAt,
  });
  return yield* input.reservations.findById(input.reservation.id);
});

const reconcileDifferentProviderAttachmentRecovery = Effect.fn(
  "prepareCoworkPayState.reconcileDifferentProviderAttachmentRecovery"
)(function* (input: {
  readonly reservations: WorkspaceReservationRepository;
  readonly reservation: WorkspaceReservation;
  readonly epoch: string;
  readonly dotyposReservationId: string;
  readonly reservationCreatedAt: Temporal.Instant;
}) {
  yield* enqueueAttachmentCancellationCompensation({
    recoveryKind: "different_provider",
    orderId: input.reservation.id,
    providerCreationEpoch: input.epoch,
    dotyposReservationId: input.dotyposReservationId,
    reservationCreatedAt: input.reservationCreatedAt,
  });
  if (!input.reservation.dotyposReservationId) {
    return input.reservation;
  }
  yield* verifyDifferentProviderAttachmentRecoveryEvidence({
    reservation: input.reservation as WorkspaceReservation & {
      readonly dotyposReservationId: string;
    },
    providerCreationEpoch: input.epoch,
    losingDotyposReservationId: input.dotyposReservationId,
  });
  yield* input.reservations.completeDifferentProviderAttachmentRecovery({
    id: input.reservation.id,
    epoch: input.epoch,
    dotyposReservationId: input.dotyposReservationId,
    reservationCreatedAt: input.reservationCreatedAt,
  });
  return (
    (yield* input.reservations.findById(input.reservation.id)) ??
    input.reservation
  );
});

class CheckoutAttemptUnavailableError extends Data.TaggedError(
  "CheckoutAttemptUnavailableError"
)<{
  readonly reservation?: WorkspaceReservation;
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

const requireDefinitiveReadyHold = Effect.fn(
  "prepareCoworkPayState.requireDefinitiveReadyHold"
)(function* (input: {
  readonly reservations: WorkspaceReservationRepository;
  readonly expected: WorkspaceReservation;
  readonly providerCreationEpoch?: string;
}) {
  const definitive = yield* input.reservations.findById(input.expected.id);
  const isExactFreshCandidate =
    definitive !== null &&
    input.providerCreationEpoch !== undefined &&
    isExactFreshProviderCandidate({
      reservation: definitive,
      expected: input.expected,
      providerCreationEpoch: input.providerCreationEpoch,
    });
  if (
    !definitive ||
    (!isReusableSubmissionReservation(definitive) && !isExactFreshCandidate) ||
    definitive.dotyposReservationId !== input.expected.dotyposReservationId ||
    getDifferentProviderAttachmentRecovery(definitive) ||
    (input.providerCreationEpoch !== undefined &&
      getAttachedHoldCreationEpoch(definitive) !==
        input.providerCreationEpoch &&
      !isExactFreshCandidate)
  ) {
    return yield* new CheckoutAttemptUnavailableError({
      reservation: definitive ?? input.expected,
    });
  }
  return definitive;
});

export type ReservationPreparationDecision = Data.TaggedEnum<{
  create_hold: {
    readonly checkoutSessionId: string;
    readonly epoch: string;
    readonly reservation: ReservationDraft;
  };
  reuse_hold: {
    readonly checkoutSessionId: string;
    readonly reservation: ReusableReservationHold;
  };
}>;

export const ReservationPreparationDecision =
  Data.taggedEnum<ReservationPreparationDecision>();

export const decideReservationPreparation = Effect.fn(
  "prepareCoworkPayState.decideReservationPreparation"
)(function* (input: {
  readonly reservations: WorkspaceReservationRepository;
  readonly checkoutSessionId: string;
  readonly reservation: WorkspaceReservation;
}) {
  if (isReusableSubmissionReservation(input.reservation)) {
    return ReservationPreparationDecision.reuse_hold({
      checkoutSessionId: input.checkoutSessionId,
      reservation: input.reservation,
    });
  }

  if (
    input.reservation.reservationState !== "draft" ||
    input.reservation.paymentState !== "not_started" ||
    input.reservation.dotyposReservationId !== null ||
    input.reservation.reservationHoldExpiresAt === null
  ) {
    return yield* new CheckoutAttemptUnavailableError({
      reservation: input.reservation,
    });
  }

  const epoch = yield* input.reservations.claimHoldCreation(
    input.reservation.id
  );
  if (epoch) {
    return ReservationPreparationDecision.create_hold({
      checkoutSessionId: input.checkoutSessionId,
      epoch,
      reservation: input.reservation as ReservationDraft,
    });
  }

  const transition = yield* waitForPendingReservationTransition({
    reservations: input.reservations,
    reservationId: input.reservation.id,
  });

  return yield* Match.value(transition).pipe(
    Match.tag("settled", ({ reservation }) =>
      reservation && isReusableSubmissionReservation(reservation)
        ? Effect.succeed(
            ReservationPreparationDecision.reuse_hold({
              checkoutSessionId: input.checkoutSessionId,
              reservation,
            })
          )
        : Effect.fail(
            new CheckoutAttemptUnavailableError({
              reservation: reservation ?? input.reservation,
            })
          )
    ),
    Match.tag("timed_out", ({ reservation }) =>
      Effect.fail(new CheckoutAttemptUnavailableError({ reservation }))
    ),
    Match.exhaustive
  );
});

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
  let conflictRetries = 0;
  const decideWithCleanup = (reservation: WorkspaceReservation) =>
    Effect.gen(function* () {
      let cleanupScheduled = false;
      if (
        reservation.reservationState === "held" &&
        reservation.dotyposReservationId &&
        reservation.reservationHoldExpiresAt
      ) {
        yield* enqueueReservationHoldCleanup({
          orderId: reservation.id,
          reservationHoldExpiresAt: reservation.reservationHoldExpiresAt,
        });
        cleanupScheduled = true;
      }
      const decision = yield* decideReservationPreparation({
        reservations,
        checkoutSessionId,
        reservation,
      });
      if (decision._tag === "reuse_hold" && !cleanupScheduled) {
        yield* enqueueReservationHoldCleanup({
          orderId: decision.reservation.id,
          reservationHoldExpiresAt:
            decision.reservation.reservationHoldExpiresAt,
        });
      }
      return decision;
    });

  while (true) {
    let checkoutAttemptKey = deriveCheckoutAttemptKey({
      checkoutSessionId,
      checkoutAttemptId: input.checkoutAttemptId,
      reservation: input.reservation,
    });

    let existingAttempt =
      yield* reservations.findByAttemptKey(checkoutAttemptKey);
    if (
      !existingAttempt &&
      checkoutSessionId === input.checkoutSessionId &&
      input.checkoutAttemptId !== input.checkoutSessionId
    ) {
      const rotatedAttemptKey = deriveCheckoutAttemptKey({
        checkoutSessionId: input.checkoutAttemptId,
        checkoutAttemptId: input.checkoutAttemptId,
        reservation: input.reservation,
      });
      existingAttempt = yield* reservations.findByAttemptKey(rotatedAttemptKey);
      if (existingAttempt) {
        checkoutSessionId = input.checkoutAttemptId;
        checkoutAttemptKey = rotatedAttemptKey;
      }
    }
    const checkoutSessionKey = deriveCheckoutSessionKey(checkoutSessionId);
    if (existingAttempt) {
      existingAttempt = yield* resolvePendingReservationTransition({
        reservations,
        reservation: existingAttempt,
      });
    }

    if (
      existingAttempt?.reservationState === "creating_hold" ||
      existingAttempt?.reservationState === "cancelling" ||
      existingAttempt?.reservationState === "cancellation_claimed"
    ) {
      return yield* new CheckoutAttemptUnavailableError({
        reservation: existingAttempt,
      });
    }

    if (existingAttempt) {
      const attachCancellationRecovery =
        getAttachCancellationRecovery(existingAttempt);
      if (attachCancellationRecovery) {
        yield* enqueueAttachmentCancellationCompensation({
          recoveryKind: "unattached",
          orderId: existingAttempt.id,
          providerCreationEpoch: attachCancellationRecovery.epoch,
          dotyposReservationId: attachCancellationRecovery.dotyposReservationId,
          reservationCreatedAt:
            existingAttempt.reservationCreatedAt ?? Temporal.Now.instant(),
        });
        return yield* new CheckoutAttemptUnavailableError({
          reservation: existingAttempt,
        });
      }
      const differentProviderRecovery =
        getDifferentProviderAttachmentRecovery(existingAttempt);
      if (differentProviderRecovery) {
        existingAttempt = yield* reconcileDifferentProviderAttachmentRecovery({
          reservations,
          reservation: existingAttempt,
          ...differentProviderRecovery,
        });
      }
      if (
        existingAttempt.reservationState === "draft" ||
        existingAttempt.reservationState === "held" ||
        isReusableSubmissionReservation(existingAttempt)
      ) {
        return yield* decideWithCleanup(existingAttempt);
      }

      return yield* new CheckoutAttemptUnavailableError({
        reservation: existingAttempt,
      });
    }

    const currentReservation =
      yield* reservations.findCurrentByCheckoutSessionKey(checkoutSessionKey);
    const currentMarker =
      currentReservation && getHoldCreationMarker(currentReservation);
    const isPriorPreProviderAttempt =
      currentReservation?.reservationState === "draft" ||
      (currentReservation?.reservationState === "creating_hold" &&
        currentMarker?._tag === "pre_provider");
    if (
      isPriorPreProviderAttempt &&
      currentReservation &&
      checkoutSessionId !== input.checkoutAttemptId
    ) {
      const retired = yield* reservations.retirePreProviderDraft({
        id: currentReservation.id,
        checkoutAttemptKey: currentReservation.checkoutAttemptKey,
      });
      if (!retired) {
        conflictRetries += 1;
        if (conflictRetries >= maxReservationPreparationConflictRetries) {
          return yield* new CheckoutAttemptUnavailableError({
            reservation: currentReservation,
          });
        }
        continue;
      }
      checkoutSessionId = input.checkoutAttemptId;
      continue;
    }
    if (
      currentReservation?.reservationState === "creating_hold" ||
      currentReservation?.reservationState === "cancelling" ||
      currentReservation?.reservationState === "cancellation_claimed" ||
      currentReservation?.reservationState === "draft"
    ) {
      const transition = yield* waitForPendingReservationTransition({
        reservations,
        reservationId: currentReservation.id,
        pendingStates: [
          "draft",
          "creating_hold",
          "cancelling",
          "cancellation_claimed",
        ],
      });
      const settledReservation = Match.value(transition).pipe(
        Match.tag("settled", ({ reservation }) => reservation),
        Match.tag("timed_out", ({ reservation }) => reservation),
        Match.exhaustive
      );
      if (
        settledReservation?.reservationState === "draft" ||
        settledReservation?.reservationState === "creating_hold" ||
        settledReservation?.reservationState === "cancelling" ||
        settledReservation?.reservationState === "cancellation_claimed"
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
      if (hasUnresolvedProviderAttachmentRecovery(currentReservation)) {
        return yield* new CheckoutAttemptUnavailableError({
          reservation: currentReservation,
        });
      }

      const cancellationOwnerId = randomUUID();
      const claimed = yield* reservations.claimSupersessionCancellation({
        id: currentReservation.id,
        ownerId: cancellationOwnerId,
      });
      if (!claimed) {
        conflictRetries += 1;
        if (conflictRetries >= maxReservationPreparationConflictRetries) {
          return yield* new CheckoutAttemptUnavailableError({
            reservation: currentReservation,
          });
        }
        continue;
      }

      const dotyposReservationId = claimed.dotyposReservationId;
      if (!dotyposReservationId) {
        return yield* new CheckoutAttemptUnavailableError({
          reservation: claimed,
        });
      }

      const cancellation = yield* Effect.gen(function* () {
        const status =
          yield* dotypos.getReservationStatus(dotyposReservationId);
        const action = getDotyposCancellationAction(status);
        const owned = yield* reservations.renewCancellationClaim({
          id: claimed.id,
          ownerId: cancellationOwnerId,
          recoveryReason: "supersession_recovery",
        });
        if (!owned) {
          yield* Effect.logWarning(
            "Checkout supersession cancellation ownership changed before provider action",
            { reservationId: claimed.id }
          );
          return {
            cancelled: false,
            disposition: "retryable" as const,
          };
        }
        if (action === "complete") {
          return {
            cancelled: true,
            disposition: "retryable" as const,
          };
        }
        if (action === "refuse") {
          yield* Effect.logError(
            "Checkout supersession refused to cancel a non-pending Dotypos reservation",
            {
              reservationId: claimed.id,
              dotyposReservationId,
              status,
            }
          );
          return {
            cancelled: false,
            disposition: "manual_review" as const,
          };
        }

        if (!owned.dotyposReservationId) {
          return {
            cancelled: false,
            disposition: "retryable" as const,
          };
        }
        yield* dotypos.cancelReservation(owned.dotyposReservationId);
        return {
          cancelled: true,
          disposition: "retryable" as const,
        };
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
            return {
              cancelled: false,
              disposition: "retryable" as const,
            };
          })
        )
      );

      if (!cancellation.cancelled) {
        yield* reservations
          .markCancellationFailed({
            id: claimed.id,
            ownerId: cancellationOwnerId,
            disposition: cancellation.disposition,
            recoveryReason: "supersession_recovery",
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
            cancellationOwnerId,
            cancelledAt,
            replacement: {
              ...input.draft,
              checkoutSessionKey,
              checkoutAttemptKey,
            },
          })
        ),
        Effect.flatMap((reservation) => decideWithCleanup(reservation)),
        Effect.tapError(() =>
          reservations
            .markCancelled({
              id: claimed.id,
              ownerId: cancellationOwnerId,
              recoveryReason: "supersession_recovery",
              cancelledAt,
            })
            .pipe(Effect.ignore)
        )
      );
    }

    yield* ensureReservationAvailable({
      availability,
      reservation: input.reservation,
    });
    const acquisition = yield* reservations.acquireDraft({
      ...input.draft,
      checkoutSessionKey,
      checkoutAttemptKey,
    });
    const preparationDecision = yield* Match.value(acquisition).pipe(
      Match.tag("created", ({ reservation }) => decideWithCleanup(reservation)),
      Match.tag("conflict_unresolved", () =>
        Effect.fail(new CheckoutAttemptUnavailableError({}))
      ),
      Match.tag("existing_attempt", ({ reservation }) =>
        resolvePendingReservationTransition({
          reservations,
          reservation,
        }).pipe(
          Effect.flatMap((resolvedReservation) =>
            resolvedReservation
              ? decideWithCleanup(resolvedReservation)
              : Effect.fail(
                  new CheckoutAttemptUnavailableError({ reservation })
                )
          )
        )
      ),
      Match.tag("session_occupied", ({ reservation }) => {
        conflictRetries += 1;
        return conflictRetries >= maxReservationPreparationConflictRetries
          ? Effect.fail(new CheckoutAttemptUnavailableError({ reservation }))
          : Effect.succeed(null);
      }),
      Match.exhaustive
    );
    if (!preparationDecision) continue;

    return preparationDecision;
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
    const holdExpiresAt = getReservationHoldExpiresAt(Temporal.Now.instant());
    const accessCodes = yield* WorkspaceCheckoutAccessCodeService;
    const customerAccessCode = yield* accessCodes.generateCustomerAccessCode;

    const preparationDecision = yield* prepareReservationDraft({
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
    const { checkoutSessionId, reservation: reservationDraft } =
      preparationDecision;
    yield* Effect.logInfo("Workspace reservation preparation decided", {
      decision: preparationDecision._tag,
      reservationId: reservationDraft.id,
    });

    return yield* Effect.gen(function* () {
      const prepared = yield* quotePreparedReservation({
        advertisement,
        dotyposCustomerId: yield* getDotyposCustomerId(
          reservationDraft.dotyposCustomerId
        ),
        locale: input.locale,
      });
      yield* Effect.annotateLogsScoped({ quote: prepared.quote });
      yield* Effect.logDebug("Workspace reservation quote built");

      const reusedResult = yield* Match.value(preparationDecision).pipe(
        Match.tag("create_hold", () => Effect.succeed(null)),
        Match.tag("reuse_hold", ({ reservation }) =>
          Effect.gen(function* () {
            yield* Effect.logInfo(
              "Existing workspace reservation hold reused for an immediate retry"
            );

            yield* legalEvents.recordMany(
              Object.values(privacyEvidence).map((evidence) => ({
                workspaceReservationId: reservation.id,
                evidence,
              }))
            );
            const definitiveReservation = yield* requireDefinitiveReadyHold({
              reservations,
              expected: reservation,
            });
            yield* Effect.logInfo("Workspace reservation checkout prep ready");

            return yield* toReadyResult({
              locale: input.locale,
              prepared,
              reservationId: definitiveReservation.id,
              checkoutSessionId,
              changedKeys: advertisement.changedKeys,
            });
          })
        ),
        Match.exhaustive
      );
      if (reusedResult) return reusedResult;
      if (preparationDecision._tag !== "create_hold") {
        return yield* new CheckoutAttemptUnavailableError({
          reservation: reservationDraft,
        });
      }
      const providerEpoch = preparationDecision.epoch;
      const persistedHoldExpiresAt = reservationDraft.reservationHoldExpiresAt;

      yield* Effect.logDebug("Workspace reservation hold creation claimed");

      const checkoutDetails = getReservationCheckoutDetails({
        locale: input.locale,
        prepared,
        legalEvidence: privacyEvidence,
      });
      const preparedDotyposReservation =
        yield* prepareWorkspaceDotyposReservation({
          paymentOrderId: reservationDraft.id,
          providerCreationEpoch: providerEpoch,
          dotyposCustomerId: reservationDraft.dotyposCustomerId,
          checkoutDetails,
          reservation: checkoutDetails.reservation,
          status: "NEW",
        });
      const { dotyposReservationId, reservationCreatedAt } =
        yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const providerBoundaryStarted =
              yield* reservations.beginProviderHoldCreation({
                id: reservationDraft.id,
                epoch: providerEpoch,
              });
            if (!providerBoundaryStarted) {
              return yield* new CheckoutAttemptUnavailableError({
                reservation: reservationDraft,
              });
            }
            const dotyposReservation = yield* restore(
              createWorkspaceDotyposReservation(preparedDotyposReservation)
            );
            const dotyposReservationId = yield* decodeDotyposEntityId({
              value: dotyposReservation,
              missingIdMessage: "Dotypos reservation was created without an ID",
            });
            yield* Effect.logInfo("Workspace Dotypos reservation hold created");

            const reservationCreatedAt = currentProviderEvidenceTimestamp();
            const exactProviderEvidence = {
              recoveryKind: "attachment_unknown" as const,
              orderId: reservationDraft.id,
              providerCreationEpoch: providerEpoch,
              dotyposReservationId,
              reservationCreatedAt,
            };
            let exactEvidenceHandoffAttempted = false;

            yield* reservations
              .recordProviderHoldCandidate({
                epoch: providerEpoch,
                id: reservationDraft.id,
                dotyposReservationId,
                reservationCreatedAt,
              })
              .pipe(
                Effect.catchCause((cause) =>
                  enqueueAttachmentCancellationCompensation(
                    exactProviderEvidence
                  ).pipe(Effect.andThen(Effect.failCause(cause)))
                )
              );
            yield* reservations
              .attachHold({
                epoch: providerEpoch,
                id: reservationDraft.id,
                dotyposReservationId,
                reservationCreatedAt,
              })
              .pipe(
                Effect.catch(
                  Effect.fn(function* (cause) {
                    yield* Effect.logError(
                      "Workspace reservation hold attach failed; scheduling owned cancellation compensation",
                      { reservationId: reservationDraft.id }
                    );

                    exactEvidenceHandoffAttempted = true;
                    yield* enqueueAttachmentCancellationCompensation(
                      exactProviderEvidence
                    );
                    const definitiveReservation = yield* reservations.findById(
                      reservationDraft.id
                    );
                    if (
                      definitiveReservation?.reservationState === "held" &&
                      definitiveReservation.dotyposReservationId ===
                        dotyposReservationId
                    ) {
                      return;
                    }
                    if (
                      definitiveReservation?.reservationState === "held" &&
                      definitiveReservation.dotyposReservationId &&
                      definitiveReservation.dotyposReservationId !==
                        dotyposReservationId &&
                      getAttachedHoldCreationEpoch(definitiveReservation) ===
                        providerEpoch
                    ) {
                      return yield* new CheckoutAttemptUnavailableError({
                        reservation: definitiveReservation,
                      });
                    }
                    return yield* cause;
                  })
                ),
                Effect.onExit((exit) =>
                  Exit.isFailure(exit) && !exactEvidenceHandoffAttempted
                    ? enqueueAttachmentCancellationCompensation(
                        exactProviderEvidence
                      ).pipe(Effect.exit, Effect.asVoid)
                    : Effect.void
                )
              );
            exactEvidenceHandoffAttempted = true;
            yield* enqueueProviderHoldCandidateRecovery({
              orderId: reservationDraft.id,
              providerCreationEpoch: providerEpoch,
              dotyposReservationId,
              reservationCreatedAt,
            });

            return { dotyposReservationId, reservationCreatedAt };
          })
        );
      yield* Effect.logInfo("Workspace reservation hold attached");
      yield* enqueueReservationHoldCleanup({
        orderId: reservationDraft.id,
        reservationHoldExpiresAt: persistedHoldExpiresAt,
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

      const definitiveReservation = yield* requireDefinitiveReadyHold({
        reservations,
        expected: {
          ...reservationDraft,
          dotyposReservationId,
          reservationCreatedAt,
          reservationState: "held",
        } as WorkspaceReservation,
        providerCreationEpoch: providerEpoch,
      });
      yield* Effect.logInfo("Workspace reservation checkout prep ready");

      return yield* toReadyResult({
        locale: input.locale,
        prepared,
        reservationId: definitiveReservation.id,
        checkoutSessionId,
        changedKeys: advertisement.changedKeys,
      });
    }).pipe(
      Effect.ensuring(
        Match.value(preparationDecision).pipe(
          Match.tag("create_hold", ({ epoch, reservation }) =>
            reservations
              .reclaimPreProviderHoldCreation({
                id: reservation.id,
                epoch,
              })
              .pipe(
                Effect.catchCause(() =>
                  Effect.logError(
                    "Reservation pre-provider hold creation reclaim failed",
                    { reservationId: reservation.id }
                  )
                ),
                Effect.asVoid
              )
          ),
          Match.tag("reuse_hold", () => Effect.void),
          Match.exhaustive
        )
      )
    );
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
