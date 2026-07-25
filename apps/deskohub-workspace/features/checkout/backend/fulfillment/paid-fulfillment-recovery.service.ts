import { randomUUID } from "node:crypto";
import { DuplicateMessageError, send } from "@vercel/queue";
import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import type { PaidFulfillmentJob } from "@/db/schema";
import {
  PaidFulfillmentRepository,
  PaidFulfillmentRepositoryLive,
} from "./paid-fulfillment.repository";
import {
  PAID_FULFILLMENT_PROCESSING_RETRY_AFTER_MS,
  WorkspacePaidFulfillmentService,
  WorkspacePaidFulfillmentServiceLiveWithDependencies,
} from "./paid-fulfillment.service";

export const paidFulfillmentQueueTopic = "workspace-paid-fulfillment";
const paidFulfillmentQueueRetentionSeconds = 24 * 60 * 60;
const paidFulfillmentRetryBaseMinutes = 5;
const paidFulfillmentRetryMaxMinutes = 60;

const PaidFulfillmentQueuePayloadSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  jobId: Schema.NonEmptyString,
});

export type PaidFulfillmentQueuePayload =
  typeof PaidFulfillmentQueuePayloadSchema.Encoded;

export class PaidFulfillmentQueueError extends Data.TaggedError(
  "PaidFulfillmentQueueError"
)<{
  readonly message: string;
}> {}

interface IPaidFulfillmentQueueService {
  readonly enqueue: (
    job: PaidFulfillmentJob
  ) => Effect.Effect<void, PaidFulfillmentQueueError>;
}

export class PaidFulfillmentQueueService extends Context.Service<
  PaidFulfillmentQueueService,
  IPaidFulfillmentQueueService
>()("PaidFulfillmentQueueService") {
  static Live = Layer.succeed(this, makePaidFulfillmentQueueService());
}

export const getPaidFulfillmentQueueMessage = (job: PaidFulfillmentJob) => ({
  topic: paidFulfillmentQueueTopic,
  payload: {
    schemaVersion: 1,
    jobId: job.id,
  } satisfies PaidFulfillmentQueuePayload,
  options: {
    idempotencyKey: [
      "paid-fulfillment",
      job.id,
      job.attemptCount,
      job.nextAttemptAt.toString(),
    ].join(":"),
    retentionSeconds: paidFulfillmentQueueRetentionSeconds,
  },
});

export function makePaidFulfillmentQueueService(
  sendMessage: typeof send = send
): IPaidFulfillmentQueueService {
  return {
    enqueue: Effect.fn("PaidFulfillmentQueueService.enqueue")(function* (job) {
      const message = getPaidFulfillmentQueueMessage(job);
      yield* Effect.tryPromise({
        try: () => sendMessage(message.topic, message.payload, message.options),
        catch: (cause) =>
          cause instanceof DuplicateMessageError
            ? "duplicate"
            : new PaidFulfillmentQueueError({
                message: "Paid fulfillment job could not be enqueued.",
              }),
      }).pipe(
        Effect.catchIf(
          (result): result is "duplicate" => result === "duplicate",
          () => Effect.void
        )
      );
    }),
  };
}

export interface PaidFulfillmentRecoveryResult {
  readonly discovered: number;
  readonly retired: number;
  readonly enqueued: number;
  readonly enqueueFailed: number;
}

interface IPaidFulfillmentRecoveryService {
  readonly sweep: (input: {
    readonly now: Temporal.Instant;
    readonly limit: number;
  }) => Effect.Effect<PaidFulfillmentRecoveryResult, unknown>;
}

export class PaidFulfillmentRecoveryService extends Context.Service<
  PaidFulfillmentRecoveryService,
  IPaidFulfillmentRecoveryService
>()("PaidFulfillmentRecoveryService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const repository = yield* PaidFulfillmentRepository;
      const queue = yield* PaidFulfillmentQueueService;

      return {
        sweep: Effect.fn("PaidFulfillmentRecoveryService.sweep")(function* ({
          limit,
          now,
        }) {
          const staleBefore = now.subtract({
            milliseconds: PAID_FULFILLMENT_PROCESSING_RETRY_AFTER_MS,
          });
          const discovered = yield* repository.reconcilePaidReservations({
            limit,
          });
          const retired = yield* repository.retireExhaustedLeases({
            now,
            staleBefore,
          });
          const jobs = yield* repository.selectDispatchable({
            limit,
            now,
            staleBefore,
          });
          const enqueueResults = yield* Effect.forEach(
            jobs,
            (job) => queue.enqueue(job).pipe(Effect.result),
            { concurrency: "inherit" }
          );

          return {
            discovered,
            retired,
            enqueued: enqueueResults.filter(
              (result) => result._tag === "Success"
            ).length,
            enqueueFailed: enqueueResults.filter(
              (result) => result._tag === "Failure"
            ).length,
          };
        }),
      };
    })
  );
}

const decodePaidFulfillmentQueuePayload = Schema.decodeUnknownOption(
  PaidFulfillmentQueuePayloadSchema
);

export const processPaidFulfillmentQueueMessage = Effect.fn(
  "processPaidFulfillmentQueueMessage"
)(function* (
  message: unknown,
  now = Temporal.Now.instant(),
  ownerId = randomUUID()
) {
  const payload = Option.getOrUndefined(
    decodePaidFulfillmentQueuePayload(message)
  );
  if (!payload) {
    yield* Effect.logWarning(
      "Paid fulfillment queue message ignored: invalid payload"
    );
    return "ignored" as const;
  }

  const repository = yield* PaidFulfillmentRepository;
  const fulfillment = yield* WorkspacePaidFulfillmentService;
  const claimed = yield* repository.claim({
    id: payload.jobId,
    ownerId,
    now,
    staleBefore: now.subtract({
      milliseconds: PAID_FULFILLMENT_PROCESSING_RETRY_AFTER_MS,
    }),
  });
  if (!claimed) {
    yield* Effect.logInfo("Paid fulfillment queue message ignored", {
      jobId: payload.jobId,
      reason: "lease_unavailable",
    });
    return "ignored" as const;
  }

  const fulfillmentResult = yield* fulfillment
    .fulfillPaidOrder({
      orderId: claimed.workspaceReservationId,
    })
    .pipe(Effect.result);

  if (
    fulfillmentResult._tag === "Success" &&
    (fulfillmentResult.success === "delivery_dispatched" ||
      fulfillmentResult.success === "fulfilled")
  ) {
    const completed = yield* repository.markCompleted({
      id: claimed.id,
      ownerId,
      completedAt: now,
    });
    return completed ? ("completed" as const) : ("lost" as const);
  }

  const failureCode =
    fulfillmentResult._tag === "Failure" &&
    fulfillmentResult.failure._tag === "WorkspacePaidFulfillmentError"
      ? fulfillmentResult.failure.failureCode
      : "paid_fulfillment_incomplete";
  const retryMinutes = Math.min(
    paidFulfillmentRetryBaseMinutes *
      2 ** Math.max(0, claimed.attemptCount - 1),
    paidFulfillmentRetryMaxMinutes
  );
  return yield* repository.markAttemptFailed({
    id: claimed.id,
    ownerId,
    failedAt: now,
    nextAttemptAt: now.add({ minutes: retryMinutes }),
    failureCode,
  });
});

export const PaidFulfillmentRecoveryServiceLiveWithDependencies =
  PaidFulfillmentRecoveryService.Live.pipe(
    Layer.provide(PaidFulfillmentQueueService.Live),
    Layer.provide(PaidFulfillmentRepositoryLive),
    Layer.provide(WorkspaceDatabaseLive)
  );

export const PaidFulfillmentWorkerLiveWithDependencies = Layer.mergeAll(
  PaidFulfillmentRepositoryLive.pipe(Layer.provide(WorkspaceDatabaseLive)),
  WorkspacePaidFulfillmentServiceLiveWithDependencies
);
