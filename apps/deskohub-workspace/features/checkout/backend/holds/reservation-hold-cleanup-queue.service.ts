import { randomUUID } from "node:crypto";
import {
  canonicalizeDotyposEntityId,
  DotyposService,
  hasValidDotyposReservationRequestEvidence,
} from "@deskohub/dotypos";
import { DuplicateMessageError, send } from "@vercel/queue";
import {
  Context,
  Data,
  Duration,
  Effect,
  Exit,
  Layer,
  Match,
  Option,
  Schema,
} from "effect";
import type { WorkspaceReservation } from "@/db/schema";
import { findWorkspaceDotyposReservationsByPaymentOrderId } from "@/features/checkout/backend/reservation";
import {
  getAttachCancellationRecovery,
  getAttachedHoldCreationEpoch,
  getDifferentProviderAttachmentRecovery,
  getHoldCreationMarker,
  getProviderHoldCandidateStabilizationDeadline,
  getResolvedDifferentProviderAttachmentRecovery,
  providerHoldCandidateStabilizationSeconds,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { clamp } from "@/shared/utils";
import { serializeErrorForLog } from "@/shared/utils/error-formatting";
import { instantStringSchema } from "@/shared/utils/temporal";
import {
  getDotyposCancellationAction,
  type ReservationHoldCleanupOutcome,
  ReservationHoldCleanupService,
} from "./reservation-hold-cleanup.service";

export const reservationHoldCleanupQueueTopic =
  "workspace-reservation-hold-cleanup";

export const reservationHoldCleanupScheduleMaxDelaySeconds = 7 * 24 * 60 * 60;
const reservationHoldCleanupRetryWindowSeconds = 60 * 60;
const attachmentCancellationRetentionSeconds = 7 * 24 * 60 * 60;

const LegacyReservationHoldCleanupSchedulePayloadSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  orderId: Schema.String,
  reservationHoldExpiresAtIso: instantStringSchema,
});

const ReservationHoldCleanupSchedulePayloadSchema = Schema.Union([
  LegacyReservationHoldCleanupSchedulePayloadSchema,
  Schema.Struct({
    schemaVersion: Schema.Literal(2),
    reason: Schema.Literal("hold_expired"),
    orderId: Schema.String,
    reservationHoldExpiresAtIso: instantStringSchema,
  }),
  Schema.Struct({
    schemaVersion: Schema.Literal(2),
    reason: Schema.Literal("attachment_compensation"),
    recoveryKind: Schema.Literals([
      "unattached",
      "different_provider",
      "attachment_unknown",
    ]),
    orderId: Schema.Trim.check(Schema.isNonEmpty()),
    providerCreationEpoch: Schema.Trim.check(Schema.isNonEmpty()),
    dotyposReservationId: Schema.Trim.check(Schema.isNonEmpty()),
    reservationCreatedAtIso: instantStringSchema,
  }),
  Schema.Struct({
    schemaVersion: Schema.Literal(2),
    reason: Schema.Literal("attachment_compensation"),
    orderId: Schema.String,
    dotyposReservationId: Schema.String,
    reservationCreatedAtIso: instantStringSchema,
  }),
]);

export type ReservationHoldCleanupSchedulePayload =
  typeof ReservationHoldCleanupSchedulePayloadSchema.Encoded;

type StabilizedProviderCandidateCleanupIdentity = {
  readonly providerCreationEpoch: string;
  readonly dotyposReservationId: string;
};

type ReservationCancellationScheduleInput =
  | {
      readonly reason: "hold_expired";
      readonly orderId: string;
      readonly reservationHoldExpiresAt: Temporal.Instant;
      readonly stabilizedProviderCandidate?: StabilizedProviderCandidateCleanupIdentity;
    }
  | {
      readonly reason: "attachment_compensation";
      readonly orderId: string;
      readonly dotyposReservationId: string;
      readonly reservationCreatedAt: Temporal.Instant;
    }
  | {
      readonly reason: "attachment_compensation";
      readonly recoveryKind:
        | "unattached"
        | "different_provider"
        | "attachment_unknown";
      readonly orderId: string;
      readonly providerCreationEpoch: string;
      readonly dotyposReservationId: string;
      readonly reservationCreatedAt: Temporal.Instant;
      readonly delaySeconds?: number;
      readonly stabilizeCandidate?: true;
    };

type ReservationHoldCleanupScheduleMessage = {
  readonly topic: typeof reservationHoldCleanupQueueTopic;
  readonly payload: ReservationHoldCleanupSchedulePayload;
  readonly options: {
    readonly delaySeconds: number;
    readonly retentionSeconds: number;
    readonly idempotencyKey: string;
  };
};

type ReservationHoldCleanupEnqueueResult = "duplicate" | "enqueued";

export class ReservationHoldCleanupScheduleError extends Data.TaggedError(
  "ReservationHoldCleanupScheduleError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  static fromError(message: string) {
    return (cause: unknown) =>
      new ReservationHoldCleanupScheduleError({
        message,
        cause: serializeErrorForLog(cause),
      });
  }
}

export class AttachmentCancellationHandoffError extends Data.TaggedError(
  "AttachmentCancellationHandoffError"
)<{
  readonly message: string;
}> {}

class ReservationHoldCleanupQueueDuplicateError extends Data.TaggedError(
  "ReservationHoldCleanupQueueDuplicateError"
) {}

class ReservationHoldCleanupQueueRequestError extends Data.TaggedError(
  "ReservationHoldCleanupQueueRequestError"
)<{
  readonly cause: unknown;
}> {}

interface IReservationHoldCleanupScheduleService {
  readonly enqueueCleanup: (
    input: ReservationCancellationScheduleInput
  ) => Effect.Effect<void, ReservationHoldCleanupScheduleError>;
}

export const getReservationHoldCleanupScheduleMessage = (
  input: {
    readonly orderId: string;
    readonly reservationHoldExpiresAt: Temporal.Instant;
    readonly stabilizedProviderCandidate?: StabilizedProviderCandidateCleanupIdentity;
  },
  now = Temporal.Now.instant()
): ReservationHoldCleanupScheduleMessage => {
  const reservationHoldExpiresAtIso = input.reservationHoldExpiresAt.toString();
  const stabilizedProviderCandidateIdentity = input.stabilizedProviderCandidate
    ? `:provider-candidate-stabilized:${input.stabilizedProviderCandidate.providerCreationEpoch}:${input.stabilizedProviderCandidate.dotyposReservationId}`
    : "";
  const delaySeconds = clamp(
    Math.ceil(
      (input.reservationHoldExpiresAt.epochMilliseconds -
        now.epochMilliseconds) /
        1000
    ),
    0,
    reservationHoldCleanupScheduleMaxDelaySeconds
  );
  const retentionSeconds = clamp(
    delaySeconds + reservationHoldCleanupRetryWindowSeconds,
    60,
    reservationHoldCleanupScheduleMaxDelaySeconds
  );

  return {
    topic: reservationHoldCleanupQueueTopic,
    payload: {
      schemaVersion: 2,
      reason: "hold_expired",
      orderId: input.orderId,
      reservationHoldExpiresAtIso,
    } satisfies ReservationHoldCleanupSchedulePayload,
    options: {
      delaySeconds,
      retentionSeconds,
      idempotencyKey: `reservation-hold-cleanup:${input.orderId}:${reservationHoldExpiresAtIso}${stabilizedProviderCandidateIdentity}`,
    },
  };
};

export const getAttachmentCancellationScheduleMessage = (input: {
  readonly orderId: string;
  readonly recoveryKind?:
    | "unattached"
    | "different_provider"
    | "attachment_unknown";
  readonly providerCreationEpoch?: string;
  readonly dotyposReservationId: string;
  readonly reservationCreatedAt: Temporal.Instant;
  readonly delaySeconds?: number;
  readonly stabilizeCandidate?: true;
}): ReservationHoldCleanupScheduleMessage => {
  const dotyposReservationId =
    canonicalizeDotyposEntityId(input.dotyposReservationId) ?? "";
  const exactIdentity =
    input.recoveryKind !== undefined &&
    input.providerCreationEpoch !== undefined;
  return {
    topic: reservationHoldCleanupQueueTopic,
    payload: exactIdentity
      ? {
          schemaVersion: 2,
          reason: "attachment_compensation",
          recoveryKind: input.recoveryKind,
          orderId: input.orderId,
          providerCreationEpoch: input.providerCreationEpoch,
          dotyposReservationId,
          reservationCreatedAtIso: input.reservationCreatedAt.toString(),
        }
      : {
          schemaVersion: 2,
          reason: "attachment_compensation",
          orderId: input.orderId,
          dotyposReservationId,
          reservationCreatedAtIso: input.reservationCreatedAt.toString(),
        },
    options: {
      delaySeconds: input.delaySeconds ?? 0,
      retentionSeconds: attachmentCancellationRetentionSeconds,
      idempotencyKey: input.stabilizeCandidate
        ? `reservation-provider-candidate-stabilization:${input.orderId}:${input.providerCreationEpoch ?? "legacy"}:${dotyposReservationId}`
        : exactIdentity
          ? `reservation-attachment-cancellation:${input.orderId}:${input.providerCreationEpoch}:${dotyposReservationId}`
          : `reservation-attachment-cancellation:${input.orderId}:${dotyposReservationId}`,
    },
  };
};

export function makeReservationHoldCleanupScheduleService(
  sendMessage: typeof send = send
): IReservationHoldCleanupScheduleService {
  return {
    enqueueCleanup: Effect.fn("reservationHoldCleanupSchedule.enqueueCleanup")(
      function* (input) {
        if (
          input.reason === "attachment_compensation" &&
          !canonicalizeDotyposEntityId(input.dotyposReservationId)
        ) {
          return yield* new ReservationHoldCleanupScheduleError({
            message: "Attachment cancellation provider identity is invalid.",
          });
        }
        const message =
          input.reason === "attachment_compensation"
            ? getAttachmentCancellationScheduleMessage(input)
            : getReservationHoldCleanupScheduleMessage(input);
        yield* Effect.logInfo("Reservation hold cleanup enqueue started", {
          message,
        });

        const result = yield* Effect.tryPromise({
          try: async () => {
            await sendMessage(message.topic, message.payload, message.options);
            return "enqueued" as const;
          },
          catch: (cause) =>
            cause instanceof DuplicateMessageError
              ? new ReservationHoldCleanupQueueDuplicateError()
              : new ReservationHoldCleanupQueueRequestError({ cause }),
        }).pipe(
          Effect.catchTag("ReservationHoldCleanupQueueDuplicateError", () =>
            Effect.succeed("duplicate" as const)
          ),
          Effect.mapError((error) =>
            ReservationHoldCleanupScheduleError.fromError(
              "Reservation hold cleanup could not be enqueued."
            )(error.cause)
          )
        );

        const enqueueResultMessages = {
          duplicate: "Reservation hold cleanup was already enqueued",
          enqueued: "Reservation hold cleanup enqueued",
        } satisfies Record<ReservationHoldCleanupEnqueueResult, string>;

        yield* Effect.logInfo(enqueueResultMessages[result], { message });
      }
    ),
  };
}

export class ReservationHoldCleanupScheduleService extends Context.Service<
  ReservationHoldCleanupScheduleService,
  IReservationHoldCleanupScheduleService
>()("ReservationHoldCleanupScheduleService") {
  static Live = Layer.succeed(
    this,
    makeReservationHoldCleanupScheduleService()
  );
}

export const enqueueReservationHoldCleanup = Effect.fn(
  "reservationHoldCleanupSchedule.enqueueBestEffort"
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
      reason: "hold_expired",
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

export const enqueueAttachmentCancellationCompensation = Effect.fn(
  "reservationHoldCleanupSchedule.enqueueAttachmentCancellationCompensation"
)(function* (
  input:
    | {
        readonly orderId: string;
        readonly dotyposReservationId: string;
        readonly reservationCreatedAt: Temporal.Instant;
      }
    | {
        readonly recoveryKind:
          | "unattached"
          | "different_provider"
          | "attachment_unknown";
        readonly orderId: string;
        readonly providerCreationEpoch: string;
        readonly dotyposReservationId: string;
        readonly reservationCreatedAt: Temporal.Instant;
      }
) {
  const reservations = yield* WorkspaceReservationRepository;
  const cleanupSchedule = yield* ReservationHoldCleanupScheduleService;
  const normalizeMarker = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.mapError(
        () =>
          new AttachmentCancellationHandoffError({
            message:
              "Reservation attachment cancellation marker could not be recorded.",
          })
      )
    );
  const exactRecovery = "recoveryKind" in input;
  const marker = exactRecovery
    ? (() => {
        const exactEvidence = {
          id: input.orderId,
          epoch: input.providerCreationEpoch,
          dotyposReservationId: input.dotyposReservationId,
          reservationCreatedAt: input.reservationCreatedAt,
        };
        return input.recoveryKind === "unattached"
          ? normalizeMarker(
              reservations.markAttachFailedCancellationRequired({
                ...exactEvidence,
                failureCode: "attach_failed_cancel_failed",
              })
            )
          : input.recoveryKind === "attachment_unknown"
            ? normalizeMarker(
                reservations.recordProviderHoldCandidate(exactEvidence)
              )
            : normalizeMarker(
                reservations.recordDifferentProviderAttachmentRecovery(
                  exactEvidence
                )
              );
      })()
    : normalizeMarker(
        reservations.recordAttachmentCancellationHandoff({
          id: input.orderId,
          dotyposReservationId: input.dotyposReservationId,
          reservationCreatedAt: input.reservationCreatedAt,
          failureCode: "attach_failed_cancellation_required",
        })
      );
  const cleanupInput: ReservationCancellationScheduleInput = exactRecovery
    ? {
        reason: "attachment_compensation",
        recoveryKind: input.recoveryKind,
        orderId: input.orderId,
        providerCreationEpoch: input.providerCreationEpoch,
        dotyposReservationId: input.dotyposReservationId,
        reservationCreatedAt: input.reservationCreatedAt,
      }
    : {
        reason: "attachment_compensation",
        orderId: input.orderId,
        dotyposReservationId: input.dotyposReservationId,
        reservationCreatedAt: input.reservationCreatedAt,
      };
  const [markerResult, enqueueResult] = yield* Effect.all(
    [
      marker.pipe(Effect.exit),
      cleanupSchedule.enqueueCleanup(cleanupInput).pipe(Effect.exit),
    ],
    { concurrency: "inherit" }
  );

  if (markerResult._tag === "Failure") {
    yield* Effect.logError(
      "Workspace reservation attachment compensation marker failed",
      { orderId: input.orderId }
    );
  }
  if (enqueueResult._tag === "Failure") {
    yield* Effect.logError(
      "Workspace reservation attachment compensation enqueue failed",
      { orderId: input.orderId }
    );
  }
  if (markerResult._tag === "Failure" && enqueueResult._tag === "Failure") {
    return yield* new AttachmentCancellationHandoffError({
      message:
        "Reservation attachment cancellation identity could not be handed off.",
    });
  }
});

export const enqueueProviderHoldCandidateRecovery = Effect.fn(
  "reservationHoldCleanupSchedule.enqueueProviderHoldCandidateRecovery"
)(function* (input: {
  readonly orderId: string;
  readonly providerCreationEpoch: string;
  readonly dotyposReservationId: string;
  readonly reservationCreatedAt: Temporal.Instant;
}) {
  const cleanupSchedule = yield* ReservationHoldCleanupScheduleService;
  yield* cleanupSchedule.enqueueCleanup({
    reason: "attachment_compensation",
    recoveryKind: "attachment_unknown",
    ...input,
    delaySeconds: providerHoldCandidateStabilizationSeconds,
    stabilizeCandidate: true,
  });
});

export const enqueuePendingProviderAttachmentRecoveries = Effect.fn(
  "reservationHoldCleanupSchedule.enqueuePendingProviderAttachmentRecoveries"
)(function* (input: {
  readonly now: Temporal.Instant;
  readonly limit: number;
}) {
  const reservations = yield* WorkspaceReservationRepository;
  const cleanupSchedule = yield* ReservationHoldCleanupScheduleService;
  const pending = yield* reservations.selectPendingProviderAttachmentRecoveries(
    {
      staleBefore: input.now.subtract({ minutes: 2 }),
      limit: input.limit,
    }
  );
  let enqueued = 0;
  let failed = 0;
  for (const reservation of pending) {
    const marker = getHoldCreationMarker(reservation);
    const orphan = getDifferentProviderAttachmentRecovery(reservation);
    const recovery =
      marker?._tag === "candidate" || marker?._tag === "candidate_compensating"
        ? {
            recoveryKind:
              marker._tag === "candidate"
                ? ("attachment_unknown" as const)
                : ("unattached" as const),
            providerCreationEpoch: marker.epoch,
            dotyposReservationId: marker.dotyposReservationId,
            reservationCreatedAt: marker.reservationCreatedAt,
            ...(marker._tag === "candidate" && {
              stabilizeCandidate: true as const,
            }),
          }
        : orphan
          ? {
              recoveryKind: "different_provider" as const,
              providerCreationEpoch: orphan.epoch,
              dotyposReservationId: orphan.dotyposReservationId,
              reservationCreatedAt: orphan.reservationCreatedAt,
            }
          : null;
    if (!recovery) {
      failed += 1;
      continue;
    }
    const result = yield* cleanupSchedule
      .enqueueCleanup({
        reason: "attachment_compensation",
        orderId: reservation.id,
        ...recovery,
      })
      .pipe(Effect.result);
    if (result._tag === "Success") enqueued += 1;
    else failed += 1;
  }
  return { enqueued, failed };
});

const decodeSchedulePayload = Schema.decodeUnknownOption(
  ReservationHoldCleanupSchedulePayloadSchema
);

const dueReservationStates = ["held", "cancelling", "cancellation_failed"];

const isDueReservation = (
  reservation: WorkspaceReservation | null,
  reservationHoldExpiresAt: Temporal.Instant,
  now: Temporal.Instant
) =>
  reservation !== null &&
  dueReservationStates.includes(reservation?.reservationState ?? "") &&
  !getDifferentProviderAttachmentRecovery(reservation) &&
  reservation.paymentState !== "paid" &&
  reservation.reservationHoldExpiresAt?.equals(reservationHoldExpiresAt) &&
  Temporal.Instant.compare(reservation.reservationHoldExpiresAt, now) <= 0;

type AttachmentCompensationClassification = Data.TaggedEnum<{
  candidate: {
    readonly reservation: WorkspaceReservation & {
      readonly dotyposReservationId: string;
      readonly reservationHoldExpiresAt: Temporal.Instant;
    };
  };
  completed: { readonly none?: never };
  different_provider: { readonly none?: never };
  pending_candidate: {
    readonly reservation: WorkspaceReservation & {
      readonly dotyposReservationId: string;
      readonly reservationHoldExpiresAt: Temporal.Instant;
    };
  };
  recoverable: {
    readonly claimCompensation: boolean;
    readonly preserveMarker: boolean;
  };
  released: {
    readonly reservation: WorkspaceReservation;
  };
  same_provider: {
    readonly reservation: WorkspaceReservation & {
      readonly dotyposReservationId: string;
      readonly reservationHoldExpiresAt: Temporal.Instant;
    };
  };
  unsafe: { readonly message: string };
}>;

const AttachmentCompensationClassification =
  Data.taggedEnum<AttachmentCompensationClassification>();

const classifyAttachmentCompensation = (input: {
  readonly recoveryKind: "unattached" | "attachment_unknown";
  readonly reservation: WorkspaceReservation | null;
  readonly providerCreationEpoch: string;
  readonly dotyposReservationId: string;
  readonly reservationCreatedAt: Temporal.Instant;
}): AttachmentCompensationClassification => {
  const reservation = input.reservation;
  if (!reservation) {
    return AttachmentCompensationClassification.unsafe({
      message: "Queued attachment cancellation reservation is missing.",
    });
  }

  const localProviderId = canonicalizeDotyposEntityId(
    reservation.dotyposReservationId
  );
  const sameProvider = localProviderId === input.dotyposReservationId;
  const sameCreationTime =
    reservation.reservationCreatedAt?.equals(input.reservationCreatedAt) ??
    false;
  const exactAttachRecovery = getAttachCancellationRecovery(reservation);
  const hasExactAttachRecovery =
    exactAttachRecovery?.epoch === input.providerCreationEpoch &&
    exactAttachRecovery.dotyposReservationId === input.dotyposReservationId;

  if (
    reservation.reservationState === "cancelled" &&
    sameProvider &&
    sameCreationTime
  ) {
    return AttachmentCompensationClassification.completed({});
  }
  if (
    reservation.reservationState === "cancelling" &&
    sameProvider &&
    sameCreationTime &&
    hasExactAttachRecovery
  ) {
    return AttachmentCompensationClassification.recoverable({
      claimCompensation: false,
      preserveMarker: false,
    });
  }
  if (
    reservation.reservationState === "cancellation_failed" &&
    sameProvider &&
    sameCreationTime
  ) {
    return AttachmentCompensationClassification.recoverable({
      claimCompensation: false,
      preserveMarker: true,
    });
  }
  if (
    input.recoveryKind === "attachment_unknown" &&
    reservation.reservationState === "draft" &&
    reservation.paymentState === "not_started" &&
    localProviderId === null &&
    reservation.reservationCreatedAt === null &&
    reservation.failureCode === null
  ) {
    return AttachmentCompensationClassification.released({ reservation });
  }
  if (
    input.recoveryKind === "attachment_unknown" &&
    reservation.reservationState === "creating_hold" &&
    sameProvider &&
    sameCreationTime &&
    getHoldCreationMarker(reservation)?._tag === "candidate" &&
    getHoldCreationMarker(reservation)?.epoch === input.providerCreationEpoch &&
    reservation.reservationHoldExpiresAt
  ) {
    return AttachmentCompensationClassification.pending_candidate({
      reservation: reservation as WorkspaceReservation & {
        readonly dotyposReservationId: string;
        readonly reservationHoldExpiresAt: Temporal.Instant;
      },
    });
  }
  if (
    reservation.reservationState === "creating_hold" &&
    (reservation.dotyposReservationId === null || sameProvider)
  ) {
    const marker = getHoldCreationMarker(reservation);
    if (
      marker?.epoch === input.providerCreationEpoch &&
      marker._tag !== "pre_provider" &&
      ((marker._tag !== "candidate" &&
        marker._tag !== "candidate_compensating") ||
        (marker.dotyposReservationId === input.dotyposReservationId &&
          marker.reservationCreatedAt.equals(input.reservationCreatedAt)))
    ) {
      return AttachmentCompensationClassification.recoverable({
        claimCompensation:
          marker._tag !== "compensating" &&
          marker._tag !== "candidate_compensating",
        preserveMarker: true,
      });
    }
  }
  if (
    input.recoveryKind === "attachment_unknown" &&
    reservation.reservationState === "held" &&
    sameProvider &&
    sameCreationTime &&
    getHoldCreationMarker(reservation)?._tag === "candidate" &&
    getHoldCreationMarker(reservation)?.epoch === input.providerCreationEpoch &&
    reservation.reservationHoldExpiresAt
  ) {
    return AttachmentCompensationClassification.candidate({
      reservation: reservation as WorkspaceReservation & {
        readonly dotyposReservationId: string;
        readonly reservationHoldExpiresAt: Temporal.Instant;
      },
    });
  }
  if (
    input.recoveryKind === "attachment_unknown" &&
    reservation.reservationState === "held" &&
    sameProvider &&
    sameCreationTime &&
    getAttachedHoldCreationEpoch(reservation) === input.providerCreationEpoch &&
    reservation.reservationHoldExpiresAt
  ) {
    return AttachmentCompensationClassification.same_provider({
      reservation: reservation as WorkspaceReservation & {
        readonly dotyposReservationId: string;
        readonly reservationHoldExpiresAt: Temporal.Instant;
      },
    });
  }
  if (
    input.recoveryKind === "attachment_unknown" &&
    reservation.reservationState === "held" &&
    localProviderId &&
    localProviderId !== input.dotyposReservationId
  ) {
    return AttachmentCompensationClassification.different_provider({});
  }
  return AttachmentCompensationClassification.unsafe({
    message:
      "Queued attachment cancellation identity does not match a recoverable state.",
  });
};

const recoverUnattachedProviderHold = Effect.fn(
  "reservationHoldCleanupSchedule.recoverUnattachedProviderHold"
)(function* (input: {
  readonly classification: Extract<
    AttachmentCompensationClassification,
    { readonly _tag: "recoverable" }
  >;
  readonly orderId: string;
  readonly providerCreationEpoch: string;
  readonly dotyposReservationId: string;
  readonly reservationCreatedAt: Temporal.Instant;
}) {
  const reservations = yield* WorkspaceReservationRepository;
  const cleanup = yield* ReservationHoldCleanupService;
  const preserveExactRecovery = () =>
    reservations.markAttachFailedCancellationRequired({
      id: input.orderId,
      epoch: input.providerCreationEpoch,
      dotyposReservationId: input.dotyposReservationId,
      reservationCreatedAt: input.reservationCreatedAt,
      failureCode: "attach_failed_cancel_failed",
    });

  if (input.classification.claimCompensation) {
    yield* reservations.claimHoldCreationCompensation({
      id: input.orderId,
      epoch: input.providerCreationEpoch,
    });
  }
  if (input.classification.preserveMarker) {
    yield* preserveExactRecovery().pipe(
      Effect.mapError(
        ReservationHoldCleanupScheduleError.fromError(
          "Queued attachment cancellation identity could not be recorded."
        )
      )
    );
  }

  const outcome = yield* cleanup
    .cancelOrderHold({
      orderId: input.orderId,
      recoveryReason: "attachment_compensation",
    })
    .pipe(
      Effect.mapError(
        ReservationHoldCleanupScheduleError.fromError(
          "Queued attachment cancellation failed."
        )
      ),
      Effect.onExit((exit) =>
        Effect.suspend(() =>
          Exit.isFailure(exit)
            ? preserveExactRecovery().pipe(Effect.exit, Effect.asVoid)
            : Effect.void
        )
      )
    );
  if (outcome === "cancelled") return "cancelled" as const;

  const definitive = yield* reservations
    .findById(input.orderId)
    .pipe(
      Effect.mapError(
        ReservationHoldCleanupScheduleError.fromError(
          "Queued attachment cancellation outcome could not be verified."
        )
      )
    );
  const classification = classifyAttachmentCompensation({
    recoveryKind: "unattached",
    reservation: definitive,
    providerCreationEpoch: input.providerCreationEpoch,
    dotyposReservationId: input.dotyposReservationId,
    reservationCreatedAt: input.reservationCreatedAt,
  });
  if (classification._tag === "completed") return "cancelled" as const;
  return yield* new ReservationHoldCleanupScheduleError({
    message: "Queued attachment cancellation remains unresolved.",
  });
});

const completeProviderHoldCandidate = Effect.fn(
  "reservationHoldCleanupSchedule.completeProviderHoldCandidate"
)(function* (input: {
  readonly reservation: WorkspaceReservation & {
    readonly dotyposReservationId: string;
    readonly reservationHoldExpiresAt: Temporal.Instant;
  };
  readonly providerCreationEpoch: string;
  readonly reservationCreatedAt: Temporal.Instant;
  readonly now: Temporal.Instant;
}) {
  const stabilizationDeadline = getProviderHoldCandidateStabilizationDeadline(
    input.reservation
  );
  if (!stabilizationDeadline) {
    return yield* new ReservationHoldCleanupScheduleError({
      message: "Provider candidate stabilization evidence is missing.",
    });
  }
  if (Temporal.Instant.compare(input.now, stabilizationDeadline) < 0) {
    return yield* new ReservationHoldCleanupScheduleError({
      message: "Provider candidate stabilization remains pending.",
    });
  }
  yield* verifyExactProviderWinnerEvidence({
    reservation: input.reservation,
    providerCreationEpoch: input.providerCreationEpoch,
  });
  const reservations = yield* WorkspaceReservationRepository;
  yield* reservations
    .completeProviderHoldCandidate({
      id: input.reservation.id,
      epoch: input.providerCreationEpoch,
      dotyposReservationId: input.reservation.dotyposReservationId,
      reservationCreatedAt: input.reservationCreatedAt,
    })
    .pipe(
      Effect.mapError(
        ReservationHoldCleanupScheduleError.fromError(
          "Provider candidate attachment could not be completed."
        )
      )
    );
  const cleanupSchedule = yield* ReservationHoldCleanupScheduleService;
  yield* cleanupSchedule.enqueueCleanup({
    reason: "hold_expired",
    orderId: input.reservation.id,
    reservationHoldExpiresAt: input.reservation.reservationHoldExpiresAt,
    ...(Temporal.Instant.compare(
      input.reservation.reservationHoldExpiresAt,
      input.now
    ) <= 0 && {
      stabilizedProviderCandidate: {
        providerCreationEpoch: input.providerCreationEpoch,
        dotyposReservationId: input.reservation.dotyposReservationId,
      },
    }),
  });
  return "cancelled" as const;
});

const verifyExactProviderWinnerEvidence = Effect.fn(
  "reservationHoldCleanupSchedule.verifyExactProviderWinnerEvidence"
)(function* (input: {
  readonly reservation: WorkspaceReservation & {
    readonly dotyposReservationId: string;
  };
  readonly providerCreationEpoch: string;
  readonly requiredCancelledProviderId?: string;
}) {
  const matches = yield* findWorkspaceDotyposReservationsByPaymentOrderId({
    paymentOrderId: input.reservation.id,
    providerCreationEpoch: input.providerCreationEpoch,
  }).pipe(
    Effect.mapError(
      ReservationHoldCleanupScheduleError.fromError(
        "Provider attachment evidence could not be reverified."
      )
    )
  );
  const live = matches.filter((reservation) => reservation.status === "NEW");
  const [winner] = live;
  const winnerId = canonicalizeDotyposEntityId(
    input.reservation.dotyposReservationId
  );
  const customerId = canonicalizeDotyposEntityId(
    input.reservation.dotyposCustomerId
  );
  const allEvidenceIsDefinitive = matches.every((reservation) => {
    const providerId = canonicalizeDotyposEntityId(reservation.id);
    const validIdentity =
      providerId &&
      canonicalizeDotyposEntityId(reservation._customerId) === customerId &&
      hasValidDotyposReservationRequestEvidence(reservation);
    return (
      validIdentity &&
      (reservation === winner ||
        getDotyposCancellationAction(reservation.status) === "complete")
    );
  });
  const requiredLoserIsCancelled =
    input.requiredCancelledProviderId === undefined ||
    matches.some(
      (reservation) =>
        canonicalizeDotyposEntityId(reservation.id) ===
          input.requiredCancelledProviderId &&
        getDotyposCancellationAction(reservation.status) === "complete"
    );
  if (
    live.length !== 1 ||
    !winner ||
    canonicalizeDotyposEntityId(winner.id) !== winnerId ||
    !allEvidenceIsDefinitive ||
    !requiredLoserIsCancelled
  ) {
    return yield* new ReservationHoldCleanupScheduleError({
      message: "Provider attachment evidence is not definitive.",
    });
  }
  return winner;
});

export const verifyDifferentProviderAttachmentRecoveryEvidence = Effect.fn(
  "reservationHoldCleanupSchedule.verifyDifferentProviderAttachmentRecoveryEvidence"
)(function* (input: {
  readonly reservation: WorkspaceReservation & {
    readonly dotyposReservationId: string;
  };
  readonly providerCreationEpoch: string;
  readonly losingDotyposReservationId: string;
}) {
  yield* verifyExactProviderWinnerEvidence({
    reservation: input.reservation,
    providerCreationEpoch: input.providerCreationEpoch,
    requiredCancelledProviderId: input.losingDotyposReservationId,
  });
});

export const recoverPersistedProviderHoldCandidate = Effect.fn(
  "reservationHoldCleanupSchedule.recoverPersistedProviderHoldCandidate"
)(function* (input: {
  readonly reservation: WorkspaceReservation & {
    readonly dotyposReservationId: string;
    readonly reservationHoldExpiresAt: Temporal.Instant;
  };
  readonly providerCreationEpoch: string;
  readonly reservationCreatedAt: Temporal.Instant;
}) {
  const reservations = yield* WorkspaceReservationRepository;
  yield* verifyExactProviderWinnerEvidence({
    reservation: input.reservation,
    providerCreationEpoch: input.providerCreationEpoch,
  });
  yield* reservations
    .attachHold({
      id: input.reservation.id,
      epoch: input.providerCreationEpoch,
      dotyposReservationId: input.reservation.dotyposReservationId,
      reservationCreatedAt: input.reservationCreatedAt,
    })
    .pipe(
      Effect.mapError(
        ReservationHoldCleanupScheduleError.fromError(
          "Persisted provider candidate could not be attached."
        )
      )
    );
  yield* enqueueProviderHoldCandidateRecovery({
    orderId: input.reservation.id,
    providerCreationEpoch: input.providerCreationEpoch,
    dotyposReservationId: input.reservation.dotyposReservationId,
    reservationCreatedAt: input.reservationCreatedAt,
  });
  return yield* reservations
    .findById(input.reservation.id)
    .pipe(
      Effect.mapError(
        ReservationHoldCleanupScheduleError.fromError(
          "Attached provider candidate could not be reloaded."
        )
      )
    );
});

const verifyReleasedProviderCancellation = Effect.fn(
  "reservationHoldCleanupSchedule.verifyReleasedProviderCancellation"
)(function* (input: {
  readonly reservation: WorkspaceReservation;
  readonly providerCreationEpoch: string;
  readonly dotyposReservationId: string;
}) {
  const matches = yield* findWorkspaceDotyposReservationsByPaymentOrderId({
    paymentOrderId: input.reservation.id,
    providerCreationEpoch: input.providerCreationEpoch,
  }).pipe(
    Effect.mapError(
      ReservationHoldCleanupScheduleError.fromError(
        "Released provider cancellation could not be reverified."
      )
    )
  );
  const candidates = matches.filter(
    (reservation) =>
      canonicalizeDotyposEntityId(reservation.id) === input.dotyposReservationId
  );
  const [candidate] = candidates;
  if (
    matches.length !== 1 ||
    candidates.length !== 1 ||
    !candidate ||
    canonicalizeDotyposEntityId(candidate._customerId) !==
      canonicalizeDotyposEntityId(input.reservation.dotyposCustomerId) ||
    !hasValidDotyposReservationRequestEvidence(candidate) ||
    getDotyposCancellationAction(candidate.status) !== "complete"
  ) {
    return yield* new ReservationHoldCleanupScheduleError({
      message: "Released provider cancellation evidence is not definitive.",
    });
  }
  return "cancelled" as const;
});

export const processReservationHoldCleanupScheduleMessage = Effect.fn(
  "reservationHoldCleanupSchedule.processMessage"
)(function* (message: unknown, now = Temporal.Now.instant()) {
  const payload = Option.getOrUndefined(decodeSchedulePayload(message));
  if (!payload) {
    yield* Effect.logWarning(
      "Reservation hold cleanup queue message ignored: invalid payload"
    );
    return "ignored" as const;
  }

  const reservations = yield* WorkspaceReservationRepository;
  const cleanup = yield* ReservationHoldCleanupService;

  if (
    payload.schemaVersion === 2 &&
    payload.reason === "attachment_compensation"
  ) {
    if (!("recoveryKind" in payload)) {
      const handoff = yield* reservations
        .recordAttachmentCancellationHandoff({
          id: payload.orderId,
          dotyposReservationId: payload.dotyposReservationId,
          reservationCreatedAt: Temporal.Instant.from(
            payload.reservationCreatedAtIso
          ),
          failureCode: "attach_failed_cancellation_required",
        })
        .pipe(
          Effect.mapError(
            ReservationHoldCleanupScheduleError.fromError(
              "Queued attachment cancellation identity could not be recorded."
            )
          )
        );
      if (!handoff) {
        yield* Effect.logInfo(
          "Attachment cancellation queue message ignored: reservation state changed",
          { orderId: payload.orderId }
        );
        return "ignored" as const;
      }
      return yield* cleanup
        .cancelOrderHold({
          orderId: payload.orderId,
          recoveryReason: "attachment_compensation",
        })
        .pipe(
          Effect.mapError(
            ReservationHoldCleanupScheduleError.fromError(
              "Queued attachment cancellation failed."
            )
          )
        );
    }

    const dotyposReservationId = canonicalizeDotyposEntityId(
      payload.dotyposReservationId
    );
    if (!dotyposReservationId) {
      return yield* new ReservationHoldCleanupScheduleError({
        message: "Queued attachment cancellation identity is invalid.",
      });
    }
    const reservationCreatedAt = Temporal.Instant.from(
      payload.reservationCreatedAtIso
    );

    if (
      payload.recoveryKind === "attachment_unknown" ||
      payload.recoveryKind === "unattached"
    ) {
      const attachmentState = yield* reservations
        .findById(payload.orderId)
        .pipe(
          Effect.mapError(
            ReservationHoldCleanupScheduleError.fromError(
              "Queued attachment outcome could not be loaded."
            )
          )
        );
      const classification = classifyAttachmentCompensation({
        recoveryKind: payload.recoveryKind,
        reservation: attachmentState,
        providerCreationEpoch: payload.providerCreationEpoch,
        dotyposReservationId,
        reservationCreatedAt,
      });
      const exactOutcome = yield* Match.value(classification).pipe(
        Match.tag("candidate", ({ reservation }) =>
          completeProviderHoldCandidate({
            reservation,
            providerCreationEpoch: payload.providerCreationEpoch,
            reservationCreatedAt,
            now,
          })
        ),
        Match.tag("completed", () => Effect.succeed("cancelled" as const)),
        Match.tag("same_provider", ({ reservation }) =>
          Effect.gen(function* () {
            const cleanupSchedule =
              yield* ReservationHoldCleanupScheduleService;
            yield* cleanupSchedule.enqueueCleanup({
              reason: "hold_expired",
              orderId: reservation.id,
              reservationHoldExpiresAt: reservation.reservationHoldExpiresAt,
              ...(Temporal.Instant.compare(
                reservation.reservationHoldExpiresAt,
                now
              ) <= 0 && {
                stabilizedProviderCandidate: {
                  providerCreationEpoch: payload.providerCreationEpoch,
                  dotyposReservationId: reservation.dotyposReservationId,
                },
              }),
            });
            return "cancelled" as const;
          })
        ),
        Match.tag("recoverable", (recoverable) =>
          recoverUnattachedProviderHold({
            classification: recoverable,
            orderId: payload.orderId,
            providerCreationEpoch: payload.providerCreationEpoch,
            dotyposReservationId,
            reservationCreatedAt,
          })
        ),
        Match.tag("released", ({ reservation }) =>
          verifyReleasedProviderCancellation({
            reservation,
            providerCreationEpoch: payload.providerCreationEpoch,
            dotyposReservationId,
          })
        ),
        Match.tag("different_provider", () => Effect.succeed(null)),
        Match.tag("pending_candidate", ({ reservation }) =>
          recoverPersistedProviderHoldCandidate({
            reservation,
            providerCreationEpoch: payload.providerCreationEpoch,
            reservationCreatedAt,
          }).pipe(Effect.as("cancelled" as const))
        ),
        Match.tag("unsafe", ({ message }) =>
          Effect.fail(new ReservationHoldCleanupScheduleError({ message }))
        ),
        Match.exhaustive
      );
      if (exactOutcome) return exactOutcome;
    }

    const beforeClaim = yield* reservations
      .findById(payload.orderId)
      .pipe(
        Effect.mapError(
          ReservationHoldCleanupScheduleError.fromError(
            "Different-provider attachment recovery state could not be loaded."
          )
        )
      );
    const alreadyResolved =
      beforeClaim &&
      getResolvedDifferentProviderAttachmentRecovery(beforeClaim);
    if (
      alreadyResolved?.epoch === payload.providerCreationEpoch &&
      alreadyResolved.dotyposReservationId === dotyposReservationId &&
      (!alreadyResolved.hasExactTimestamp ||
        alreadyResolved.reservationCreatedAt.equals(reservationCreatedAt))
    ) {
      return "cancelled" as const;
    }
    const markerResult = yield* reservations
      .recordDifferentProviderAttachmentRecovery({
        id: payload.orderId,
        epoch: payload.providerCreationEpoch,
        dotyposReservationId,
        reservationCreatedAt,
      })
      .pipe(
        Effect.mapError(
          ReservationHoldCleanupScheduleError.fromError(
            "Different-provider attachment recovery identity could not be recorded."
          )
        ),
        Effect.result
      );
    if (markerResult._tag === "Failure") {
      if (
        !beforeClaim?.dotyposReservationId ||
        canonicalizeDotyposEntityId(beforeClaim.dotyposReservationId) ===
          dotyposReservationId ||
        (beforeClaim.paymentState === "not_started" &&
          beforeClaim.reservationState === "held")
      ) {
        return yield* markerResult.failure;
      }
      const matches = yield* findWorkspaceDotyposReservationsByPaymentOrderId({
        paymentOrderId: payload.orderId,
        providerCreationEpoch: payload.providerCreationEpoch,
      }).pipe(
        Effect.mapError(
          ReservationHoldCleanupScheduleError.fromError(
            "Resolved different-provider recovery could not be re-proved."
          )
        )
      );
      const candidates = matches.filter(
        (reservation) =>
          canonicalizeDotyposEntityId(reservation.id) === dotyposReservationId
      );
      const [candidate] = candidates;
      if (
        candidates.length === 1 &&
        candidate &&
        canonicalizeDotyposEntityId(candidate._customerId) ===
          canonicalizeDotyposEntityId(beforeClaim.dotyposCustomerId) &&
        hasValidDotyposReservationRequestEvidence(candidate) &&
        getDotyposCancellationAction(candidate.status) === "complete"
      ) {
        return "cancelled" as const;
      }
      return yield* markerResult.failure;
    }

    const ownerId = randomUUID();
    const staleBefore = now.subtract({ minutes: 2 });
    const releaseClaim = () =>
      reservations.releaseDifferentProviderAttachmentRecovery({
        id: payload.orderId,
        epoch: payload.providerCreationEpoch,
        dotyposReservationId,
        reservationCreatedAt,
        ownerId,
      });
    const failRecovery = (message: string, cause?: unknown) =>
      Effect.fail(new ReservationHoldCleanupScheduleError({ message, cause }));
    const ownedRecovery = Effect.gen(function* () {
      const claimed =
        yield* reservations.claimDifferentProviderAttachmentRecovery({
          id: payload.orderId,
          epoch: payload.providerCreationEpoch,
          dotyposReservationId,
          reservationCreatedAt,
          ownerId,
          staleBefore,
        });
      if (!claimed) {
        return yield* new ReservationHoldCleanupScheduleError({
          message:
            "Different-provider attachment recovery remains owned by another worker.",
        });
      }

      const definitive = yield* reservations
        .findById(payload.orderId)
        .pipe(
          Effect.catch((cause) =>
            failRecovery(
              "Different-provider attachment recovery state could not be reloaded.",
              cause
            )
          )
        );
      const exactRecovery =
        definitive && getDifferentProviderAttachmentRecovery(definitive);
      if (
        !definitive ||
        exactRecovery?.phase !== "processing" ||
        exactRecovery.ownerId !== ownerId ||
        exactRecovery.epoch !== payload.providerCreationEpoch ||
        exactRecovery.dotyposReservationId !== dotyposReservationId ||
        (exactRecovery.hasExactTimestamp &&
          !exactRecovery.reservationCreatedAt.equals(reservationCreatedAt))
      ) {
        return yield* failRecovery(
          "Different-provider attachment recovery ownership changed."
        );
      }

      const matches = yield* findWorkspaceDotyposReservationsByPaymentOrderId({
        paymentOrderId: payload.orderId,
        providerCreationEpoch: payload.providerCreationEpoch,
      }).pipe(
        Effect.catch((cause) =>
          failRecovery(
            "Different-provider attachment recovery lookup failed.",
            cause
          )
        )
      );
      const candidates = matches.filter(
        (reservation) =>
          canonicalizeDotyposEntityId(reservation.id) === dotyposReservationId
      );
      const [candidate] = candidates;
      if (
        candidates.length !== 1 ||
        !candidate ||
        canonicalizeDotyposEntityId(candidate._customerId) !==
          canonicalizeDotyposEntityId(definitive.dotyposCustomerId) ||
        !hasValidDotyposReservationRequestEvidence(candidate)
      ) {
        return yield* failRecovery(
          "Different-provider attachment recovery evidence is not definitive."
        );
      }

      const action = getDotyposCancellationAction(candidate.status);
      if (action === "refuse") {
        return yield* failRecovery(
          "Different-provider attachment recovery requires manual review."
        );
      }
      if (action === "delete") {
        const stillOwned =
          yield* reservations.claimDifferentProviderAttachmentRecovery({
            id: payload.orderId,
            epoch: payload.providerCreationEpoch,
            dotyposReservationId,
            reservationCreatedAt,
            ownerId,
            staleBefore,
          });
        if (!stillOwned) {
          return yield* failRecovery(
            "Different-provider attachment recovery ownership changed before cancellation."
          );
        }
        const dotypos = yield* DotyposService;
        yield* dotypos
          .cancelReservation(dotyposReservationId)
          .pipe(
            Effect.catch((cause) =>
              failRecovery(
                "Different-provider attachment cancellation failed.",
                cause
              )
            )
          );
      }

      if (!definitive.dotyposReservationId) {
        return yield* failRecovery(
          "Different-provider attachment recovery winner is unavailable."
        );
      }
      yield* verifyDifferentProviderAttachmentRecoveryEvidence({
        reservation: definitive as WorkspaceReservation & {
          readonly dotyposReservationId: string;
        },
        providerCreationEpoch: payload.providerCreationEpoch,
        losingDotyposReservationId: dotyposReservationId,
      }).pipe(
        Effect.catch((cause) =>
          failRecovery(
            "Different-provider attachment recovery remains fenced pending definitive evidence.",
            cause
          )
        )
      );

      yield* reservations
        .completeDifferentProviderAttachmentRecovery({
          id: payload.orderId,
          epoch: payload.providerCreationEpoch,
          dotyposReservationId,
          reservationCreatedAt,
          ownerId,
        })
        .pipe(
          Effect.catch((cause) =>
            reservations.findById(payload.orderId).pipe(
              Effect.flatMap((afterCompletion) => {
                const resolved =
                  afterCompletion &&
                  getResolvedDifferentProviderAttachmentRecovery(
                    afterCompletion
                  );
                return resolved?.epoch === payload.providerCreationEpoch &&
                  resolved.dotyposReservationId === dotyposReservationId
                  ? Effect.void
                  : failRecovery(
                      "Different-provider attachment recovery completion could not be stored.",
                      cause
                    );
              }),
              Effect.catch((reloadCause) =>
                failRecovery(
                  "Different-provider attachment recovery completion could not be verified.",
                  reloadCause
                )
              )
            )
          )
        );
      return "cancelled" as const;
    });
    return yield* ownedRecovery.pipe(
      Effect.onExit((exit) =>
        releaseClaim().pipe(
          Effect.exit,
          Effect.asVoid,
          Effect.when(Effect.succeed(Exit.isFailure(exit))),
          Effect.asVoid
        )
      )
    );
  }

  const reservationHoldExpiresAt = Temporal.Instant.from(
    payload.reservationHoldExpiresAtIso
  );

  const reservation = yield* reservations
    .findById(payload.orderId)
    .pipe(
      Effect.mapError(
        ReservationHoldCleanupScheduleError.fromError(
          "Queued reservation hold cleanup state could not be loaded."
        )
      )
    );

  if (!isDueReservation(reservation, reservationHoldExpiresAt, now)) {
    yield* Effect.logInfo(
      "Reservation hold cleanup queue message ignored: reservation not due",
      { payload }
    );
    return "ignored" as const;
  }

  const outcome = yield* cleanup
    .cancelOrderHold({
      orderId: payload.orderId,
      recoveryReason: "hold_expired",
      holdExpiredAt: now,
    })
    .pipe(
      Effect.mapError(
        ReservationHoldCleanupScheduleError.fromError(
          "Queued reservation hold cleanup failed."
        )
      )
    );

  return outcome satisfies ReservationHoldCleanupOutcome;
});
