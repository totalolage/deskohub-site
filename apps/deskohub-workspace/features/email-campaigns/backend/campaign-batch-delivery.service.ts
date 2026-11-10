import "server-only";

import {
  type DotyposCustomer,
  type DotyposCustomerId,
  type DotyposReadFailure,
  DotyposService,
} from "@deskohub/dotypos";
import { type EmailMessage, EmailServiceTag } from "@deskohub/email";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  Array as Arr,
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Match,
  Option,
  Result,
} from "effect";
import {
  WorkspaceDatabase,
  type WorkspaceTransaction,
} from "@/db/database.service";
import {
  emailCampaignDeliveryBatches,
  emailCampaignRecipients,
} from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import type { Locale } from "@/features/i18n";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { WorkspaceEmailLayer } from "@/shared/backend/config/email.config";
import { currentInstant } from "@/shared/utils/temporal";
import type {
  CampaignLocalizedContent,
  CampaignPurpose,
  CampaignTemplateKey,
} from "../body/campaign-content";
import {
  campaignDeliveryBatchIdempotencyKey,
  campaignDeliveryBatchReplayWindow,
  campaignDeliveryPayloadHash,
} from "../campaign-delivery-batches";
import {
  CampaignDeliveryAudience,
  CampaignEmailOccasion,
  campaignEmailMessage,
} from "../campaign-email";
import type { CampaignId, CampaignSendId } from "../campaign-identifiers";
import {
  type CampaignRecipientSkipReason,
  undeliveredRecipientStatuses,
} from "../campaign-states";
import { campaignContentForRecipient } from "../recipient-locale";
import { CampaignEmailConfig } from "./campaign-email.config";
import {
  CampaignEligibilityStage,
  campaignEligibility,
  consentingCampaignCustomers,
} from "./campaign-reachability";
import type { CampaignDeliveryAttempt } from "./campaign-send-queue.service";
import { CampaignUnsubscribeService } from "./campaign-unsubscribe.service";

/**
 * The attempt has batches left or a batch whose outcome is unknown, or
 * another run owns the send. Failing the queue message redelivers it, and
 * the next run resumes the attempt; a deliver unit fails and is redelivered
 * the same way.
 */
export class CampaignDeliveryIncomplete extends Data.TaggedError(
  "CampaignDeliveryIncomplete"
)<{
  readonly sendId: CampaignSendId;
  readonly deliveryAttempt: number;
}> {}

/**
 * The campaign email an attempt mails: an automated send's version pinned
 * its purpose, template and content, while a one-off send mails its
 * campaign's.
 */
export type DeliveredCampaign = {
  readonly id: CampaignId;
  readonly purpose: CampaignPurpose;
  readonly templateKey: CampaignTemplateKey;
  readonly content: CampaignLocalizedContent;
};

/** An attempt with the campaign email it mails. */
export type DeliveredAttempt = CampaignDeliveryAttempt & {
  readonly campaign: DeliveredCampaign;
};

/** A frozen recipient a batch may carry. */
export type BatchRecipient = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
};

/** Dotypos profiles read for a batch's recipients. */
export type BatchProfiles = ReadonlyMap<DotyposCustomerId, DotyposCustomer>;

type ReachableRecipient = BatchRecipient & { readonly to: string };

type SkippedRecipient = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly reason: CampaignRecipientSkipReason;
};

/**
 * A batch persisted `requested` before any request: its key's identity, its
 * recipients in message order, the hash of its exact payload and its first
 * request's time.
 */
export type PersistedBatch = CampaignDeliveryAttempt & {
  readonly batchIndex: number;
  readonly dotyposCustomerIds: readonly DotyposCustomerId[];
  readonly payloadHash: string;
  readonly requestedAt: Temporal.Instant;
};

/**
 * A batch's recipients after the delivery recheck. `Rendered` holds the
 * message of every reachable recipient, in order. `Unrendered`: rendering
 * failed the same way it would every time, so nothing can be requested for
 * the reachable recipients.
 */
export type PreparedBatch = Data.TaggedEnum<{
  Rendered: {
    readonly send: DeliveredAttempt;
    readonly skipped: readonly SkippedRecipient[];
    readonly reachable: readonly ReachableRecipient[];
    readonly messages: readonly EmailMessage[];
  };
  Unrendered: {
    readonly send: DeliveredAttempt;
    readonly skipped: readonly SkippedRecipient[];
    readonly reachable: readonly ReachableRecipient[];
    readonly cause: { readonly _tag: string };
  };
}>;

export const PreparedBatch = Data.taggedEnum<PreparedBatch>();

/**
 * One request of a persisted batch under its key. `First`: its first
 * request, with the messages its persist rendered in this run. `Reproduced`:
 * its first request in a later step than its persist, from the profiles it
 * was persisted from. `Replay`: an earlier request's outcome is unknown, so
 * its recipients are re-read; `admit` runs once the batch is within its
 * replay window and before anything is re-read, the caller's last chance to
 * stop.
 */
export type BatchRequest = Data.TaggedEnum<{
  First: {
    readonly batch: PersistedBatch;
    readonly messages: readonly EmailMessage[];
  };
  Reproduced: {
    readonly send: DeliveredAttempt;
    readonly batch: PersistedBatch;
    readonly profiles: BatchProfiles;
  };
  Replay: {
    readonly send: DeliveredAttempt;
    readonly batch: PersistedBatch;
    readonly admit: Effect.Effect<void, CampaignDeliveryIncomplete>;
  };
}>;

export const BatchRequest = Data.taggedEnum<BatchRequest>();

/**
 * What a batch's request settled as. `Accepted`: the provider took it, with
 * its message IDs in order. `Refused`: the provider refused the request and
 * sent nothing; a refused first request means the batch was never mailed,
 * while a refused replay says nothing about the earlier request. An
 * `Unconfirmed` batch may have been mailed and is never resent: its key's
 * replay window passed or its payload can't be reproduced. An unknown
 * outcome isn't one of these: the request fails with
 * `CampaignDeliveryIncomplete` and the batch stays `requested`.
 */
export type BatchOutcome = Data.TaggedEnum<{
  Accepted: { readonly providerMessageIds: readonly string[] };
  Refused: { readonly request: "first" | "replay" };
  Unconfirmed: { readonly reason: "key-expired" | "payload-changed" };
}>;

export const BatchOutcome = Data.taggedEnum<BatchOutcome>();

/**
 * A batch whose outcome is unknown can't be replayed: its key's replay
 * window passed, or its payload can't be reproduced.
 */
class UnreplayableBatch extends Data.TaggedError("UnreplayableBatch")<{
  readonly reason: "key-expired" | "payload-changed";
}> {}

export interface ICampaignBatchDelivery {
  /**
   * Re-checks a batch's recipients for delivery and renders their
   * messages. Each recipient's email (and, for marketing, consent) must
   * still hold, and outside production the address must be in the email
   * test domain; anyone who fails is skipped and never reaches the
   * provider. Without `profiles` it reads them from Dotypos. Consent is
   * read on the Workspace database, so inside a transaction it sees that
   * transaction's writes.
   */
  readonly prepare: (input: {
    readonly send: DeliveredAttempt;
    readonly recipients: readonly BatchRecipient[];
    readonly profiles: Option.Option<BatchProfiles>;
  }) => Effect.Effect<PreparedBatch, DotyposReadFailure | DatabaseQueryError>;
  /**
   * In the caller's transaction, before any request: marks the skipped
   * recipients and persists the reachable ones as the attempt's next
   * batch, `requested`, with the hash of its exact payload. An
   * `Unrendered` batch fails its reachable recipients instead, since
   * nothing was requested. None when no batch was persisted.
   */
  readonly persist: (input: {
    readonly prepared: PreparedBatch;
    readonly at: Temporal.Instant;
  }) => Effect.Effect<
    Option.Option<PersistedBatch>,
    DatabaseQueryError,
    WorkspaceTransaction
  >;
  /**
   * In the caller's transaction: fails the given recipients still
   * `pending`. Nothing was requested for them, so a retry can't mail them
   * twice.
   */
  readonly failUnrequested: (input: {
    readonly sendId: CampaignSendId;
    readonly customerIds: readonly DotyposCustomerId[];
    readonly at: Temporal.Instant;
  }) => Effect.Effect<void, DatabaseQueryError, WorkspaceTransaction>;
  /** The attempt's batches whose outcome is unknown, in request order. */
  readonly listRequested: (
    attempt: CampaignDeliveryAttempt
  ) => Effect.Effect<readonly PersistedBatch[], DatabaseQueryError>;
  /**
   * Requests a persisted batch under its key with exactly one provider
   * request, never retried here. A reproduced or replayed payload must hash
   * as persisted and the key must be within its replay window; otherwise
   * nothing is requested and the batch is `Unconfirmed`. An unknown outcome,
   * or a Dotypos re-read that failed, fails with
   * `CampaignDeliveryIncomplete` and leaves the batch for a replay; so does
   * a failed database read, with its own error.
   */
  readonly request: (
    request: BatchRequest
  ) => Effect.Effect<
    BatchOutcome,
    CampaignDeliveryIncomplete | DatabaseQueryError
  >;
  /**
   * In the caller's transaction: records a batch's outcome on the batch and
   * moves its recipients to what the outcome means.
   */
  readonly settle: (input: {
    readonly batch: PersistedBatch;
    readonly outcome: BatchOutcome;
    readonly at: Temporal.Instant;
  }) => Effect.Effect<void, DatabaseQueryError, WorkspaceTransaction>;
}

/**
 * The batch protocol of campaign delivery: persist a batch before its
 * request, request it under its key, replay it while its outcome is
 * unknown, and settle its outcome. The one-off lease driver and the
 * automation deliver unit both call it.
 */
export class CampaignBatchDelivery extends Context.Service<
  CampaignBatchDelivery,
  ICampaignBatchDelivery
>()("@deskohub-workspace/email-campaigns/CampaignBatchDelivery") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const dotypos = yield* DotyposService;
      const email = yield* EmailServiceTag;
      const config = yield* CampaignEmailConfig;
      const unsubscribe = yield* CampaignUnsubscribeService;

      const prepare: ICampaignBatchDelivery["prepare"] = Effect.fn(
        "CampaignBatchDelivery.prepare"
      )(function* (input) {
        const classified = yield* Option.match(input.profiles, {
          onNone: () => hydrate(input),
          onSome: (profiles) =>
            loadConsenting({
              campaign: input.send.campaign,
              customerIds: input.recipients.map(
                ({ dotyposCustomerId }) => dotyposCustomerId
              ),
            }).pipe(
              Effect.map((consenting) =>
                classifyRecipients({
                  recipients: input.recipients,
                  profiles,
                  consenting,
                })
              )
            ),
        });
        const [skipped, reachable] = Arr.separate(classified);
        return yield* renderMessages({
          send: input.send,
          recipients: reachable,
        }).pipe(
          Effect.map((messages) =>
            PreparedBatch.Rendered({
              send: input.send,
              skipped,
              reachable,
              messages,
            })
          ),
          Effect.catchTags({
            EmailServiceError: (cause) =>
              unrendered({ send: input.send, skipped, reachable, cause }),
            WorkspaceUrlConfigError: (cause) =>
              unrendered({ send: input.send, skipped, reachable, cause }),
          })
        );
      });

      const loadConsenting = (input: {
        readonly campaign: DeliveredCampaign;
        readonly customerIds: readonly DotyposCustomerId[];
      }) =>
        consentingCampaignCustomers({
          db,
          purpose: input.campaign.purpose,
          customerIds: input.customerIds,
        });

      /**
       * Re-reads each recipient's email and, for marketing, consent, then
       * classifies them. Nothing reaches the provider without passing here.
       */
      const hydrate = (input: {
        readonly send: DeliveredAttempt;
        readonly recipients: readonly BatchRecipient[];
      }) =>
        Effect.Do.pipe(
          Effect.let("customerIds", () =>
            input.recipients.map(({ dotyposCustomerId }) => dotyposCustomerId)
          ),
          Effect.bind("profiles", ({ customerIds }) =>
            dotypos.getCustomersByIds(customerIds)
          ),
          Effect.bind("consenting", ({ customerIds }) =>
            loadConsenting({ campaign: input.send.campaign, customerIds })
          ),
          Effect.map(({ profiles, consenting }) =>
            classifyRecipients({
              recipients: input.recipients,
              profiles,
              consenting,
            })
          ),
          Effect.withSpan("CampaignBatchDelivery.hydrate")
        );

      /** The address to mail the recipient at, or why they're skipped. */
      const classifyRecipient = (input: {
        readonly recipient: BatchRecipient;
        readonly profiles: BatchProfiles;
        readonly consenting: ReadonlySet<DotyposCustomerId>;
      }): Result.Result<ReachableRecipient, SkippedRecipient> => {
        const { recipient } = input;
        const skip = (reason: CampaignRecipientSkipReason) => ({
          dotyposCustomerId: recipient.dotyposCustomerId,
          reason,
        });
        return campaignEligibility({
          profile: Option.fromNullishOr(
            input.profiles.get(recipient.dotyposCustomerId)
          ),
          stage: CampaignEligibilityStage.Delivery({
            consenting: input.consenting.has(recipient.dotyposCustomerId),
            deploymentEnvironment: config.deploymentEnvironment,
          }),
        }).pipe(
          Result.map((to) => ({ ...recipient, to })),
          Result.mapError(skip)
        );
      };

      const classifyRecipients = (input: {
        readonly recipients: readonly BatchRecipient[];
        readonly profiles: BatchProfiles;
        readonly consenting: ReadonlySet<DotyposCustomerId>;
      }) =>
        input.recipients.map((recipient) =>
          classifyRecipient({ ...input, recipient })
        );

      const renderMessage = (input: {
        readonly send: DeliveredAttempt;
        readonly recipient: ReachableRecipient;
      }) =>
        Effect.succeed(input).pipe(
          Effect.let("recipientTags", ({ send, recipient }) => ({
            sendId: send.sendId,
            dotyposCustomerId: recipient.dotyposCustomerId,
          })),
          Effect.bind("audience", ({ send, recipientTags }) =>
            Match.value(send.campaign.purpose).pipe(
              Match.when("marketing", () =>
                unsubscribe
                  .unsubscribeUrl(recipientTags)
                  .pipe(
                    Effect.map((unsubscribeUrl) =>
                      CampaignDeliveryAudience.Marketing({ unsubscribeUrl })
                    )
                  )
              ),
              Match.when("operational", () =>
                Effect.succeed(CampaignDeliveryAudience.Operational())
              ),
              Match.exhaustive
            )
          ),
          Effect.let("localized", ({ send, recipient }) =>
            campaignContentForRecipient(send.campaign.content, recipient.locale)
          ),
          Effect.flatMap(
            ({ send, recipient, recipientTags, audience, localized }) =>
              campaignEmailMessage({
                templateKey: send.campaign.templateKey,
                locale: localized.locale,
                content: localized.content,
                occasion: CampaignEmailOccasion.Delivery({
                  to: recipient.to,
                  recipient: recipientTags,
                  audience,
                }),
                sender: config,
                deploymentEnvironment: config.deploymentEnvironment,
              })
          ),
          Effect.withSpan("CampaignBatchDelivery.renderMessage")
        );

      const renderMessages = (input: {
        readonly send: DeliveredAttempt;
        readonly recipients: readonly ReachableRecipient[];
      }) =>
        Effect.forEach(input.recipients, (recipient) =>
          renderMessage({ send: input.send, recipient })
        );

      const persist: ICampaignBatchDelivery["persist"] = Effect.fn(
        "CampaignBatchDelivery.persist"
      )(function* ({ prepared, at }) {
        yield* markSkipped({
          sendId: prepared.send.sendId,
          skipped: prepared.skipped,
          at,
        });
        return yield* PreparedBatch.$match(prepared, {
          Rendered: ({ send, reachable, messages }) =>
            insertBatch({
              attempt: send,
              reachable,
              payloadHash: campaignDeliveryPayloadHash(messages),
              at,
            }).pipe(Effect.when(Effect.succeed(reachable.length > 0))),
          Unrendered: ({ send, reachable }) =>
            settlePendingRecipients({
              sendId: send.sendId,
              customerIds: reachable.map(
                ({ dotyposCustomerId }) => dotyposCustomerId
              ),
              status: "failed",
              at,
            }).pipe(Effect.as(Option.none<PersistedBatch>())),
        });
      });

      const markSkipped = (input: {
        readonly sendId: CampaignSendId;
        readonly skipped: readonly SkippedRecipient[];
        readonly at: Temporal.Instant;
      }) =>
        Effect.forEach(input.skipped, ({ dotyposCustomerId, reason }) =>
          db
            .update(emailCampaignRecipients)
            .set({
              status: "skipped",
              skipReason: reason,
              statusUpdatedAt: input.at,
            })
            .where(
              and(
                eq(emailCampaignRecipients.sendId, input.sendId),
                eq(
                  emailCampaignRecipients.dotyposCustomerId,
                  dotyposCustomerId
                ),
                eq(emailCampaignRecipients.status, "pending")
              )
            )
        );

      const nextBatchIndex = (attempt: CampaignDeliveryAttempt) =>
        db
          .select({
            batchIndex: sql<number>`coalesce(max(${emailCampaignDeliveryBatches.batchIndex}), -1)::int`,
          })
          .from(emailCampaignDeliveryBatches)
          .where(
            and(
              eq(emailCampaignDeliveryBatches.sendId, attempt.sendId),
              eq(
                emailCampaignDeliveryBatches.deliveryAttempt,
                attempt.deliveryAttempt
              )
            )
          )
          .pipe(Effect.map(([last]) => (last?.batchIndex ?? -1) + 1));

      const insertBatch = (input: {
        readonly attempt: CampaignDeliveryAttempt;
        readonly reachable: readonly ReachableRecipient[];
        readonly payloadHash: string;
        readonly at: Temporal.Instant;
      }) =>
        nextBatchIndex(input.attempt).pipe(
          Effect.map(
            (batchIndex): PersistedBatch => ({
              sendId: input.attempt.sendId,
              deliveryAttempt: input.attempt.deliveryAttempt,
              batchIndex,
              dotyposCustomerIds: input.reachable.map(
                ({ dotyposCustomerId }) => dotyposCustomerId
              ),
              payloadHash: input.payloadHash,
              requestedAt: input.at,
            })
          ),
          Effect.tap((batch) =>
            db.insert(emailCampaignDeliveryBatches).values({
              sendId: batch.sendId,
              deliveryAttempt: batch.deliveryAttempt,
              batchIndex: batch.batchIndex,
              dotyposCustomerIds: [...batch.dotyposCustomerIds],
              payloadHash: batch.payloadHash,
              requestedAt: batch.requestedAt,
            })
          )
        );

      /** Moves the given recipients that are still `pending` to `status`. */
      const settlePendingRecipients = (input: {
        readonly sendId: CampaignSendId;
        readonly customerIds: readonly DotyposCustomerId[];
        readonly status: "failed" | "unconfirmed";
        readonly at: Temporal.Instant;
      }) =>
        db
          .update(emailCampaignRecipients)
          .set({ status: input.status, statusUpdatedAt: input.at })
          .where(
            and(
              eq(emailCampaignRecipients.sendId, input.sendId),
              inArray(emailCampaignRecipients.dotyposCustomerId, [
                ...input.customerIds,
              ]),
              eq(emailCampaignRecipients.status, "pending")
            )
          );

      const failUnrequested: ICampaignBatchDelivery["failUnrequested"] =
        Effect.fn("CampaignBatchDelivery.failUnrequested")(function* (input) {
          yield* settlePendingRecipients({ ...input, status: "failed" });
        });

      const listRequested: ICampaignBatchDelivery["listRequested"] = (
        attempt
      ) =>
        db
          .select({
            batchIndex: emailCampaignDeliveryBatches.batchIndex,
            dotyposCustomerIds: emailCampaignDeliveryBatches.dotyposCustomerIds,
            payloadHash: emailCampaignDeliveryBatches.payloadHash,
            requestedAt: emailCampaignDeliveryBatches.requestedAt,
          })
          .from(emailCampaignDeliveryBatches)
          .where(
            and(
              eq(emailCampaignDeliveryBatches.sendId, attempt.sendId),
              eq(
                emailCampaignDeliveryBatches.deliveryAttempt,
                attempt.deliveryAttempt
              ),
              eq(emailCampaignDeliveryBatches.status, "requested")
            )
          )
          .orderBy(asc(emailCampaignDeliveryBatches.batchIndex))
          .pipe(
            Effect.map((rows) =>
              rows.map(
                (row): PersistedBatch => ({
                  sendId: attempt.sendId,
                  deliveryAttempt: attempt.deliveryAttempt,
                  ...row,
                })
              )
            )
          );

      /** A persisted batch's recipients, in the batch's message order. */
      const loadBatchRecipients = (batch: PersistedBatch) =>
        db
          .select({
            dotyposCustomerId: emailCampaignRecipients.dotyposCustomerId,
            locale: emailCampaignRecipients.locale,
          })
          .from(emailCampaignRecipients)
          .where(
            and(
              eq(emailCampaignRecipients.sendId, batch.sendId),
              inArray(emailCampaignRecipients.dotyposCustomerId, [
                ...batch.dotyposCustomerIds,
              ])
            )
          )
          .pipe(
            Effect.map((rows) => {
              const byId = new Map(
                rows.map((row) => [row.dotyposCustomerId, row])
              );
              return batch.dotyposCustomerIds.flatMap((id) => {
                const row = byId.get(id);
                return row ? [row] : [];
              });
            })
          );

      const request: ICampaignBatchDelivery["request"] = Effect.fn(
        "CampaignBatchDelivery.request"
      )(function* (input) {
        return yield* BatchRequest.$match(input, {
          First: ({ batch, messages }) =>
            sendBatch({ batch, messages, request: "first" }),
          Reproduced: (reproduced) =>
            requestReproduced({
              ...reproduced,
              profiles: Option.some(reproduced.profiles),
              admit: Effect.void,
            }),
          Replay: (replay) =>
            requestReproduced({ ...replay, profiles: Option.none() }),
        });
      });

      /**
       * Requests a persisted batch with its reproduced payload, within its
       * key's replay window. Without the profiles it was persisted from, the
       * request is a replay. A batch that can't be requested again is
       * `Unconfirmed`.
       */
      const requestReproduced = (input: {
        readonly send: DeliveredAttempt;
        readonly batch: PersistedBatch;
        readonly profiles: Option.Option<BatchProfiles>;
        readonly admit: Effect.Effect<void, CampaignDeliveryIncomplete>;
      }) =>
        ensureReplayWindow(input.batch).pipe(
          Effect.andThen(input.admit),
          Effect.andThen(reproducePayload(input)),
          Effect.flatMap((messages) =>
            sendBatch({
              batch: input.batch,
              messages,
              request: Option.isNone(input.profiles) ? "replay" : "first",
            })
          ),
          Effect.catchTag("UnreplayableBatch", ({ reason }) =>
            Effect.logWarning("Campaign delivery batch unconfirmed", {
              batchIndex: input.batch.batchIndex,
              reason,
            }).pipe(Effect.as(BatchOutcome.Unconfirmed({ reason })))
          )
        );

      const ensureReplayWindow = (batch: PersistedBatch) =>
        currentInstant.pipe(
          Effect.filterOrFail(
            (now) =>
              now.epochMilliseconds - batch.requestedAt.epochMilliseconds <=
              Duration.toMillis(campaignDeliveryBatchReplayWindow),
            () => new UnreplayableBatch({ reason: "key-expired" })
          ),
          Effect.asVoid
        );

      /**
       * Re-renders a requested batch for its request. Its payload must hash
       * the same: every recipient still reachable at the same address, and
       * the same rendering.
       */
      const reproducePayload = (input: {
        readonly send: DeliveredAttempt;
        readonly batch: PersistedBatch;
        /** The batch was persisted from these profiles. */
        readonly profiles: Option.Option<BatchProfiles>;
      }) =>
        loadBatchRecipients(input.batch).pipe(
          Effect.filterOrFail(
            (recipients) =>
              recipients.length === input.batch.dotyposCustomerIds.length,
            payloadChanged
          ),
          Effect.flatMap((recipients) =>
            Option.match(input.profiles, {
              onNone: () => hydrate({ send: input.send, recipients }),
              // They passed the recheck when the batch was persisted.
              onSome: (profiles) =>
                Effect.succeed(
                  classifyRecipients({
                    recipients,
                    profiles,
                    consenting: new Set(input.batch.dotyposCustomerIds),
                  })
                ),
            })
          ),
          Effect.flatMap((hydrated) =>
            Effect.fromResult(Result.all(hydrated)).pipe(
              Effect.mapError(payloadChanged)
            )
          ),
          Effect.flatMap((recipients) =>
            renderMessages({ send: input.send, recipients })
          ),
          Effect.filterOrFail(
            (messages) =>
              campaignDeliveryPayloadHash(messages) === input.batch.payloadHash,
            payloadChanged
          ),
          // Rendering fails the same way every time, so the payload can't
          // be reproduced.
          Effect.catchTag("EmailServiceError", () =>
            Effect.fail(payloadChanged())
          ),
          // The batch may have been delivered, so it waits for a replay.
          Effect.catchTags({
            DotyposUnavailable: () => incomplete(input.batch),
            DotyposRejected: () => incomplete(input.batch),
            WorkspaceUrlConfigError: () => incomplete(input.batch),
          })
        );

      /**
       * Sends a persisted batch under its key, once. An unknown outcome
       * fails, leaving the batch `requested` for a replay.
       */
      const sendBatch = (input: {
        readonly batch: PersistedBatch;
        readonly messages: readonly EmailMessage[];
        readonly request: "first" | "replay";
      }) =>
        email
          .sendBatch(input.messages, {
            idempotencyKey: campaignDeliveryBatchIdempotencyKey(input.batch),
          })
          .pipe(
            Effect.map((results) =>
              BatchOutcome.Accepted({
                providerMessageIds: results.map(({ id }) => id),
              })
            ),
            Effect.catchTags({
              EmailServiceError: () =>
                Effect.logError("Campaign delivery batch refused", {
                  replay: input.request === "replay",
                }).pipe(
                  Effect.as(BatchOutcome.Refused({ request: input.request }))
                ),
              NetworkError: () =>
                Effect.logWarning(
                  "Campaign delivery batch outcome unknown; it will be replayed"
                ).pipe(Effect.andThen(incomplete(input.batch))),
            }),
            Effect.annotateLogs({
              batchIndex: input.batch.batchIndex,
              batchSize: input.batch.dotyposCustomerIds.length,
            })
          );

      const settle: ICampaignBatchDelivery["settle"] = Effect.fn(
        "CampaignBatchDelivery.settle"
      )(function* (input) {
        yield* recordBatchStatus(input);
        yield* recordRecipientsOutcome(input);
      });

      const recordBatchStatus = (input: {
        readonly batch: PersistedBatch;
        readonly outcome: BatchOutcome;
        readonly at: Temporal.Instant;
      }) =>
        db
          .update(emailCampaignDeliveryBatches)
          .set({ status: batchStatusOf(input.outcome), settledAt: input.at })
          .where(
            and(
              eq(emailCampaignDeliveryBatches.sendId, input.batch.sendId),
              eq(
                emailCampaignDeliveryBatches.deliveryAttempt,
                input.batch.deliveryAttempt
              ),
              eq(
                emailCampaignDeliveryBatches.batchIndex,
                input.batch.batchIndex
              )
            )
          );

      /** Moves a settled batch's recipients to what its outcome means. */
      const recordRecipientsOutcome = (input: {
        readonly batch: PersistedBatch;
        readonly outcome: BatchOutcome;
        readonly at: Temporal.Instant;
      }): Effect.Effect<void, DatabaseQueryError> =>
        BatchOutcome.$match(input.outcome, {
          Accepted: ({ providerMessageIds }) =>
            markBatchSent({ ...input, providerMessageIds }).pipe(Effect.asVoid),
          Refused: ({ request: refused }) =>
            settleBatchRecipients({
              ...input,
              status: refused === "first" ? "failed" : "unconfirmed",
            }),
          Unconfirmed: () =>
            settleBatchRecipients({ ...input, status: "unconfirmed" }),
        });

      const settleBatchRecipients = (input: {
        readonly batch: PersistedBatch;
        readonly status: "failed" | "unconfirmed";
        readonly at: Temporal.Instant;
      }) =>
        settlePendingRecipients({
          sendId: input.batch.sendId,
          customerIds: input.batch.dotyposCustomerIds,
          status: input.status,
          at: input.at,
        }).pipe(Effect.asVoid);

      /**
       * Records the provider's message IDs. An accepted batch wins over any
       * failure recorded for its recipients; a webhook that arrived first
       * may already have moved one past `sent`, and that status stays.
       */
      const markBatchSent = (input: {
        readonly batch: PersistedBatch;
        readonly providerMessageIds: readonly string[];
        readonly at: Temporal.Instant;
      }) =>
        Effect.forEach(
          input.batch.dotyposCustomerIds,
          (dotyposCustomerId, index) =>
            db
              .update(emailCampaignRecipients)
              .set({
                providerMessageId: input.providerMessageIds[index]!,
                status: sql`case when ${inArray(emailCampaignRecipients.status, undeliveredRecipientStatuses)} then 'sent' else ${emailCampaignRecipients.status} end`,
                statusUpdatedAt: input.at,
              })
              .where(
                and(
                  eq(emailCampaignRecipients.sendId, input.batch.sendId),
                  eq(
                    emailCampaignRecipients.dotyposCustomerId,
                    dotyposCustomerId
                  )
                )
              )
        );

      return {
        prepare,
        persist,
        failUnrequested,
        listRequested,
        request,
        settle,
      } satisfies ICampaignBatchDelivery;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CampaignEmailConfig.Default,
        CampaignUnsubscribeService.Live,
        WorkspaceDotyposLayer,
        WorkspaceEmailLayer,
        WorkspaceDatabase.Default
      )
    )
  );
}

/** The batch status each outcome settles as. */
const batchStatusOf = (outcome: BatchOutcome) =>
  BatchOutcome.$match(outcome, {
    Accepted: () => "accepted" as const,
    Refused: ({ request }) =>
      request === "first" ? ("rejected" as const) : ("unconfirmed" as const),
    Unconfirmed: () => "unconfirmed" as const,
  });

const unrendered = (input: {
  readonly send: DeliveredAttempt;
  readonly skipped: readonly SkippedRecipient[];
  readonly reachable: readonly ReachableRecipient[];
  readonly cause: { readonly _tag: string };
}) => Effect.succeed(PreparedBatch.Unrendered(input));

const payloadChanged = () =>
  new UnreplayableBatch({ reason: "payload-changed" });

const incomplete = (attempt: CampaignDeliveryAttempt) =>
  Effect.fail(
    new CampaignDeliveryIncomplete({
      sendId: attempt.sendId,
      deliveryAttempt: attempt.deliveryAttempt,
    })
  );
