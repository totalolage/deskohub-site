import "server-only";

import type { DotyposCustomerId } from "@deskohub/dotypos";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Duration, Effect, Layer, Option } from "effect";
import type { SqlError } from "effect/unstable/sql";
import {
  WorkspaceDatabase,
  type WorkspaceTransaction,
} from "@/db/database.service";
import {
  emailCampaignDeliveryBatches,
  emailCampaignRecipients,
  emailCampaignSends,
  emailCampaigns,
} from "@/db/schema";
import { currentInstant } from "@/shared/utils/temporal";
import { campaignDeliveryBatchSize } from "../campaign-delivery-batches";
import {
  type BatchOutcome,
  type BatchRecipient,
  BatchRequest,
  CampaignBatchDelivery,
  CampaignDeliveryIncomplete,
  type DeliveredAttempt,
  type DeliveredCampaign,
  type PersistedBatch,
  PreparedBatch,
} from "./campaign-batch-delivery.service";
import type { CampaignDeliveryAttempt } from "./campaign-send-queue.service";
import { OnceCampaignLifecycle } from "./once-campaign-lifecycle";

/**
 * A new batch starts only this long into a run. Every batch is persisted
 * before its provider request, so a run cut short mid-request loses nothing:
 * the redelivered message replays that batch under its key.
 */
const deliveryStartBudget = Duration.seconds(120);

/**
 * A run gives up this long after it starts, inside the queue consumer's
 * 300-second limit. Its slowest batch can outlast the remaining time: a
 * Dotypos read with every retry takes up to about 121 seconds, and a
 * provider request is made once and waits up to 10 seconds in production or
 * 30 seconds elsewhere.
 */
const deliveryRunDeadline = Duration.seconds(270);

/**
 * How long a run owns its send: the queue consumer's limit. A run that gives
 * up or fails releases the lease at once; one the platform stopped holds it
 * no longer than it could have run.
 */
const deliveryLeaseDuration = Duration.seconds(300);

/**
 * What delivering an attempt left the send as. `stale` is a message for an
 * attempt that is no longer current or a one-off campaign that is no longer
 * Sending.
 */
type CampaignDeliveryOutcome = "sent" | "failed" | "stale";

export interface ICampaignDeliveryService {
  /**
   * Delivers one attempt of a frozen one-off send in provider batches, then
   * marks its campaign Sent, or Failed when any recipient wasn't delivered.
   * One run at a time owns the send. Each recipient's email (and, for
   * marketing, consent) is re-read first; one who lost it, or who is
   * outside the email test domain outside production, is `skipped`. A batch
   * whose outcome is unknown is replayed with its identical payload under
   * its key while the key lasts, and its recipients become `unconfirmed`
   * once it can't be. An automated send is `stale` here: its deliver unit
   * submits and settles it.
   */
  readonly deliverAttempt: (
    attempt: CampaignDeliveryAttempt
  ) => Effect.Effect<
    CampaignDeliveryOutcome,
    CampaignDeliveryIncomplete | EffectDrizzleQueryError | SqlError.SqlError
  >;
}

/** The current attempt as one run that holds the send's lease delivers it. */
type AttemptContext = DeliveredAttempt & {
  readonly startedAt: Temporal.Instant;
  readonly leaseId: string;
};

/**
 * Delivers one-off campaign sends through the batch protocol, one run at a
 * time under the send's lease; the campaign send queue consumer runs it.
 */
export class CampaignDeliveryService extends Context.Service<
  CampaignDeliveryService,
  ICampaignDeliveryService
>()("@deskohub-workspace/email-campaigns/CampaignDeliveryService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;
      const batches = yield* CampaignBatchDelivery;

      /**
       * The campaign email of a one-off send's current attempt, while its
       * campaign is still Sending.
       */
      const findCurrentAttempt = (attempt: CampaignDeliveryAttempt) =>
        db
          .select({
            id: emailCampaigns.id,
            purpose: emailCampaigns.purpose,
            templateKey: emailCampaigns.templateKey,
            content: emailCampaigns.content,
          })
          .from(emailCampaignSends)
          .innerJoin(
            emailCampaigns,
            eq(emailCampaigns.id, emailCampaignSends.campaignId)
          )
          .where(
            and(
              currentAttemptSend(attempt),
              isNull(emailCampaignSends.automationVersionId),
              eq(emailCampaigns.status, "sending")
            )
          )
          .pipe(
            Effect.map(
              ([campaign]): Option.Option<DeliveredCampaign> =>
                Option.fromNullishOr(campaign)
            )
          );

      const currentAttemptSend = (attempt: CampaignDeliveryAttempt) =>
        and(
          eq(emailCampaignSends.id, attempt.sendId),
          eq(emailCampaignSends.deliveryAttempt, attempt.deliveryAttempt)
        );

      /**
       * Takes the send's lease for this run, unless another run holds an
       * unexpired one; then the message waits for its redelivery.
       */
      const acquireLease = (attempt: CampaignDeliveryAttempt) =>
        Effect.sync(() => crypto.randomUUID()).pipe(
          Effect.flatMap((leaseId) =>
            db
              .update(emailCampaignSends)
              .set({
                deliveryLeaseId: leaseId,
                deliveryLeaseExpiresAt: sql`now() + make_interval(secs => ${Duration.toSeconds(deliveryLeaseDuration)})`,
              })
              .where(
                and(
                  currentAttemptSend(attempt),
                  or(
                    isNull(emailCampaignSends.deliveryLeaseId),
                    lte(emailCampaignSends.deliveryLeaseExpiresAt, sql`now()`)
                  )
                )
              )
              .returning({ id: emailCampaignSends.id })
              .pipe(
                Effect.filterOrElse(
                  (leased) => leased.length > 0,
                  () =>
                    Effect.logInfo(
                      "Campaign delivery deferred: another run owns the send"
                    ).pipe(Effect.andThen(incomplete(attempt)))
                ),
                Effect.as(leaseId)
              )
          )
        );

      const releaseLease = (
        context: CampaignDeliveryAttempt & { readonly leaseId: string }
      ) =>
        db
          .update(emailCampaignSends)
          .set({ deliveryLeaseId: null, deliveryLeaseExpiresAt: null })
          .where(
            and(
              eq(emailCampaignSends.id, context.sendId),
              eq(emailCampaignSends.deliveryLeaseId, context.leaseId)
            )
          )
          .pipe(Effect.ignore);

      /**
       * Runs `write` in a transaction only while this run still holds the
       * send's lease. The send row stays locked until it commits, so the
       * lease can't pass to another run halfway; a run that lost it writes
       * nothing and ends.
       */
      const leasedTransaction = <A, E, R>(
        context: AttemptContext,
        write: Effect.Effect<A, E, R>
      ): Effect.Effect<
        A,
        | E
        | CampaignDeliveryIncomplete
        | EffectDrizzleQueryError
        | SqlError.SqlError,
        Exclude<R, WorkspaceTransaction>
      > =>
        transaction(
          db
            .select({ id: emailCampaignSends.id })
            .from(emailCampaignSends)
            .where(
              and(
                currentAttemptSend(context),
                eq(emailCampaignSends.deliveryLeaseId, context.leaseId),
                gt(emailCampaignSends.deliveryLeaseExpiresAt, sql`now()`)
              )
            )
            .for("update")
            .pipe(
              Effect.filterOrElse(
                (held) => held.length > 0,
                () =>
                  Effect.logWarning(
                    "Campaign delivery stopped: the run lost the send's lease"
                  ).pipe(Effect.andThen(incomplete(context)))
              ),
              Effect.andThen(write)
            )
        );

      const inAttempt = (attempt: CampaignDeliveryAttempt) =>
        and(
          eq(emailCampaignRecipients.sendId, attempt.sendId),
          eq(emailCampaignRecipients.deliveryAttempt, attempt.deliveryAttempt)
        );

      /** No batch of the attempt carries the recipient yet. */
      const unbatched = notExists(
        db
          .select({ batchIndex: emailCampaignDeliveryBatches.batchIndex })
          .from(emailCampaignDeliveryBatches)
          .where(
            and(
              eq(
                emailCampaignDeliveryBatches.sendId,
                emailCampaignRecipients.sendId
              ),
              eq(
                emailCampaignDeliveryBatches.deliveryAttempt,
                emailCampaignRecipients.deliveryAttempt
              ),
              sql`${emailCampaignRecipients.dotyposCustomerId} = any(${emailCampaignDeliveryBatches.dotyposCustomerIds})`
            )
          )
      );

      /** The next pending recipients no batch carries, in customer ID order. */
      const nextUnbatchedRecipients = (attempt: CampaignDeliveryAttempt) =>
        db
          .select({
            dotyposCustomerId: emailCampaignRecipients.dotyposCustomerId,
            locale: emailCampaignRecipients.locale,
          })
          .from(emailCampaignRecipients)
          .where(
            and(
              inAttempt(attempt),
              eq(emailCampaignRecipients.status, "pending"),
              unbatched
            )
          )
          .orderBy(asc(emailCampaignRecipients.dotyposCustomerId))
          .limit(campaignDeliveryBatchSize);

      const countUnbatchedPending = (input: {
        readonly context: AttemptContext;
        readonly customerIds: readonly DotyposCustomerId[];
      }) =>
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(emailCampaignRecipients)
          .where(
            and(
              inAttempt(input.context),
              inArray(emailCampaignRecipients.dotyposCustomerId, [
                ...input.customerIds,
              ]),
              eq(emailCampaignRecipients.status, "pending"),
              unbatched
            )
          )
          .pipe(Effect.map(([row]) => row?.count ?? 0));

      /** Settles a batch's outcome together with its recipients. */
      const settleBatch = (input: {
        readonly context: AttemptContext;
        readonly batch: PersistedBatch;
        readonly outcome: BatchOutcome;
      }) =>
        currentInstant.pipe(
          Effect.flatMap((at) =>
            leasedTransaction(input.context, batches.settle({ ...input, at }))
          ),
          Effect.withSpan("CampaignDeliveryService.settleBatch")
        );

      /** Ends the run once it's too far in to start another batch. */
      const ensureStartBudget = (context: AttemptContext) =>
        currentInstant.pipe(
          Effect.filterOrElse(
            (now) =>
              now.epochMilliseconds - context.startedAt.epochMilliseconds <=
              Duration.toMillis(deliveryStartBudget),
            () => incomplete(context)
          ),
          Effect.asVoid
        );

      /**
       * Replays a batch whose outcome is unknown, while the run is within
       * its start budget, and settles what the replay settled as.
       */
      const replayRequestedBatch = (input: {
        readonly context: AttemptContext;
        readonly batch: PersistedBatch;
      }) =>
        batches
          .request(
            BatchRequest.Replay({
              send: input.context,
              batch: input.batch,
              admit: ensureStartBudget(input.context),
            })
          )
          .pipe(
            Effect.flatMap((outcome) => settleBatch({ ...input, outcome })),
            Effect.withSpan("CampaignDeliveryService.replayRequestedBatch")
          );

      const replayRequestedBatches = (context: AttemptContext) =>
        batches
          .listRequested(context)
          .pipe(
            Effect.flatMap((requested) =>
              Effect.forEach(
                requested,
                (batch) => replayRequestedBatch({ context, batch }),
                { discard: true }
              )
            )
          );

      /**
       * Persists the next batch in the run's leased transaction, after
       * re-checking that its recipients are still pending and unbatched.
       */
      const persistBatch = (input: {
        readonly context: AttemptContext;
        readonly recipients: readonly BatchRecipient[];
        readonly prepared: PreparedBatch;
      }) =>
        currentInstant.pipe(
          Effect.flatMap((at) =>
            leasedTransaction(
              input.context,
              countUnbatchedPending({
                context: input.context,
                customerIds: input.recipients.map(
                  ({ dotyposCustomerId }) => dotyposCustomerId
                ),
              }).pipe(
                Effect.filterOrElse(
                  (count) => count === input.recipients.length,
                  () => incomplete(input.context)
                ),
                Effect.andThen(
                  batches.persist({ prepared: input.prepared, at })
                )
              )
            )
          ),
          Effect.withSpan("CampaignDeliveryService.persistBatch")
        );

      /**
       * Fails every recipient of a batch the run couldn't prepare (Dotypos
       * or the rendering failed past their retries), those it would skip
       * too: nothing was requested, and the admin's retry re-checks them.
       */
      const failUnprepared = (
        input: {
          readonly context: AttemptContext;
          readonly recipients: readonly BatchRecipient[];
        },
        cause: { readonly _tag: string }
      ) =>
        Effect.logError("Campaign delivery batch could not be prepared", {
          errorType: cause._tag,
        }).pipe(
          Effect.andThen(currentInstant),
          Effect.flatMap((at) =>
            leasedTransaction(
              input.context,
              batches.failUnrequested({
                sendId: input.context.sendId,
                customerIds: input.recipients.map(
                  ({ dotyposCustomerId }) => dotyposCustomerId
                ),
                at,
              })
            )
          ),
          Effect.as(Option.none<BatchRequest>())
        );

      /**
       * Prepares the next batch from the recipients no batch carries yet
       * and persists it before its first request, which sends the messages
       * it rendered.
       */
      const prepareNextBatch = (input: {
        readonly context: AttemptContext;
        readonly recipients: readonly BatchRecipient[];
      }) =>
        batches
          .prepare({
            send: input.context,
            recipients: input.recipients,
            profiles: Option.none(),
          })
          .pipe(
            Effect.flatMap(
              PreparedBatch.$match({
                Rendered: (prepared) =>
                  persistBatch({ ...input, prepared }).pipe(
                    Effect.map(
                      Option.map(
                        (batch): BatchRequest =>
                          BatchRequest.First({
                            batch,
                            messages: prepared.messages,
                          })
                      )
                    )
                  ),
                Unrendered: ({ cause }) => failUnprepared(input, cause),
              })
            ),
            Effect.catchTags({
              DotyposUnavailable: (cause) => failUnprepared(input, cause),
              DotyposRejected: (cause) => failUnprepared(input, cause),
            }),
            Effect.withSpan("CampaignDeliveryService.prepareNextBatch")
          );

      /** Batches and sends the given recipients no batch carries yet. */
      const deliverBatch = (input: {
        readonly context: AttemptContext;
        readonly recipients: readonly BatchRecipient[];
      }) =>
        ensureStartBudget(input.context).pipe(
          Effect.andThen(prepareNextBatch(input)),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.void,
              onSome: (request) =>
                batches.request(request).pipe(
                  Effect.flatMap((outcome) =>
                    settleBatch({
                      context: input.context,
                      batch: request.batch,
                      outcome,
                    })
                  )
                ),
            })
          )
        );

      /**
       * Batches and sends the recipients no batch carries yet, one batch at
       * a time until none is left.
       */
      const deliverUnbatched = (context: AttemptContext) =>
        nextUnbatchedRecipients(context).pipe(
          Effect.flatMap((recipients) =>
            deliverBatch({ context, recipients }).pipe(
              Effect.when(Effect.succeed(recipients.length > 0))
            )
          ),
          Effect.map(Option.isSome),
          Effect.repeat({ while: (delivered) => delivered })
        );

      /**
       * Settles the send: its campaign becomes Sent, or Failed when anyone
       * wasn't delivered.
       */
      const settle = (context: AttemptContext) =>
        currentInstant.pipe(
          Effect.flatMap((now) =>
            leasedTransaction(
              context,
              OnceCampaignLifecycle.settle({
                campaignId: context.campaign.id,
                sendId: context.sendId,
                deliveryAttempt: context.deliveryAttempt,
                now,
              })
            )
          ),
          Effect.withSpan("CampaignDeliveryService.settle")
        );

      const deliverCurrentAttempt = (context: AttemptContext) =>
        replayRequestedBatches(context).pipe(
          Effect.andThen(deliverUnbatched(context)),
          Effect.andThen(settle(context))
        );

      /**
       * Delivers the attempt under the send's lease, released however the
       * run ends.
       */
      const deliverLeased = (
        input: CampaignDeliveryAttempt & {
          readonly campaign: DeliveredCampaign;
          readonly startedAt: Temporal.Instant;
        }
      ) =>
        Effect.acquireUseRelease(
          acquireLease(input),
          (leaseId) => deliverCurrentAttempt({ ...input, leaseId }),
          (leaseId) => releaseLease({ ...input, leaseId })
        );

      return {
        deliverAttempt: (attempt) =>
          Effect.Do.pipe(
            Effect.bind("startedAt", () => currentInstant),
            Effect.bind("campaign", () => findCurrentAttempt(attempt)),
            Effect.flatMap(({ startedAt, campaign }) =>
              Option.match(campaign, {
                onNone: () =>
                  Effect.logInfo(
                    "Campaign delivery skipped: the attempt is no longer current"
                  ).pipe(Effect.as("stale" as const)),
                onSome: (current) =>
                  deliverLeased({ ...attempt, campaign: current, startedAt }),
              })
            ),
            Effect.timeoutOrElse({
              duration: deliveryRunDeadline,
              orElse: () => incomplete(attempt),
            }),
            Effect.annotateLogs({
              sendId: attempt.sendId,
              deliveryAttempt: attempt.deliveryAttempt,
            }),
            Effect.withSpan("CampaignDeliveryService.deliverAttempt")
          ),
      } satisfies ICampaignDeliveryService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(CampaignBatchDelivery.Live, WorkspaceDatabase.Default)
    )
  );
}

const incomplete = (attempt: CampaignDeliveryAttempt) =>
  Effect.fail(
    new CampaignDeliveryIncomplete({
      sendId: attempt.sendId,
      deliveryAttempt: attempt.deliveryAttempt,
    })
  );
