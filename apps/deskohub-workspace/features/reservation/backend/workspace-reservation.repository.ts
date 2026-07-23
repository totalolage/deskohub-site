import { randomUUID } from "node:crypto";
import { canonicalizeDotyposEntityId } from "@deskohub/dotypos";
import { and, asc, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type WorkspaceReservation as WorkspaceReservationRow,
  workspaceReservations,
} from "@/db/schema";
import { postgresUuidV7 } from "@/db/uuid-v7";
import { withCoworkProductFields } from "@/features/reservation/cowork-reservation-product";
import {
  type StoredWorkspaceReservationDetails,
  storedWorkspaceReservationDetailsSchema,
} from "@/features/reservation/persistence-contracts";

const withReservationKindFields = (reservation: WorkspaceReservationRow) => {
  const reservationWithCoworkFields = withCoworkProductFields(reservation);

  // Compose field enrichments for additional reservation kinds here.
  return reservationWithCoworkFields;
};

export type WorkspaceReservation = ReturnType<typeof withReservationKindFields>;

export class WorkspaceReservationStateError extends Data.TaggedError(
  "WorkspaceReservationStateError"
)<{
  readonly operation: string;
  readonly reservationId: string;
  readonly message: string;
}> {}

export class WorkspaceReservationDetailsMalformedError extends Data.TaggedError(
  "WorkspaceReservationDetailsMalformedError"
)<{
  readonly reservationId: string;
  readonly message: string;
  readonly cause: unknown;
}> {}

export interface CreateWorkspaceReservationInput {
  readonly checkoutSessionKey: string;
  readonly checkoutAttemptKey: string;
  readonly dotyposCustomerId: string;
  readonly customerAccessCode: string;
  readonly reservationDetails: StoredWorkspaceReservationDetails;
  readonly locale: string;
  readonly reservationHoldExpiresAt?: Temporal.Instant;
}

export type ReservationDraftAcquisition = Data.TaggedEnum<{
  created: {
    readonly reservation: WorkspaceReservation;
  };
  conflict_unresolved: { readonly none?: never };
  existing_attempt: {
    readonly reservation: WorkspaceReservation;
  };
  session_occupied: {
    readonly reservation: WorkspaceReservation;
  };
}>;

export const ReservationDraftAcquisition =
  Data.taggedEnum<ReservationDraftAcquisition>();

const preProviderHoldCreationMarker = (epoch: string) =>
  `hold_creation_pre_provider:${epoch}`;
const retiredPreProviderDraftMarker = "hold_creation_pre_provider_retired";
const providerHoldCreationReconciliationMarker = (epoch: string) =>
  `hold_creation_provider_reconciliation:${epoch}`;
const providerHoldCreationCompensationMarker = (epoch: string) =>
  `hold_creation_compensating:${epoch}`;
export const providerHoldCandidateStabilizationSeconds = 2 * 60;
const providerHoldCreationCandidateMarker = (
  epoch: string,
  dotyposReservationId: string,
  reservationCreatedAt: Temporal.Instant,
  stabilizationDeadline?: Temporal.Instant
) =>
  `hold_creation_candidate:${epoch}:${dotyposReservationId}:${reservationCreatedAt.epochMilliseconds}${stabilizationDeadline ? `:${stabilizationDeadline.epochMilliseconds}` : ""}`;
const providerHoldCreationCandidateCompensationMarker = (
  epoch: string,
  dotyposReservationId: string,
  reservationCreatedAt: Temporal.Instant
) =>
  `hold_creation_candidate_compensating:${epoch}:${dotyposReservationId}:${reservationCreatedAt.epochMilliseconds}`;
const providerHoldCreationAttachedMarker = (epoch: string) =>
  `hold_creation_attached:${epoch}`;

type ProviderHoldCandidateFence = {
  readonly dotyposReservationId: string;
  readonly reservationCreatedAt: Temporal.Instant;
  readonly stabilizationDeadline: Temporal.Instant;
};

const providerHoldCandidateFenceSuffix = (
  candidateFence?: ProviderHoldCandidateFence
) =>
  candidateFence
    ? `:candidate:${candidateFence.dotyposReservationId}:${candidateFence.reservationCreatedAt.epochMilliseconds}:${candidateFence.stabilizationDeadline.epochMilliseconds}`
    : "";

const providerHoldCreationOrphanRecoveryMarker = (
  epoch: string,
  dotyposReservationId: string,
  reservationCreatedAt: Temporal.Instant,
  candidateFence?: ProviderHoldCandidateFence
) =>
  `hold_creation_orphan_recovery:${epoch}:${dotyposReservationId}:${reservationCreatedAt.epochMilliseconds}${providerHoldCandidateFenceSuffix(candidateFence)}`;
const providerHoldCreationOrphanProcessingMarker = (
  epoch: string,
  dotyposReservationId: string,
  reservationCreatedAt: Temporal.Instant,
  ownerId: string,
  candidateFence?: ProviderHoldCandidateFence
) =>
  `hold_creation_orphan_processing:${epoch}:${dotyposReservationId}:${reservationCreatedAt.epochMilliseconds}:${ownerId}${providerHoldCandidateFenceSuffix(candidateFence)}`;
const providerHoldCreationOrphanResolvedMarker = (
  epoch: string,
  dotyposReservationId: string,
  reservationCreatedAt: Temporal.Instant
) =>
  `hold_creation_orphan_resolved:${epoch}:${dotyposReservationId}:${reservationCreatedAt.epochMilliseconds}`;

export const hasNoUnresolvedProviderAttachmentRecovery = () =>
  sql`(${workspaceReservations.failureCode} is null or (${workspaceReservations.failureCode} not like 'hold_creation_candidate:%' and ${workspaceReservations.failureCode} not like 'hold_creation_candidate_compensating:%' and ${workspaceReservations.failureCode} not like 'hold_creation_orphan_recovery:%' and ${workspaceReservations.failureCode} not like 'hold_creation_orphan_processing:%'))`;

export const hasUnresolvedProviderAttachmentRecovery = (
  reservation: Pick<WorkspaceReservation, "failureCode">
) =>
  reservation.failureCode?.startsWith("hold_creation_candidate:") === true ||
  reservation.failureCode?.startsWith(
    "hold_creation_candidate_compensating:"
  ) === true ||
  reservation.failureCode?.startsWith("hold_creation_orphan_recovery:") ===
    true ||
  reservation.failureCode?.startsWith("hold_creation_orphan_processing:") ===
    true;

export type HoldCreationRecoveryReason =
  | "compensation_incomplete"
  | "missing_id"
  | "multiple_matches"
  | "read_failed"
  | "unsafe_status"
  | "zero_matches";

const providerHoldCreationRecoveryMarker = (
  epoch: string,
  reason: HoldCreationRecoveryReason
) => `hold_creation_recovery_required:${epoch}:${reason}`;

export type HoldCreationMarker = Data.TaggedEnum<{
  pre_provider: { readonly epoch: string };
  provider_reconciliation: { readonly epoch: string };
  recovery_required: {
    readonly epoch: string;
    readonly reason: HoldCreationRecoveryReason;
  };
  compensating: { readonly epoch: string };
  candidate: {
    readonly epoch: string;
    readonly dotyposReservationId: string;
    readonly reservationCreatedAt: Temporal.Instant;
    readonly stabilizationDeadline?: Temporal.Instant;
  };
  candidate_compensating: {
    readonly epoch: string;
    readonly dotyposReservationId: string;
    readonly reservationCreatedAt: Temporal.Instant;
  };
}>;

export const HoldCreationMarker = Data.taggedEnum<HoldCreationMarker>();

export const getHoldCreationMarker = (
  reservation: Pick<
    WorkspaceReservation,
    "dotyposReservationId" | "failureCode" | "reservationState"
  >
): HoldCreationMarker | null => {
  if (!reservation.failureCode) {
    return null;
  }
  const [kind, epoch, value, createdAtMillis, stabilizationDeadlineMillis] =
    reservation.failureCode.split(":");
  if (!epoch) return null;
  if (
    (kind === "hold_creation_candidate" ||
      kind === "hold_creation_candidate_compensating") &&
    (reservation.reservationState === "creating_hold" ||
      reservation.reservationState === "held") &&
    reservation.dotyposReservationId
  ) {
    const dotyposReservationId = canonicalizeDotyposEntityId(value);
    const createdAt = Number(createdAtMillis);
    const stabilizationDeadline = Number(stabilizationDeadlineMillis);
    if (
      !dotyposReservationId ||
      dotyposReservationId !== reservation.dotyposReservationId ||
      !Number.isSafeInteger(createdAt) ||
      (stabilizationDeadlineMillis !== undefined &&
        !Number.isSafeInteger(stabilizationDeadline))
    ) {
      return null;
    }
    const candidate = {
      epoch,
      dotyposReservationId,
      reservationCreatedAt: Temporal.Instant.fromEpochMilliseconds(createdAt),
      ...(Number.isSafeInteger(stabilizationDeadline) && {
        stabilizationDeadline: Temporal.Instant.fromEpochMilliseconds(
          stabilizationDeadline
        ),
      }),
    };
    return kind === "hold_creation_candidate"
      ? HoldCreationMarker.candidate(candidate)
      : HoldCreationMarker.candidate_compensating(candidate);
  }
  if (reservation.reservationState !== "creating_hold") return null;
  if (kind === "hold_creation_pre_provider") {
    return HoldCreationMarker.pre_provider({ epoch });
  }
  if (kind === "hold_creation_provider_reconciliation") {
    return HoldCreationMarker.provider_reconciliation({ epoch });
  }
  if (kind === "hold_creation_compensating") {
    return HoldCreationMarker.compensating({ epoch });
  }
  if (
    kind === "hold_creation_recovery_required" &&
    (value === "missing_id" ||
      value === "compensation_incomplete" ||
      value === "multiple_matches" ||
      value === "read_failed" ||
      value === "unsafe_status" ||
      value === "zero_matches")
  ) {
    return HoldCreationMarker.recovery_required({ epoch, reason: value });
  }
  return null;
};

export const getAttachedHoldCreationEpoch = (
  reservation: Pick<
    WorkspaceReservation,
    "dotyposReservationId" | "failureCode" | "reservationState"
  >
) => {
  if (
    reservation.reservationState !== "held" ||
    !reservation.dotyposReservationId ||
    !reservation.failureCode
  ) {
    return null;
  }
  const [kind, epoch] = reservation.failureCode.split(":");
  return (kind === "hold_creation_attached" ||
    kind === "hold_creation_orphan_resolved") &&
    epoch
    ? epoch
    : null;
};

export const getDifferentProviderAttachmentRecovery = (
  reservation: Pick<
    WorkspaceReservation,
    | "dotyposReservationId"
    | "failureCode"
    | "reservationCreatedAt"
    | "reservationState"
  >
) => {
  if (
    reservation.reservationState !== "held" ||
    !reservation.dotyposReservationId ||
    !reservation.failureCode
  ) {
    return null;
  }
  const parts = reservation.failureCode.split(":");
  const [kind, epoch, rawDotyposReservationId, rawCreatedAt] = parts;
  const dotyposReservationId = canonicalizeDotyposEntityId(
    rawDotyposReservationId
  );
  const createdAt = Number(rawCreatedAt);
  const hasExactTimestamp = Number.isSafeInteger(createdAt);
  const reservationCreatedAt = hasExactTimestamp
    ? Temporal.Instant.fromEpochMilliseconds(createdAt)
    : (reservation.reservationCreatedAt ??
      Temporal.Instant.fromEpochMilliseconds(0));
  const isProcessing = kind === "hold_creation_orphan_processing";
  const ownerId = isProcessing
    ? Number.isSafeInteger(createdAt)
      ? parts[4]
      : rawCreatedAt
    : undefined;
  const candidateOffset = isProcessing ? 5 : 4;
  const hasCandidateFence = parts[candidateOffset] === "candidate";
  const candidateFence = hasCandidateFence
    ? parseProviderHoldCandidateFence(parts.slice(candidateOffset + 1))
    : undefined;
  if (!epoch || !dotyposReservationId) return null;
  if (
    hasCandidateFence &&
    (!candidateFence ||
      candidateFence.dotyposReservationId !==
        reservation.dotyposReservationId ||
      !reservation.reservationCreatedAt?.equals(
        candidateFence.reservationCreatedAt
      ))
  ) {
    return null;
  }
  if (kind === "hold_creation_orphan_recovery") {
    return {
      epoch,
      dotyposReservationId,
      reservationCreatedAt,
      hasExactTimestamp,
      candidateFence,
      phase: "pending" as const,
    };
  }
  return kind === "hold_creation_orphan_processing" && ownerId
    ? {
        epoch,
        dotyposReservationId,
        reservationCreatedAt,
        hasExactTimestamp,
        ownerId,
        candidateFence,
        phase: "processing" as const,
      }
    : null;
};

const parseProviderHoldCandidateFence = (
  parts: readonly string[]
): ProviderHoldCandidateFence | undefined => {
  const [rawProviderId, rawCreatedAt, rawDeadline] = parts;
  const dotyposReservationId = canonicalizeDotyposEntityId(rawProviderId);
  const createdAt = Number(rawCreatedAt);
  const deadline = Number(rawDeadline);
  return dotyposReservationId &&
    Number.isSafeInteger(createdAt) &&
    Number.isSafeInteger(deadline)
    ? {
        dotyposReservationId,
        reservationCreatedAt: Temporal.Instant.fromEpochMilliseconds(createdAt),
        stabilizationDeadline: Temporal.Instant.fromEpochMilliseconds(deadline),
      }
    : undefined;
};

export const getProviderHoldCandidateStabilizationDeadline = (
  reservation: Pick<
    WorkspaceReservation,
    "dotyposReservationId" | "failureCode" | "reservationState" | "updatedAt"
  >
) => {
  const marker = getHoldCreationMarker(reservation);
  return marker?._tag === "candidate"
    ? (marker.stabilizationDeadline ??
        reservation.updatedAt.add({
          seconds: providerHoldCandidateStabilizationSeconds,
        }))
    : null;
};

const getProviderHoldCandidateFence = (
  reservation: Pick<
    WorkspaceReservation,
    "dotyposReservationId" | "failureCode" | "reservationState" | "updatedAt"
  >,
  epoch: string
): ProviderHoldCandidateFence | undefined => {
  const marker = getHoldCreationMarker(reservation);
  const stabilizationDeadline =
    getProviderHoldCandidateStabilizationDeadline(reservation);
  return marker?._tag === "candidate" &&
    marker.epoch === epoch &&
    stabilizationDeadline
    ? {
        dotyposReservationId: marker.dotyposReservationId,
        reservationCreatedAt: marker.reservationCreatedAt,
        stabilizationDeadline,
      }
    : undefined;
};

export const getResolvedDifferentProviderAttachmentRecovery = (
  reservation: Pick<
    WorkspaceReservation,
    | "dotyposReservationId"
    | "failureCode"
    | "reservationCreatedAt"
    | "reservationState"
  >
) => {
  if (
    reservation.reservationState !== "held" ||
    !reservation.dotyposReservationId ||
    !reservation.failureCode
  ) {
    return null;
  }
  const [kind, epoch, rawDotyposReservationId, rawCreatedAt] =
    reservation.failureCode.split(":");
  const dotyposReservationId = canonicalizeDotyposEntityId(
    rawDotyposReservationId
  );
  const createdAt = Number(rawCreatedAt);
  const hasExactTimestamp = Number.isSafeInteger(createdAt);
  const reservationCreatedAt = hasExactTimestamp
    ? Temporal.Instant.fromEpochMilliseconds(createdAt)
    : (reservation.reservationCreatedAt ??
      Temporal.Instant.fromEpochMilliseconds(0));
  return kind === "hold_creation_orphan_resolved" &&
    epoch &&
    dotyposReservationId &&
    reservationCreatedAt
    ? {
        epoch,
        dotyposReservationId,
        reservationCreatedAt,
        hasExactTimestamp,
      }
    : null;
};

export const getAttachCancellationRecovery = (
  reservation: Pick<
    WorkspaceReservation,
    "dotyposReservationId" | "failureCode" | "reservationState"
  >
) => {
  if (
    !["cancellation_failed", "cancelling", "cancelled"].includes(
      reservation.reservationState
    ) ||
    !reservation.failureCode
  ) {
    return null;
  }
  const [kind, epoch] = reservation.failureCode.split(":");
  const dotyposReservationId = canonicalizeDotyposEntityId(
    reservation.dotyposReservationId
  );
  return kind === "attach_failed_cancel_failed" && epoch && dotyposReservationId
    ? { epoch, dotyposReservationId }
    : null;
};

export interface WorkspaceReservationRepository {
  readonly acquireDraft: (
    input: CreateWorkspaceReservationInput
  ) => Effect.Effect<
    ReservationDraftAcquisition,
    | EffectDrizzleQueryError
    | WorkspaceReservationDetailsMalformedError
    | WorkspaceReservationStateError
  >;
  readonly findById: (
    id: string
  ) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly findByAttemptKey: (
    checkoutAttemptKey: string
  ) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly findCurrentByCheckoutSessionKey: (
    checkoutSessionKey: string
  ) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly retirePreProviderDraft: (input: {
    readonly id: string;
    readonly checkoutAttemptKey: string;
  }) => Effect.Effect<boolean, EffectDrizzleQueryError>;
  readonly updateReservationDetails: (input: {
    readonly id: string;
    readonly reservationDetails: StoredWorkspaceReservationDetails;
    readonly locale: string;
  }) => Effect.Effect<
    WorkspaceReservation,
    | EffectDrizzleQueryError
    | WorkspaceReservationDetailsMalformedError
    | WorkspaceReservationStateError
  >;
  readonly claimHoldCreation: (
    id: string
  ) => Effect.Effect<string | null, EffectDrizzleQueryError>;
  readonly beginProviderHoldCreation: (input: {
    readonly id: string;
    readonly epoch: string;
  }) => Effect.Effect<boolean, EffectDrizzleQueryError>;
  readonly reclaimPreProviderHoldCreation: (input: {
    readonly id: string;
    readonly epoch: string;
  }) => Effect.Effect<boolean, EffectDrizzleQueryError>;
  readonly reclaimStalePreProviderHoldCreation: (input: {
    readonly id: string;
    readonly epoch: string;
    readonly staleBefore: Temporal.Instant;
  }) => Effect.Effect<boolean, EffectDrizzleQueryError>;
  readonly releaseHoldCreation: (input: {
    readonly id: string;
    readonly epoch: string;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly requireHoldCreationRecovery: (input: {
    readonly id: string;
    readonly epoch: string;
    readonly reason: HoldCreationRecoveryReason;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly claimHoldCreationCompensation: (input: {
    readonly id: string;
    readonly epoch: string;
  }) => Effect.Effect<boolean, EffectDrizzleQueryError>;
  readonly recordProviderHoldCandidate: (input: {
    readonly epoch: string;
    readonly id: string;
    readonly dotyposReservationId: string;
    readonly reservationCreatedAt: Temporal.Instant;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly attachHold: (input: {
    readonly epoch: string;
    readonly id: string;
    readonly dotyposReservationId: string;
    readonly reservationCreatedAt: Temporal.Instant;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly completeProviderHoldCandidate: (input: {
    readonly epoch: string;
    readonly id: string;
    readonly dotyposReservationId: string;
    readonly reservationCreatedAt: Temporal.Instant;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly markAttachFailedCancellationRequired: (input: {
    readonly epoch: string;
    readonly id: string;
    readonly dotyposReservationId: string;
    readonly reservationCreatedAt: Temporal.Instant;
    readonly failureCode: string;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly recordDifferentProviderAttachmentRecovery: (input: {
    readonly id: string;
    readonly epoch: string;
    readonly dotyposReservationId: string;
    readonly reservationCreatedAt: Temporal.Instant;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly claimDifferentProviderAttachmentRecovery: (input: {
    readonly id: string;
    readonly epoch: string;
    readonly dotyposReservationId: string;
    readonly reservationCreatedAt: Temporal.Instant;
    readonly ownerId: string;
    readonly staleBefore: Temporal.Instant;
  }) => Effect.Effect<
    boolean,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly releaseDifferentProviderAttachmentRecovery: (input: {
    readonly id: string;
    readonly epoch: string;
    readonly dotyposReservationId: string;
    readonly reservationCreatedAt: Temporal.Instant;
    readonly ownerId: string;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly completeDifferentProviderAttachmentRecovery: (input: {
    readonly id: string;
    readonly epoch: string;
    readonly dotyposReservationId: string;
    readonly reservationCreatedAt: Temporal.Instant;
    readonly ownerId?: string;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly claimCancellation: (
    id: string
  ) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly claimSupersessionCancellation: (
    id: string
  ) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly markCancelled: (input: {
    readonly id: string;
    readonly cancelledAt: Temporal.Instant;
    readonly holdExpiredAt?: Temporal.Instant;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly completeSupersessionAndCreateDraft: (input: {
    readonly cancelledReservationId: string;
    readonly cancelledAt: Temporal.Instant;
    readonly replacement: CreateWorkspaceReservationInput;
  }) => Effect.Effect<
    WorkspaceReservation,
    | EffectDrizzleQueryError
    | SqlError.SqlError
    | WorkspaceReservationDetailsMalformedError
    | WorkspaceReservationStateError
  >;
  readonly markCancellationFailed: (input: {
    readonly id: string;
    readonly failureCode: string;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly recordHoldCleanupSkipped: (input: {
    readonly id: string;
    readonly holdExpiredAt: Temporal.Instant;
    readonly failureCode: string;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly markPaymentPaid: (input: {
    readonly id: string;
    readonly paymentAttemptId: string;
    readonly paidAt: Temporal.Instant;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly markPaymentTerminal: (input: {
    readonly id: string;
    readonly paymentAttemptId: string;
    readonly paymentState: "failed" | "cancelled" | "expired";
    readonly failureCode: string;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly claimPaidFulfillment: (input: {
    readonly id: string;
    readonly staleProcessingBefore: Temporal.Instant;
  }) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly markFulfilled: (input: {
    readonly id: string;
    readonly fulfilledAt: Temporal.Instant;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly markFulfillmentFailed: (input: {
    readonly id: string;
    readonly failureCode: string;
    readonly failedAt: Temporal.Instant;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly markFulfillmentDeliveryFailed: (input: {
    readonly id: string;
    readonly failureCode: string;
    readonly failedAt: Temporal.Instant;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly markReservationConfirmed: (input: {
    readonly id: string;
    readonly confirmedAt: Temporal.Instant;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly selectExpiredHolds: (input: {
    readonly now: Temporal.Instant;
    readonly limit: number;
  }) => Effect.Effect<
    readonly WorkspaceReservation[],
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly selectPendingProviderAttachmentRecoveries: (input: {
    readonly staleBefore: Temporal.Instant;
    readonly limit: number;
  }) => Effect.Effect<
    readonly WorkspaceReservation[],
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly selectExpiredHoldDotyposReservationIds: (input: {
    readonly now: Temporal.Instant;
  }) => Effect.Effect<readonly string[], EffectDrizzleQueryError>;
}

export const WorkspaceReservationRepository =
  Context.Service<WorkspaceReservationRepository>(
    "WorkspaceReservationRepository"
  );

const ensureUpdated = (
  updated: readonly Pick<WorkspaceReservation, "id">[],
  operation: string,
  reservationId: string,
  message: string
) =>
  updated.length > 0
    ? Effect.void
    : Effect.fail(
        new WorkspaceReservationStateError({
          operation,
          reservationId,
          message,
        })
      );

const requireCanonicalProviderId = (
  value: string,
  operation: string,
  reservationId: string
) => {
  const canonical = canonicalizeDotyposEntityId(value);
  return canonical
    ? Effect.succeed(canonical)
    : Effect.fail(
        new WorkspaceReservationStateError({
          operation,
          reservationId,
          message: "A non-empty canonical provider identity is required.",
        })
      );
};

const maxDraftAcquisitionConflicts = 3;

export const WorkspaceReservationRepositoryLive = Layer.effect(
  WorkspaceReservationRepository,
  Effect.gen(function* () {
    const { db } = yield* WorkspaceDatabase;

    const findById = Effect.fn("workspaceReservations.findById")(
      function* (id: string) {
        const [reservation] = yield* db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, id))
          .limit(1);
        return yield* decodeOptionalWorkspaceReservation(reservation);
      },
      (effect, reservationId) =>
        effect.pipe(Effect.annotateLogs({ reservationId }))
    );

    return WorkspaceReservationRepository.of({
      acquireDraft: Effect.fn("workspaceReservations.acquireDraft")(
        function* (input) {
          const dotyposCustomerId = yield* requireCanonicalProviderId(
            input.dotyposCustomerId,
            "workspaceReservations.acquireDraft",
            "new"
          );
          const row = {
            id: postgresUuidV7,
            checkoutSessionKey: input.checkoutSessionKey,
            checkoutAttemptKey: input.checkoutAttemptKey,
            correlationId: postgresUuidV7,
            dotyposCustomerId,
            customerAccessCode: input.customerAccessCode,
            reservationState: "draft" as const,
            paymentState: "not_started" as const,
            fulfillmentState: "not_started" as const,
            reservationDetails: input.reservationDetails,
            locale: input.locale,
            reservationHoldExpiresAt: input.reservationHoldExpiresAt,
          };

          for (
            let conflictCount = 0;
            conflictCount < maxDraftAcquisitionConflicts;
            conflictCount += 1
          ) {
            const [inserted] = yield* db
              .insert(workspaceReservations)
              .values(row)
              .onConflictDoNothing()
              .returning();

            if (inserted) {
              return ReservationDraftAcquisition.created({
                reservation: yield* decodeWorkspaceReservation(inserted),
              });
            }

            const [existingAttempt] = yield* db
              .select()
              .from(workspaceReservations)
              .where(
                eq(
                  workspaceReservations.checkoutAttemptKey,
                  input.checkoutAttemptKey
                )
              )
              .limit(1);

            if (existingAttempt) {
              return ReservationDraftAcquisition.existing_attempt({
                reservation: yield* decodeWorkspaceReservation(existingAttempt),
              });
            }

            const [currentReservation] = yield* db
              .select()
              .from(workspaceReservations)
              .where(
                and(
                  eq(
                    workspaceReservations.checkoutSessionKey,
                    input.checkoutSessionKey
                  ),
                  sql`${workspaceReservations.reservationState} <> 'cancelled'`
                )
              )
              .orderBy(desc(workspaceReservations.createdAt))
              .limit(1);

            if (currentReservation) {
              return ReservationDraftAcquisition.session_occupied({
                reservation:
                  yield* decodeWorkspaceReservation(currentReservation),
              });
            }

            // The active-session row can be cancelled between the conflicting
            // insert and its definitive lookup. Retry the insert rather than
            // inventing a reservation result that was never persisted.
          }
          return ReservationDraftAcquisition.conflict_unresolved({});
        },
        (effect, input) =>
          effect.pipe(
            Effect.annotateLogs({
              checkoutSessionKey: input.checkoutSessionKey,
              checkoutAttemptKey: input.checkoutAttemptKey,
              dotyposCustomerId: input.dotyposCustomerId,
            })
          )
      ),
      findById,
      findByAttemptKey: Effect.fn("workspaceReservations.findByAttemptKey")(
        function* (checkoutAttemptKey) {
          const [reservation] = yield* db
            .select()
            .from(workspaceReservations)
            .where(
              eq(workspaceReservations.checkoutAttemptKey, checkoutAttemptKey)
            )
            .limit(1);
          return yield* decodeOptionalWorkspaceReservation(reservation);
        },
        (effect, checkoutAttemptKey) =>
          effect.pipe(Effect.annotateLogs({ checkoutAttemptKey }))
      ),
      findCurrentByCheckoutSessionKey: Effect.fn(
        "workspaceReservations.findCurrentByCheckoutSessionKey"
      )(
        function* (checkoutSessionKey) {
          const [reservation] = yield* db
            .select()
            .from(workspaceReservations)
            .where(
              and(
                eq(
                  workspaceReservations.checkoutSessionKey,
                  checkoutSessionKey
                ),
                sql`${workspaceReservations.reservationState} <> 'cancelled'`
              )
            )
            .orderBy(desc(workspaceReservations.createdAt))
            .limit(1);
          return yield* decodeOptionalWorkspaceReservation(reservation);
        },
        (effect, checkoutSessionKey) =>
          effect.pipe(Effect.annotateLogs({ checkoutSessionKey }))
      ),
      retirePreProviderDraft: Effect.fn(
        "workspaceReservations.retirePreProviderDraft"
      )(function* (input) {
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            reservationState: "draft",
            failureCode: retiredPreProviderDraftMarker,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(
                workspaceReservations.checkoutAttemptKey,
                input.checkoutAttemptKey
              ),
              eq(workspaceReservations.paymentState, "not_started"),
              sql`${workspaceReservations.activePaymentAttemptId} is null`,
              sql`${workspaceReservations.dotyposReservationId} is null`,
              or(
                and(
                  eq(workspaceReservations.reservationState, "draft"),
                  or(
                    sql`${workspaceReservations.failureCode} is null`,
                    eq(
                      workspaceReservations.failureCode,
                      retiredPreProviderDraftMarker
                    )
                  )
                ),
                and(
                  eq(workspaceReservations.reservationState, "creating_hold"),
                  sql`${workspaceReservations.failureCode} like 'hold_creation_pre_provider:%'`
                )
              )
            )
          )
          .returning({ id: workspaceReservations.id });
        return updated.length > 0;
      }),
      updateReservationDetails: Effect.fn(
        "workspaceReservations.updateReservationDetails"
      )(function* (input) {
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            reservationDetails: input.reservationDetails,
            locale: input.locale,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              inArray(workspaceReservations.reservationState, ["draft", "held"])
            )
          )
          .returning();
        if (!updated[0]) {
          return yield* new WorkspaceReservationStateError({
            operation: "workspaceReservations.updateReservationDetails",
            reservationId: input.id,
            message:
              "Only draft or held reservations can refresh reservation details.",
          });
        }
        return yield* decodeWorkspaceReservation(updated[0]);
      }),
      claimHoldCreation: Effect.fn("workspaceReservations.claimHoldCreation")(
        function* (id) {
          const epoch = randomUUID();
          const updated = yield* db
            .update(workspaceReservations)
            .set({
              reservationState: "creating_hold",
              failureCode: preProviderHoldCreationMarker(epoch),
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, id),
                eq(workspaceReservations.reservationState, "draft"),
                sql`${workspaceReservations.failureCode} is null`
              )
            )
            .returning({ id: workspaceReservations.id });
          return updated.length > 0 ? epoch : null;
        },
        (effect, reservationId) =>
          effect.pipe(Effect.annotateLogs({ reservationId }))
      ),
      beginProviderHoldCreation: Effect.fn(
        "workspaceReservations.beginProviderHoldCreation"
      )(function* (input) {
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            failureCode: providerHoldCreationReconciliationMarker(input.epoch),
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.reservationState, "creating_hold"),
              eq(
                workspaceReservations.failureCode,
                preProviderHoldCreationMarker(input.epoch)
              ),
              sql`${workspaceReservations.dotyposReservationId} is null`
            )
          )
          .returning({ id: workspaceReservations.id });
        return updated.length > 0;
      }),
      reclaimPreProviderHoldCreation: Effect.fn(
        "workspaceReservations.reclaimPreProviderHoldCreation"
      )(function* (input) {
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            reservationState: "draft",
            failureCode: null,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.reservationState, "creating_hold"),
              eq(
                workspaceReservations.failureCode,
                preProviderHoldCreationMarker(input.epoch)
              ),
              sql`${workspaceReservations.dotyposReservationId} is null`
            )
          )
          .returning({ id: workspaceReservations.id });
        return updated.length > 0;
      }),
      reclaimStalePreProviderHoldCreation: Effect.fn(
        "workspaceReservations.reclaimStalePreProviderHoldCreation"
      )(function* (input) {
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            reservationState: "draft",
            failureCode: null,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.reservationState, "creating_hold"),
              eq(
                workspaceReservations.failureCode,
                preProviderHoldCreationMarker(input.epoch)
              ),
              lte(workspaceReservations.updatedAt, input.staleBefore),
              sql`${workspaceReservations.dotyposReservationId} is null`
            )
          )
          .returning({ id: workspaceReservations.id });
        return updated.length > 0;
      }),
      releaseHoldCreation: Effect.fn(
        "workspaceReservations.releaseHoldCreation"
      )(function* (input) {
        const update = db
          .update(workspaceReservations)
          .set({
            reservationState: "draft",
            dotyposReservationId: null,
            reservationCreatedAt: null,
            failureCode: null,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.reservationState, "creating_hold"),
              or(
                eq(
                  workspaceReservations.failureCode,
                  providerHoldCreationReconciliationMarker(input.epoch)
                ),
                sql`${workspaceReservations.failureCode} like ${`hold_creation_recovery_required:${input.epoch}:%`}`,
                eq(
                  workspaceReservations.failureCode,
                  providerHoldCreationCompensationMarker(input.epoch)
                ),
                sql`${workspaceReservations.failureCode} like ${`hold_creation_candidate_compensating:${input.epoch}:%`}`
              ),
              or(
                sql`${workspaceReservations.dotyposReservationId} is null`,
                sql`${workspaceReservations.failureCode} like ${`hold_creation_candidate_compensating:${input.epoch}:%`}`
              )
            )
          )
          .returning({ id: workspaceReservations.id });
        const isAlreadyReleased = () =>
          db
            .select({
              reservationState: workspaceReservations.reservationState,
              dotyposReservationId: workspaceReservations.dotyposReservationId,
            })
            .from(workspaceReservations)
            .where(eq(workspaceReservations.id, input.id))
            .limit(1)
            .pipe(
              Effect.map(
                ([reservation]) =>
                  reservation?.reservationState === "draft" &&
                  reservation.dotyposReservationId === null
              )
            );
        const updated = yield* update.pipe(
          Effect.catch((cause) =>
            isAlreadyReleased().pipe(
              Effect.flatMap((released) =>
                released
                  ? Effect.succeed([{ id: input.id }])
                  : Effect.fail(cause)
              )
            )
          )
        );
        if (updated.length > 0) return;
        if (yield* isAlreadyReleased()) return;
        return yield* new WorkspaceReservationStateError({
          operation: "workspaceReservations.releaseHoldCreation",
          reservationId: input.id,
          message:
            "Only the matching unattached provider epoch can be released.",
        });
      }),
      requireHoldCreationRecovery: Effect.fn(
        "workspaceReservations.requireHoldCreationRecovery"
      )(function* (input) {
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            failureCode: providerHoldCreationRecoveryMarker(
              input.epoch,
              input.reason
            ),
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.reservationState, "creating_hold"),
              or(
                eq(
                  workspaceReservations.failureCode,
                  providerHoldCreationReconciliationMarker(input.epoch)
                ),
                sql`${workspaceReservations.failureCode} like ${`hold_creation_recovery_required:${input.epoch}:%`}`
              ),
              sql`${workspaceReservations.dotyposReservationId} is null`
            )
          )
          .returning({ id: workspaceReservations.id });
        yield* ensureUpdated(
          updated,
          "workspaceReservations.requireHoldCreationRecovery",
          input.id,
          "Only the matching provider-creation epoch can require recovery."
        );
      }),
      claimHoldCreationCompensation: Effect.fn(
        "workspaceReservations.claimHoldCreationCompensation"
      )(function* (input) {
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            failureCode: sql`case
              when ${workspaceReservations.failureCode} like ${`hold_creation_candidate:${input.epoch}:%`}
                then replace(${workspaceReservations.failureCode}, 'hold_creation_candidate:', 'hold_creation_candidate_compensating:')
              else ${providerHoldCreationCompensationMarker(input.epoch)}
            end`,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.reservationState, "creating_hold"),
              or(
                eq(
                  workspaceReservations.failureCode,
                  providerHoldCreationReconciliationMarker(input.epoch)
                ),
                sql`${workspaceReservations.failureCode} like ${`hold_creation_recovery_required:${input.epoch}:%`}`,
                sql`${workspaceReservations.failureCode} like ${`hold_creation_candidate:${input.epoch}:%`}`
              ),
              or(
                sql`${workspaceReservations.dotyposReservationId} is null`,
                sql`${workspaceReservations.failureCode} like ${`hold_creation_candidate:${input.epoch}:%`}`
              )
            )
          )
          .returning({ id: workspaceReservations.id });
        return updated.length > 0;
      }),
      recordProviderHoldCandidate: Effect.fn(
        "workspaceReservations.recordProviderHoldCandidate"
      )(function* (input) {
        const dotyposReservationId = yield* requireCanonicalProviderId(
          input.dotyposReservationId,
          "workspaceReservations.recordProviderHoldCandidate",
          input.id
        );
        const candidateMarker = providerHoldCreationCandidateMarker(
          input.epoch,
          dotyposReservationId,
          input.reservationCreatedAt
        );
        const loadCandidate = () =>
          db
            .select({
              dotyposReservationId: workspaceReservations.dotyposReservationId,
              reservationCreatedAt: workspaceReservations.reservationCreatedAt,
              failureCode: workspaceReservations.failureCode,
              paymentState: workspaceReservations.paymentState,
              reservationState: workspaceReservations.reservationState,
              updatedAt: workspaceReservations.updatedAt,
            })
            .from(workspaceReservations)
            .where(eq(workspaceReservations.id, input.id))
            .limit(1)
            .pipe(Effect.map((rows) => rows[0]));
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            dotyposReservationId,
            reservationCreatedAt: input.reservationCreatedAt,
            failureCode: candidateMarker,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.reservationState, "creating_hold"),
              or(
                eq(
                  workspaceReservations.failureCode,
                  providerHoldCreationReconciliationMarker(input.epoch)
                ),
                sql`${workspaceReservations.failureCode} like ${`hold_creation_recovery_required:${input.epoch}:%`}`
              ),
              sql`${workspaceReservations.dotyposReservationId} is null`
            )
          )
          .returning({ id: workspaceReservations.id })
          .pipe(
            Effect.catch((cause) =>
              loadCandidate().pipe(
                Effect.flatMap((existing) =>
                  existing?.dotyposReservationId === dotyposReservationId &&
                  existing.reservationCreatedAt?.equals(
                    input.reservationCreatedAt
                  ) &&
                  existing.failureCode === candidateMarker
                    ? Effect.succeed([{ id: input.id }])
                    : Effect.fail(cause)
                )
              )
            )
          );
        if (updated.length > 0) return;
        const existing = yield* loadCandidate();
        const candidateFence =
          existing &&
          getProviderHoldCandidateFence(
            existing as Pick<
              WorkspaceReservation,
              | "dotyposReservationId"
              | "failureCode"
              | "reservationState"
              | "updatedAt"
            >,
            input.epoch
          );
        const canRecordConflict =
          existing?.reservationState === "held" &&
          existing.paymentState === "not_started" &&
          existing.dotyposReservationId !== null &&
          existing.dotyposReservationId !== dotyposReservationId &&
          (candidateFence !== undefined ||
            existing.failureCode ===
              providerHoldCreationAttachedMarker(input.epoch));
        if (canRecordConflict) {
          const conflictingAttachment = yield* db
            .update(workspaceReservations)
            .set({
              failureCode: providerHoldCreationOrphanRecoveryMarker(
                input.epoch,
                dotyposReservationId,
                input.reservationCreatedAt,
                candidateFence
              ),
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, input.id),
                eq(workspaceReservations.reservationState, "held"),
                eq(workspaceReservations.paymentState, "not_started"),
                eq(
                  workspaceReservations.failureCode,
                  existing.failureCode as string
                ),
                eq(
                  workspaceReservations.dotyposReservationId,
                  existing.dotyposReservationId as string
                ),
                sql`${workspaceReservations.dotyposReservationId} <> ${dotyposReservationId}`
              )
            )
            .returning({ id: workspaceReservations.id });
          if (conflictingAttachment.length > 0) {
            return yield* new WorkspaceReservationStateError({
              operation: "workspaceReservations.recordProviderHoldCandidate",
              reservationId: input.id,
              message:
                "A different exact provider result was retained for cancellation recovery.",
            });
          }
        }
        const existingCandidate = existing && getHoldCreationMarker(existing);
        if (
          existing?.dotyposReservationId === dotyposReservationId &&
          existing.reservationCreatedAt?.equals(input.reservationCreatedAt) &&
          ((existingCandidate?._tag === "candidate" &&
            existingCandidate.epoch === input.epoch &&
            existingCandidate.dotyposReservationId === dotyposReservationId &&
            existingCandidate.reservationCreatedAt.equals(
              input.reservationCreatedAt
            )) ||
            existing.failureCode ===
              providerHoldCreationAttachedMarker(input.epoch))
        ) {
          return;
        }
        return yield* new WorkspaceReservationStateError({
          operation: "workspaceReservations.recordProviderHoldCandidate",
          reservationId: input.id,
          message:
            "Only the matching provider-creation epoch can record exact provider evidence.",
        });
      }),
      attachHold: Effect.fn("workspaceReservations.attachHold")(
        function* (input) {
          const dotyposReservationId = yield* requireCanonicalProviderId(
            input.dotyposReservationId,
            "workspaceReservations.attachHold",
            input.id
          );
          const attachedAt = Temporal.Now.instant();
          const candidateMarker = providerHoldCreationCandidateMarker(
            input.epoch,
            dotyposReservationId,
            input.reservationCreatedAt,
            attachedAt.add({
              seconds: providerHoldCandidateStabilizationSeconds,
            })
          );
          const loadSameAttachedHold = () =>
            db
              .select({
                dotyposReservationId:
                  workspaceReservations.dotyposReservationId,
                reservationCreatedAt:
                  workspaceReservations.reservationCreatedAt,
                failureCode: workspaceReservations.failureCode,
                reservationState: workspaceReservations.reservationState,
              })
              .from(workspaceReservations)
              .where(eq(workspaceReservations.id, input.id))
              .pipe(Effect.map((rows) => rows[0]));
          const updated = yield* db
            .update(workspaceReservations)
            .set({
              dotyposReservationId,
              reservationState: "held",
              reservationCreatedAt: input.reservationCreatedAt,
              failureCode: candidateMarker,
              updatedAt: attachedAt,
            })
            .where(
              and(
                eq(workspaceReservations.id, input.id),
                eq(workspaceReservations.reservationState, "creating_hold"),
                or(
                  eq(
                    workspaceReservations.failureCode,
                    providerHoldCreationCandidateMarker(
                      input.epoch,
                      dotyposReservationId,
                      input.reservationCreatedAt
                    )
                  ),
                  eq(
                    workspaceReservations.failureCode,
                    providerHoldCreationAttachedMarker(input.epoch)
                  )
                ),
                eq(
                  workspaceReservations.dotyposReservationId,
                  dotyposReservationId
                ),
                eq(
                  workspaceReservations.reservationCreatedAt,
                  input.reservationCreatedAt
                )
              )
            )
            .returning({ id: workspaceReservations.id })
            .pipe(
              Effect.catch((cause) =>
                loadSameAttachedHold().pipe(
                  Effect.flatMap((reservation) => {
                    const marker =
                      reservation && getHoldCreationMarker(reservation);
                    return reservation?.reservationState === "held" &&
                      reservation.dotyposReservationId ===
                        dotyposReservationId &&
                      reservation.reservationCreatedAt?.equals(
                        input.reservationCreatedAt
                      ) &&
                      marker?._tag === "candidate" &&
                      marker.epoch === input.epoch
                      ? Effect.succeed([{ id: input.id }])
                      : Effect.fail(cause);
                  })
                )
              )
            );
          if (updated.length > 0) return;
          const reservation = yield* loadSameAttachedHold();
          const marker = reservation && getHoldCreationMarker(reservation);
          if (
            reservation?.reservationState === "held" &&
            reservation.dotyposReservationId === dotyposReservationId &&
            reservation.reservationCreatedAt?.equals(
              input.reservationCreatedAt
            ) &&
            marker?._tag === "candidate" &&
            marker.epoch === input.epoch
          ) {
            return;
          }
          return yield* new WorkspaceReservationStateError({
            operation: "workspaceReservations.attachHold",
            reservationId: input.id,
            message:
              "Only the matching provider-creation epoch can attach a Dotypos hold.",
          });
        }
      ),
      completeProviderHoldCandidate: Effect.fn(
        "workspaceReservations.completeProviderHoldCandidate"
      )(function* (input) {
        const dotyposReservationId = yield* requireCanonicalProviderId(
          input.dotyposReservationId,
          "workspaceReservations.completeProviderHoldCandidate",
          input.id
        );
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            failureCode: providerHoldCreationAttachedMarker(input.epoch),
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.reservationState, "held"),
              eq(workspaceReservations.paymentState, "not_started"),
              or(
                eq(
                  workspaceReservations.failureCode,
                  providerHoldCreationCandidateMarker(
                    input.epoch,
                    dotyposReservationId,
                    input.reservationCreatedAt
                  )
                ),
                sql`${workspaceReservations.failureCode} like ${`${providerHoldCreationCandidateMarker(
                  input.epoch,
                  dotyposReservationId,
                  input.reservationCreatedAt
                )}:%`}`
              ),
              eq(
                workspaceReservations.dotyposReservationId,
                dotyposReservationId
              ),
              eq(
                workspaceReservations.reservationCreatedAt,
                input.reservationCreatedAt
              )
            )
          )
          .returning({ id: workspaceReservations.id });
        if (updated.length > 0) return;
        const [existing] = yield* db
          .select({
            failureCode: workspaceReservations.failureCode,
            reservationState: workspaceReservations.reservationState,
            paymentState: workspaceReservations.paymentState,
            dotyposReservationId: workspaceReservations.dotyposReservationId,
            reservationCreatedAt: workspaceReservations.reservationCreatedAt,
          })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, input.id))
          .limit(1);
        if (
          existing?.reservationState === "held" &&
          existing.paymentState === "not_started" &&
          existing.dotyposReservationId === dotyposReservationId &&
          existing.reservationCreatedAt?.equals(input.reservationCreatedAt) &&
          existing.failureCode ===
            providerHoldCreationAttachedMarker(input.epoch)
        ) {
          return;
        }
        return yield* new WorkspaceReservationStateError({
          operation: "workspaceReservations.completeProviderHoldCandidate",
          reservationId: input.id,
          message:
            "Only the stale exact provider candidate can complete attachment.",
        });
      }),
      markAttachFailedCancellationRequired: Effect.fn(
        "workspaceReservations.markAttachFailedCancellationRequired"
      )(function* (input) {
        const dotyposReservationId = yield* requireCanonicalProviderId(
          input.dotyposReservationId,
          "workspaceReservations.markAttachFailedCancellationRequired",
          input.id
        );
        const failureCode = `${input.failureCode}:${input.epoch}`;
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            dotyposReservationId,
            reservationCreatedAt: input.reservationCreatedAt,
            reservationState: "cancellation_failed",
            failureCode,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              or(
                and(
                  eq(workspaceReservations.reservationState, "creating_hold"),
                  eq(
                    workspaceReservations.failureCode,
                    providerHoldCreationCompensationMarker(input.epoch)
                  ),
                  sql`${workspaceReservations.dotyposReservationId} is null`,
                  sql`${workspaceReservations.reservationCreatedAt} is null`
                ),
                and(
                  eq(workspaceReservations.reservationState, "creating_hold"),
                  eq(
                    workspaceReservations.failureCode,
                    providerHoldCreationCandidateCompensationMarker(
                      input.epoch,
                      dotyposReservationId,
                      input.reservationCreatedAt
                    )
                  ),
                  eq(
                    workspaceReservations.dotyposReservationId,
                    dotyposReservationId
                  ),
                  eq(
                    workspaceReservations.reservationCreatedAt,
                    input.reservationCreatedAt
                  )
                ),
                and(
                  eq(
                    workspaceReservations.reservationState,
                    "cancellation_failed"
                  ),
                  eq(
                    workspaceReservations.dotyposReservationId,
                    dotyposReservationId
                  ),
                  eq(
                    workspaceReservations.reservationCreatedAt,
                    input.reservationCreatedAt
                  )
                )
              )
            )
          )
          .returning({ id: workspaceReservations.id });
        if (updated.length > 0) return;
        const [existing] = yield* db
          .select({
            dotyposReservationId: workspaceReservations.dotyposReservationId,
            reservationCreatedAt: workspaceReservations.reservationCreatedAt,
            failureCode: workspaceReservations.failureCode,
            reservationState: workspaceReservations.reservationState,
          })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, input.id))
          .limit(1);
        if (
          existing?.reservationState === "cancellation_failed" &&
          existing.dotyposReservationId === dotyposReservationId &&
          existing.reservationCreatedAt?.equals(input.reservationCreatedAt) &&
          existing.failureCode === failureCode
        ) {
          return;
        }
        return yield* new WorkspaceReservationStateError({
          operation:
            "workspaceReservations.markAttachFailedCancellationRequired",
          reservationId: input.id,
          message:
            "Only the exact compensating provider epoch can record attach-cancel recovery.",
        });
      }),
      recordDifferentProviderAttachmentRecovery: Effect.fn(
        "workspaceReservations.recordDifferentProviderAttachmentRecovery"
      )(function* (input) {
        const dotyposReservationId = yield* requireCanonicalProviderId(
          input.dotyposReservationId,
          "workspaceReservations.recordDifferentProviderAttachmentRecovery",
          input.id
        );
        const [existing] = yield* db
          .select({
            failureCode: workspaceReservations.failureCode,
            paymentState: workspaceReservations.paymentState,
            reservationState: workspaceReservations.reservationState,
            dotyposReservationId: workspaceReservations.dotyposReservationId,
            reservationCreatedAt: workspaceReservations.reservationCreatedAt,
            updatedAt: workspaceReservations.updatedAt,
          })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, input.id))
          .limit(1);
        const existingRecovery =
          existing && getDifferentProviderAttachmentRecovery(existing);
        const resolvedRecovery =
          existing && getResolvedDifferentProviderAttachmentRecovery(existing);
        if (
          (existingRecovery?.epoch === input.epoch &&
            existingRecovery.dotyposReservationId === dotyposReservationId &&
            existingRecovery.reservationCreatedAt.equals(
              input.reservationCreatedAt
            )) ||
          (resolvedRecovery?.epoch === input.epoch &&
            resolvedRecovery.dotyposReservationId === dotyposReservationId &&
            resolvedRecovery.reservationCreatedAt.equals(
              input.reservationCreatedAt
            ))
        ) {
          return;
        }
        const candidateFence =
          existing &&
          getProviderHoldCandidateFence(
            existing as Pick<
              WorkspaceReservation,
              | "dotyposReservationId"
              | "failureCode"
              | "reservationState"
              | "updatedAt"
            >,
            input.epoch
          );
        const canRecord =
          existing?.reservationState === "held" &&
          existing.paymentState === "not_started" &&
          existing.dotyposReservationId !== null &&
          existing.dotyposReservationId !== dotyposReservationId &&
          existing.failureCode !== null &&
          (candidateFence !== undefined ||
            existing.failureCode ===
              providerHoldCreationAttachedMarker(input.epoch));
        if (
          canRecord &&
          existing?.failureCode &&
          existing.dotyposReservationId
        ) {
          const updated = yield* db
            .update(workspaceReservations)
            .set({
              failureCode: providerHoldCreationOrphanRecoveryMarker(
                input.epoch,
                dotyposReservationId,
                input.reservationCreatedAt,
                candidateFence
              ),
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, input.id),
                eq(workspaceReservations.reservationState, "held"),
                eq(workspaceReservations.paymentState, "not_started"),
                eq(workspaceReservations.failureCode, existing.failureCode),
                eq(
                  workspaceReservations.dotyposReservationId,
                  existing.dotyposReservationId
                ),
                sql`${workspaceReservations.dotyposReservationId} <> ${dotyposReservationId}`
              )
            )
            .returning({ id: workspaceReservations.id });
          if (updated.length > 0) return;
        }
        return yield* new WorkspaceReservationStateError({
          operation:
            "workspaceReservations.recordDifferentProviderAttachmentRecovery",
          reservationId: input.id,
          message:
            "Only the exact attached provider epoch can record a different provider hold for recovery.",
        });
      }),
      claimDifferentProviderAttachmentRecovery: Effect.fn(
        "workspaceReservations.claimDifferentProviderAttachmentRecovery"
      )(function* (input) {
        const dotyposReservationId = yield* requireCanonicalProviderId(
          input.dotyposReservationId,
          "workspaceReservations.claimDifferentProviderAttachmentRecovery",
          input.id
        );
        const [existing] = yield* db
          .select({
            dotyposReservationId: workspaceReservations.dotyposReservationId,
            failureCode: workspaceReservations.failureCode,
            reservationCreatedAt: workspaceReservations.reservationCreatedAt,
            reservationState: workspaceReservations.reservationState,
            updatedAt: workspaceReservations.updatedAt,
          })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, input.id))
          .limit(1);
        const recovery =
          existing && getDifferentProviderAttachmentRecovery(existing);
        if (
          !existing ||
          recovery?.epoch !== input.epoch ||
          recovery.dotyposReservationId !== dotyposReservationId ||
          !recovery.reservationCreatedAt.equals(input.reservationCreatedAt)
        ) {
          return false;
        }
        const needsStaleTakeover =
          recovery.phase === "processing" && recovery.ownerId !== input.ownerId;
        if (
          needsStaleTakeover &&
          Temporal.Instant.compare(existing.updatedAt, input.staleBefore) > 0
        ) {
          return false;
        }
        const ownedMarker = providerHoldCreationOrphanProcessingMarker(
          input.epoch,
          dotyposReservationId,
          input.reservationCreatedAt,
          input.ownerId,
          recovery.candidateFence
        );
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            failureCode: ownedMarker,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.reservationState, "held"),
              sql`${workspaceReservations.dotyposReservationId} is not null`,
              sql`${workspaceReservations.dotyposReservationId} <> ${dotyposReservationId}`,
              eq(
                workspaceReservations.failureCode,
                existing.failureCode as string
              ),
              needsStaleTakeover
                ? lte(workspaceReservations.updatedAt, input.staleBefore)
                : undefined
            )
          )
          .returning({ id: workspaceReservations.id });
        return updated.length > 0;
      }),
      releaseDifferentProviderAttachmentRecovery: Effect.fn(
        "workspaceReservations.releaseDifferentProviderAttachmentRecovery"
      )(function* (input) {
        const dotyposReservationId = yield* requireCanonicalProviderId(
          input.dotyposReservationId,
          "workspaceReservations.releaseDifferentProviderAttachmentRecovery",
          input.id
        );
        const [existing] = yield* db
          .select({
            dotyposReservationId: workspaceReservations.dotyposReservationId,
            failureCode: workspaceReservations.failureCode,
            reservationCreatedAt: workspaceReservations.reservationCreatedAt,
            reservationState: workspaceReservations.reservationState,
          })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, input.id))
          .limit(1);
        const recovery =
          existing && getDifferentProviderAttachmentRecovery(existing);
        if (
          !existing ||
          recovery?.phase !== "processing" ||
          recovery.ownerId !== input.ownerId ||
          recovery.epoch !== input.epoch ||
          recovery.dotyposReservationId !== dotyposReservationId ||
          !recovery.reservationCreatedAt.equals(input.reservationCreatedAt)
        ) {
          return yield* new WorkspaceReservationStateError({
            operation:
              "workspaceReservations.releaseDifferentProviderAttachmentRecovery",
            reservationId: input.id,
            message:
              "Only the owned different-provider recovery can be released.",
          });
        }
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            failureCode: providerHoldCreationOrphanRecoveryMarker(
              input.epoch,
              dotyposReservationId,
              input.reservationCreatedAt,
              recovery.candidateFence
            ),
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.reservationState, "held"),
              eq(
                workspaceReservations.failureCode,
                existing.failureCode as string
              ),
              sql`${workspaceReservations.dotyposReservationId} is not null`,
              sql`${workspaceReservations.dotyposReservationId} <> ${dotyposReservationId}`
            )
          )
          .returning({ id: workspaceReservations.id });
        yield* ensureUpdated(
          updated,
          "workspaceReservations.releaseDifferentProviderAttachmentRecovery",
          input.id,
          "Only the owned different-provider recovery can be released."
        );
      }),
      completeDifferentProviderAttachmentRecovery: Effect.fn(
        "workspaceReservations.completeDifferentProviderAttachmentRecovery"
      )(function* (input) {
        const dotyposReservationId = yield* requireCanonicalProviderId(
          input.dotyposReservationId,
          "workspaceReservations.completeDifferentProviderAttachmentRecovery",
          input.id
        );
        const [beforeCompletion] = yield* db
          .select({
            dotyposReservationId: workspaceReservations.dotyposReservationId,
            failureCode: workspaceReservations.failureCode,
            reservationCreatedAt: workspaceReservations.reservationCreatedAt,
            reservationState: workspaceReservations.reservationState,
          })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, input.id))
          .limit(1);
        const recovery =
          beforeCompletion &&
          getDifferentProviderAttachmentRecovery(beforeCompletion);
        const ownsRecovery =
          recovery?.epoch === input.epoch &&
          recovery.dotyposReservationId === dotyposReservationId &&
          recovery.reservationCreatedAt.equals(input.reservationCreatedAt) &&
          (input.ownerId
            ? recovery.phase === "processing" &&
              recovery.ownerId === input.ownerId
            : recovery.phase === "pending");
        const completionMarker = recovery?.candidateFence
          ? providerHoldCreationCandidateMarker(
              input.epoch,
              recovery.candidateFence.dotyposReservationId,
              recovery.candidateFence.reservationCreatedAt,
              recovery.candidateFence.stabilizationDeadline
            )
          : providerHoldCreationOrphanResolvedMarker(
              input.epoch,
              dotyposReservationId,
              input.reservationCreatedAt
            );
        if (!beforeCompletion || !ownsRecovery) {
          if (beforeCompletion?.failureCode === completionMarker) return;
          return yield* new WorkspaceReservationStateError({
            operation:
              "workspaceReservations.completeDifferentProviderAttachmentRecovery",
            reservationId: input.id,
            message:
              "Only observed cancellation of the exact losing provider hold can complete recovery.",
          });
        }
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            failureCode: completionMarker,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.reservationState, "held"),
              eq(
                workspaceReservations.failureCode,
                beforeCompletion.failureCode as string
              ),
              sql`${workspaceReservations.dotyposReservationId} is not null`,
              sql`${workspaceReservations.dotyposReservationId} <> ${dotyposReservationId}`
            )
          )
          .returning({ id: workspaceReservations.id });
        if (updated.length > 0) return;
        const [existing] = yield* db
          .select({ failureCode: workspaceReservations.failureCode })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, input.id))
          .limit(1);
        if (existing?.failureCode === completionMarker) return;
        return yield* new WorkspaceReservationStateError({
          operation:
            "workspaceReservations.completeDifferentProviderAttachmentRecovery",
          reservationId: input.id,
          message:
            "Only observed cancellation of the exact losing provider hold can complete recovery.",
        });
      }),
      claimCancellation: Effect.fn("workspaceReservations.claimCancellation")(
        function* (id) {
          const [claimed] = yield* db
            .update(workspaceReservations)
            .set({
              reservationState: "cancelling",
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, id),
                inArray(workspaceReservations.reservationState, [
                  "held",
                  "hold_expired",
                  "cancellation_failed",
                ]),
                sql`${workspaceReservations.paymentState} <> 'paid'`,
                sql`${workspaceReservations.reservationState} <> 'confirmed'`,
                hasNoUnresolvedProviderAttachmentRecovery()
              )
            )
            .returning();
          return yield* decodeOptionalWorkspaceReservation(claimed);
        }
      ),
      claimSupersessionCancellation: Effect.fn(
        "workspaceReservations.claimSupersessionCancellation"
      )(function* (id) {
        const [claimed] = yield* db
          .update(workspaceReservations)
          .set({
            reservationState: "cancelling",
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, id),
              eq(workspaceReservations.reservationState, "held"),
              inArray(workspaceReservations.paymentState, [
                "not_started",
                "failed",
                "cancelled",
                "expired",
              ]),
              hasNoUnresolvedProviderAttachmentRecovery()
            )
          )
          .returning();
        return yield* decodeOptionalWorkspaceReservation(claimed);
      }),
      markCancelled: Effect.fn("workspaceReservations.markCancelled")(
        function* (input) {
          const updated = yield* db
            .update(workspaceReservations)
            .set({
              reservationState: "cancelled",
              reservationCancelledAt: input.cancelledAt,
              reservationHoldExpiredAt: input.holdExpiredAt,
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, input.id),
                eq(workspaceReservations.reservationState, "cancelling"),
                sql`${workspaceReservations.paymentState} <> 'paid'`,
                sql`${workspaceReservations.reservationConfirmedAt} is null`
              )
            )
            .returning({ id: workspaceReservations.id });
          yield* ensureUpdated(
            updated,
            "workspaceReservations.markCancelled",
            input.id,
            "Only unpaid cancelling reservations can be marked cancelled."
          );
        }
      ),
      completeSupersessionAndCreateDraft: Effect.fn(
        "workspaceReservations.completeSupersessionAndCreateDraft"
      )(function* (input) {
        const dotyposCustomerId = yield* requireCanonicalProviderId(
          input.replacement.dotyposCustomerId,
          "workspaceReservations.completeSupersessionAndCreateDraft",
          input.cancelledReservationId
        );
        const transaction = db.transaction((tx) =>
          Effect.gen(function* () {
            const [cancelled] = yield* tx
              .update(workspaceReservations)
              .set({
                reservationState: "cancelled",
                reservationCancelledAt: input.cancelledAt,
                updatedAt: input.cancelledAt,
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.cancelledReservationId),
                  eq(workspaceReservations.reservationState, "cancelling"),
                  sql`${workspaceReservations.paymentState} <> 'pending'`,
                  sql`${workspaceReservations.paymentState} <> 'paid'`,
                  sql`${workspaceReservations.reservationConfirmedAt} is null`
                )
              )
              .returning({ id: workspaceReservations.id });

            if (!cancelled) {
              return yield* new WorkspaceReservationStateError({
                operation:
                  "workspaceReservations.completeSupersessionAndCreateDraft",
                reservationId: input.cancelledReservationId,
                message:
                  "Only an unpaid supersession cancellation can create its replacement.",
              });
            }

            const [replacement] = yield* tx
              .insert(workspaceReservations)
              .values({
                id: postgresUuidV7,
                checkoutSessionKey: input.replacement.checkoutSessionKey,
                checkoutAttemptKey: input.replacement.checkoutAttemptKey,
                correlationId: postgresUuidV7,
                dotyposCustomerId,
                customerAccessCode: input.replacement.customerAccessCode,
                reservationState: "draft",
                paymentState: "not_started",
                fulfillmentState: "not_started",
                reservationDetails: input.replacement.reservationDetails,
                locale: input.replacement.locale,
                reservationHoldExpiresAt:
                  input.replacement.reservationHoldExpiresAt,
              })
              .returning();

            if (!replacement) {
              return yield* Effect.die(
                "Workspace replacement reservation insert returned no row."
              );
            }

            return replacement;
          })
        );

        return yield* transaction.pipe(
          Effect.flatMap(decodeWorkspaceReservation)
        );
      }),
      markCancellationFailed: Effect.fn(
        "workspaceReservations.markCancellationFailed"
      )(function* (input) {
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            reservationState: "cancellation_failed",
            failureCode: input.failureCode,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.reservationState, "cancelling"),
              sql`${workspaceReservations.paymentState} <> 'paid'`
            )
          )
          .returning({ id: workspaceReservations.id });
        yield* ensureUpdated(
          updated,
          "workspaceReservations.markCancellationFailed",
          input.id,
          "Workspace reservation was not found."
        );
      }),
      recordHoldCleanupSkipped: Effect.fn(
        "workspaceReservations.recordHoldCleanupSkipped"
      )(function* (input) {
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            reservationHoldExpiredAt: input.holdExpiredAt,
            failureCode: input.failureCode,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.reservationState, "held"),
              sql`${workspaceReservations.paymentState} <> 'paid'`,
              hasNoUnresolvedProviderAttachmentRecovery(),
              lte(
                workspaceReservations.reservationHoldExpiresAt,
                input.holdExpiredAt
              )
            )
          )
          .returning({ id: workspaceReservations.id });
        yield* ensureUpdated(
          updated,
          "workspaceReservations.recordHoldCleanupSkipped",
          input.id,
          "Only unpaid expired held reservations can record skipped cleanup."
        );
      }),
      markPaymentPaid: Effect.fn("workspaceReservations.markPaymentPaid")(
        function* (input) {
          const updated = yield* db
            .update(workspaceReservations)
            .set({
              paymentState: "paid",
              paidAt: input.paidAt,
              failureCode: null,
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, input.id),
                eq(workspaceReservations.reservationState, "held"),
                eq(workspaceReservations.paymentState, "pending"),
                eq(
                  workspaceReservations.activePaymentAttemptId,
                  input.paymentAttemptId
                )
              )
            )
            .returning({ id: workspaceReservations.id });
          yield* ensureUpdated(
            updated,
            "workspaceReservations.markPaymentPaid",
            input.id,
            "Only the active pending attempt on a held reservation can mark payment paid."
          );
        }
      ),
      markPaymentTerminal: Effect.fn(
        "workspaceReservations.markPaymentTerminal"
      )(function* (input) {
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            paymentState: input.paymentState,
            failureCode: input.failureCode,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.reservationState, "held"),
              eq(workspaceReservations.paymentState, "pending"),
              eq(
                workspaceReservations.activePaymentAttemptId,
                input.paymentAttemptId
              )
            )
          )
          .returning({ id: workspaceReservations.id });
        yield* ensureUpdated(
          updated,
          "workspaceReservations.markPaymentTerminal",
          input.id,
          "Only the active pending attempt on a held reservation can mark payment terminal."
        );
      }),
      claimPaidFulfillment: Effect.fn(
        "workspaceReservations.claimPaidFulfillment"
      )(function* (input) {
        const [claimed] = yield* db
          .update(workspaceReservations)
          .set({
            fulfillmentState: "processing",
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.paymentState, "paid"),
              or(
                inArray(workspaceReservations.fulfillmentState, [
                  "not_started",
                  "failed",
                ]),
                and(
                  eq(workspaceReservations.fulfillmentState, "processing"),
                  lte(
                    workspaceReservations.updatedAt,
                    input.staleProcessingBefore
                  )
                )
              )
            )
          )
          .returning();
        return yield* decodeOptionalWorkspaceReservation(claimed);
      }),
      markFulfilled: Effect.fn("workspaceReservations.markFulfilled")(
        function* (input) {
          const updated = yield* db
            .update(workspaceReservations)
            .set({
              fulfillmentState: "fulfilled",
              fulfilledAt: input.fulfilledAt,
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, input.id),
                eq(workspaceReservations.paymentState, "paid"),
                eq(workspaceReservations.fulfillmentState, "processing")
              )
            )
            .returning({ id: workspaceReservations.id });
          yield* ensureUpdated(
            updated,
            "workspaceReservations.markFulfilled",
            input.id,
            "Only processing paid reservations can be marked fulfilled."
          );
        }
      ),
      markFulfillmentFailed: Effect.fn(
        "workspaceReservations.markFulfillmentFailed"
      )(function* (input) {
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            fulfillmentState: "failed",
            fulfillmentFailedAt: input.failedAt,
            fulfillmentFailureCode: input.failureCode,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.paymentState, "paid"),
              eq(workspaceReservations.fulfillmentState, "processing")
            )
          )
          .returning({ id: workspaceReservations.id });
        yield* ensureUpdated(
          updated,
          "workspaceReservations.markFulfillmentFailed",
          input.id,
          "Only processing paid reservations can be marked fulfillment failed."
        );
      }),
      markFulfillmentDeliveryFailed: Effect.fn(
        "workspaceReservations.markFulfillmentDeliveryFailed"
      )(function* (input) {
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            fulfillmentState: "failed",
            fulfilledAt: null,
            fulfillmentFailedAt: input.failedAt,
            fulfillmentFailureCode: input.failureCode,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.paymentState, "paid"),
              inArray(workspaceReservations.fulfillmentState, [
                "processing",
                "fulfilled",
              ])
            )
          )
          .returning({ id: workspaceReservations.id });
        yield* ensureUpdated(
          updated,
          "workspaceReservations.markFulfillmentDeliveryFailed",
          input.id,
          "Only processing or fulfilled paid reservations can be marked delivery failed."
        );
      }),
      markReservationConfirmed: Effect.fn(
        "workspaceReservations.markReservationConfirmed"
      )(function* (input) {
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            reservationState: "confirmed",
            reservationConfirmedAt: input.confirmedAt,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.reservationState, "held"),
              eq(workspaceReservations.paymentState, "paid"),
              eq(workspaceReservations.fulfillmentState, "processing")
            )
          )
          .returning({ id: workspaceReservations.id });
        yield* ensureUpdated(
          updated,
          "workspaceReservations.markReservationConfirmed",
          input.id,
          "Only processing paid held reservations can be marked confirmed."
        );
      }),
      selectPendingProviderAttachmentRecoveries: Effect.fn(
        "workspaceReservations.selectPendingProviderAttachmentRecoveries"
      )(function* (input) {
        const reservations = yield* db
          .select()
          .from(workspaceReservations)
          .where(
            and(
              lte(workspaceReservations.updatedAt, input.staleBefore),
              or(
                and(
                  eq(workspaceReservations.reservationState, "held"),
                  or(
                    sql`${workspaceReservations.failureCode} like 'hold_creation_candidate:%'`,
                    sql`${workspaceReservations.failureCode} like 'hold_creation_orphan_recovery:%'`,
                    sql`${workspaceReservations.failureCode} like 'hold_creation_orphan_processing:%'`
                  )
                ),
                and(
                  eq(workspaceReservations.reservationState, "creating_hold"),
                  or(
                    sql`${workspaceReservations.failureCode} like 'hold_creation_candidate:%'`,
                    sql`${workspaceReservations.failureCode} like 'hold_creation_candidate_compensating:%'`
                  )
                )
              )
            )
          )
          .orderBy(
            asc(workspaceReservations.updatedAt),
            asc(workspaceReservations.id)
          )
          .limit(input.limit);
        return yield* Effect.forEach(reservations, decodeWorkspaceReservation, {
          concurrency: "inherit",
        });
      }),
      selectExpiredHolds: Effect.fn("workspaceReservations.selectExpiredHolds")(
        function* (input) {
          const reservations = yield* db
            .select()
            .from(workspaceReservations)
            .where(
              and(
                eq(workspaceReservations.reservationState, "held"),
                sql`${workspaceReservations.paymentState} <> 'paid'`,
                hasNoUnresolvedProviderAttachmentRecovery(),
                lte(workspaceReservations.reservationHoldExpiresAt, input.now)
              )
            )
            .orderBy(
              sql`coalesce(${workspaceReservations.reservationHoldExpiredAt}, ${workspaceReservations.reservationHoldExpiresAt})`,
              asc(workspaceReservations.reservationHoldExpiresAt),
              asc(workspaceReservations.id)
            )
            .limit(input.limit);
          return yield* Effect.forEach(
            reservations,
            decodeWorkspaceReservation,
            { concurrency: "inherit" }
          );
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),
      selectExpiredHoldDotyposReservationIds: Effect.fn(
        "workspaceReservations.selectExpiredHoldDotyposReservationIds"
      )(function* (input) {
        const rows = yield* db
          .select({
            dotyposReservationId: workspaceReservations.dotyposReservationId,
          })
          .from(workspaceReservations)
          .where(
            and(
              eq(workspaceReservations.reservationState, "held"),
              inArray(workspaceReservations.paymentState, [
                "not_started",
                "failed",
                "cancelled",
                "expired",
              ]),
              sql`${workspaceReservations.dotyposReservationId} is not null`,
              lte(workspaceReservations.reservationHoldExpiresAt, input.now)
            )
          );

        return rows.flatMap(({ dotyposReservationId }) =>
          dotyposReservationId ? [dotyposReservationId] : []
        );
      }),
    });
  })
);

const decodeOptionalWorkspaceReservation = (
  reservation: WorkspaceReservationRow | undefined
) =>
  reservation ? decodeWorkspaceReservation(reservation) : Effect.succeed(null);

const decodeWorkspaceReservation = Effect.fn(
  "WorkspaceReservation.decodeStoredDetails"
)((reservation: WorkspaceReservationRow) =>
  Schema.decodeUnknownEffect(storedReservationDetailsDecoder, {
    errors: "all",
    onExcessProperty: "error",
  })(reservation.reservationDetails).pipe(
    Effect.map((reservationDetails) =>
      withReservationKindFields({
        ...reservation,
        reservationDetails,
      })
    ),
    Effect.mapError(
      (cause) =>
        new WorkspaceReservationDetailsMalformedError({
          reservationId: reservation.id,
          message: "Stored workspace reservation details are malformed.",
          cause,
        })
    )
  )
);

const storedReservationDetailsDecoder: Schema.Decoder<
  WorkspaceReservationRow["reservationDetails"]
> = storedWorkspaceReservationDetailsSchema;
