import "server-only";

import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposService,
} from "@deskohub/dotypos";
import { type EmailMessage, EmailServiceTag } from "@deskohub/email";
import { isTestEmailRecipient } from "@deskohub/email/backend/test-recipients";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
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
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  customerMarketingConsents,
  emailCampaignAutomationVersions,
  emailCampaignDeliveryBatches,
  emailCampaignRecipients,
  emailCampaignSends,
  emailCampaigns,
} from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import { type Locale, locales } from "@/features/i18n";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import { currentInstant } from "@/shared/utils/temporal";
import type { AutomationVersionId } from "../automation/automation-identifiers";
import { AutomationRunSettlement } from "../automation/backend/automation-run-settlement.service";
import type { AutomationEngineTransaction } from "../automation/backend/automation-unit-handler";
import type {
  CampaignLocaleContent,
  CampaignLocalizedContent,
  CampaignPurpose,
  CampaignTemplateKey,
} from "../body/campaign-content";
import {
  CampaignEmailFooter,
  renderCampaignEmail,
} from "../body/render-campaign-email";
import {
  campaignDeliveryBatchIdempotencyKey,
  campaignDeliveryBatchReplayWindow,
  campaignDeliveryBatchSize,
  campaignDeliveryPayloadHash,
} from "../campaign-delivery-batches";
import { campaignDeliveryMessage } from "../campaign-email-message";
import type { CampaignId, CampaignSendId } from "../campaign-identifiers";
import type { CampaignRecipientSkipReason } from "../campaign-states";
import { campaignFallbackLocale } from "../recipient-locale";
import { CampaignEmailConfig } from "./campaign-email.config";
import { reachableCampaignEmail } from "./campaign-recipient.service";
import type { CampaignDeliveryAttempt } from "./campaign-send-queue.service";
import { sendAutomationVersion } from "./campaign-send-selection";
import { CampaignUnsubscribeService } from "./campaign-unsubscribe.service";

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
 * The attempt has batches left or a batch whose outcome is unknown, or
 * another run owns the send. Failing the queue message redelivers it, and
 * the next run resumes the attempt.
 */
class CampaignDeliveryIncomplete extends Data.TaggedError(
  "CampaignDeliveryIncomplete"
)<{
  readonly sendId: CampaignSendId;
  readonly deliveryAttempt: number;
}> {}

/**
 * A batch whose outcome is unknown can't be replayed: its key's replay
 * window passed, or its payload can't be reproduced.
 */
class UnreplayableBatch extends Data.TaggedError("UnreplayableBatch")<{
  readonly reason: "key-expired" | "payload-changed";
}> {}

/**
 * What delivering an attempt left the send as. `stale` is a message for an
 * attempt that is no longer current or a one-off campaign that is no longer
 * Sending.
 */
type CampaignDeliveryOutcome = "sent" | "failed" | "stale";

export interface ICampaignDeliveryService {
  /**
   * Delivers one attempt of a frozen send in provider batches. A one-off
   * send then marks its campaign Sent, or Failed when any recipient wasn't
   * delivered; an automated send completes and settles its runs, leaving
   * its campaign's status to the automation's lifecycle. One run at a time
   * owns the send. Each recipient's email (and, for
   * marketing, consent) is re-read first; one who lost it, or who is
   * outside the email test domain outside production, is `skipped`. A batch
   * whose outcome is unknown is replayed with its identical payload under
   * its key while the key lasts, and its recipients become `unconfirmed`
   * once it can't be.
   */
  readonly deliverAttempt: (
    attempt: CampaignDeliveryAttempt
  ) => Effect.Effect<
    CampaignDeliveryOutcome,
    CampaignDeliveryIncomplete | EffectDrizzleQueryError | SqlError.SqlError
  >;
  /**
   * §5.9 step 2, in a deliver unit's commit transaction: creates the
   * automated send of the version, with the version's audience snapshot
   * and content hash. The unit's claim stands in for the send's lease.
   */
  readonly createAutomatedSend: (
    tx: AutomationEngineTransaction,
    input: {
      readonly campaignId: CampaignId;
      readonly versionId: AutomationVersionId;
      readonly at: Temporal.Instant;
    }
  ) => Effect.Effect<CampaignSendId, DatabaseQueryError>;
  /**
   * §5.9 step 2, after the runs moved to `sending`: freezes their
   * recipients and applies the delivery recheck to the profiles the unit
   * read (consent read in the transaction, email validity, and the
   * test-domain guard outside production), skipping whoever fails it. The
   * rest become batch 0, `requested`, before any request. Rendering that
   * fails fails them, as nothing was requested.
   */
  readonly persistAutomatedBatch: (
    tx: AutomationEngineTransaction,
    input: {
      readonly sendId: CampaignSendId;
      readonly recipients: readonly BatchRecipient[];
      readonly profiles: ReadonlyMap<DotyposCustomerId, DotyposCustomer>;
      readonly at: Temporal.Instant;
    }
  ) => Effect.Effect<void, DatabaseQueryError>;
  /**
   * §5.9 step 3: requests an automated send's persisted batch under its
   * key and returns the writes that settle it (step 4). With the profiles
   * the batch was persisted from, it's the first request; without them it
   * replays the batch as `deliverAttempt` does, re-reading its recipients,
   * and past the replay window its recipients become `unconfirmed`. The
   * settlement records the outcome, completes the send and ends its runs;
   * a send already completed settles nothing. An unknown outcome fails, so
   * the caller retries the replay.
   */
  readonly submitAutomatedSend: (input: {
    readonly sendId: CampaignSendId;
    readonly profiles: Option.Option<
      ReadonlyMap<DotyposCustomerId, DotyposCustomer>
    >;
  }) => Effect.Effect<
    AutomatedSendSettlement,
    CampaignDeliveryIncomplete | DatabaseQueryError
  >;
}

/**
 * Settles a submitted automated send in the caller's transaction: records
 * its batch outcome, completes the send and ends its runs.
 */
type AutomatedSendSettlement = (
  tx: AutomationEngineTransaction,
  at: Temporal.Instant
) => Effect.Effect<void, DatabaseQueryError>;

/** Automated sends are never retried, so they deliver their first attempt only. */
const automatedAttempt = (sendId: CampaignSendId): CampaignDeliveryAttempt => ({
  sendId,
  deliveryAttempt: 1,
});

/**
 * The campaign email an attempt mails: an automated send's version pinned
 * its purpose, template and content, while a one-off send mails its
 * campaign's.
 */
type DeliveredCampaign = {
  readonly id: CampaignId;
  /** Null for a one-off send. */
  readonly automationVersionId: AutomationVersionId | null;
  readonly purpose: CampaignPurpose;
  readonly templateKey: CampaignTemplateKey;
  readonly content: CampaignLocalizedContent;
};

/** An attempt with the campaign email it mails. */
type DeliveryContext = CampaignDeliveryAttempt & {
  readonly campaign: DeliveredCampaign;
};

/** The current attempt as one run that holds the send's lease delivers it. */
type AttemptContext = DeliveryContext & {
  readonly startedAt: Temporal.Instant;
  readonly leaseId: string;
};

type BatchRecipient = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
};

type ReachableRecipient = BatchRecipient & { readonly to: string };

type SkippedRecipient = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly reason: CampaignRecipientSkipReason;
};

/** A persisted batch: its key's identity and its recipients in order. */
type DeliveryBatch = CampaignDeliveryAttempt & {
  readonly batchIndex: number;
  readonly dotyposCustomerIds: readonly DotyposCustomerId[];
};

/** A batch persisted before any request, with the emails it requests. */
type PreparedBatch = {
  readonly batch: DeliveryBatch;
  readonly messages: readonly EmailMessage[];
};

type RequestedBatch = {
  readonly batchIndex: number;
  readonly dotyposCustomerIds: readonly DotyposCustomerId[];
  readonly payloadHash: string;
  readonly requestedAt: Temporal.Instant;
};

/**
 * What a batch's request settled as. `rejected` means the provider refused
 * it and sent nothing; `unconfirmed` that it may have delivered and is never
 * resent.
 */
type BatchOutcome =
  | { readonly status: "accepted"; readonly ids: readonly string[] }
  | { readonly status: "rejected" | "unconfirmed" };

const recipientStatusOf = {
  rejected: "failed",
  unconfirmed: "unconfirmed",
} as const;

/** Delivers frozen campaign sends; the campaign send queue consumer runs it. */
export class CampaignDeliveryService extends Context.Service<
  CampaignDeliveryService,
  ICampaignDeliveryService
>()("@deskohub-workspace/email-campaigns/CampaignDeliveryService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const dotypos = yield* DotyposService;
      const email = yield* EmailServiceTag;
      const config = yield* CampaignEmailConfig;
      const unsubscribe = yield* CampaignUnsubscribeService;
      const runSettlement = yield* AutomationRunSettlement;

      type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

      /**
       * The current attempt's campaign email. A one-off campaign must still
       * be Sending. An automated send must not be complete yet, and its
       * persisted batch settles whatever its campaign's status.
       */
      const findCurrentAttempt = (attempt: CampaignDeliveryAttempt) =>
        db
          .select({
            campaign: {
              id: emailCampaigns.id,
              purpose: emailCampaigns.purpose,
              templateKey: emailCampaigns.templateKey,
              content: emailCampaigns.content,
            },
            version: {
              id: emailCampaignAutomationVersions.id,
              purpose: emailCampaignAutomationVersions.purpose,
              templateKey: emailCampaignAutomationVersions.templateKey,
              content: emailCampaignAutomationVersions.content,
            },
          })
          .from(emailCampaignSends)
          .innerJoin(
            emailCampaigns,
            eq(emailCampaigns.id, emailCampaignSends.campaignId)
          )
          .leftJoin(emailCampaignAutomationVersions, sendAutomationVersion)
          .where(
            and(
              eq(emailCampaignSends.id, attempt.sendId),
              eq(emailCampaignSends.deliveryAttempt, attempt.deliveryAttempt),
              or(
                eq(emailCampaigns.status, "sending"),
                and(
                  isNotNull(emailCampaignSends.automationVersionId),
                  isNull(emailCampaignSends.completedAt)
                )
              )
            )
          )
          .pipe(
            Effect.map(([row]) =>
              Option.fromNullishOr(row).pipe(Option.map(deliveredCampaign))
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
        write: (tx: Transaction) => Effect.Effect<A, E, R>
      ): Effect.Effect<
        A,
        | E
        | CampaignDeliveryIncomplete
        | EffectDrizzleQueryError
        | SqlError.SqlError,
        R
      > =>
        db.transaction((tx) =>
          tx
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
              Effect.andThen(write(tx))
            )
        );

      const inAttempt = (attempt: CampaignDeliveryAttempt) =>
        and(
          eq(emailCampaignRecipients.sendId, attempt.sendId),
          eq(emailCampaignRecipients.deliveryAttempt, attempt.deliveryAttempt)
        );

      /** The attempt's batches with an unknown outcome, in request order. */
      const listRequestedBatches = (
        attempt: CampaignDeliveryAttempt
      ): Effect.Effect<readonly RequestedBatch[], EffectDrizzleQueryError> =>
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
          .orderBy(asc(emailCampaignDeliveryBatches.batchIndex));

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

      /** A persisted batch's recipients, in the batch's message order. */
      const loadBatchRecipients = (batch: DeliveryBatch) =>
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

      const loadActiveConsents = (
        customerIds: readonly DotyposCustomerId[],
        client: Pick<Transaction, "select"> = db
      ) =>
        client
          .select({
            dotyposCustomerId: customerMarketingConsents.dotyposCustomerId,
          })
          .from(customerMarketingConsents)
          .where(
            and(
              inArray(customerMarketingConsents.dotyposCustomerId, [
                ...customerIds,
              ]),
              isNull(customerMarketingConsents.withdrawnAt)
            )
          )
          .pipe(
            Effect.map(
              (rows) => new Set(rows.map((row) => row.dotyposCustomerId))
            )
          );

      /** The recipients who may receive the campaign's purpose of email. */
      const loadConsenting = (input: {
        readonly campaign: DeliveredCampaign;
        readonly customerIds: readonly DotyposCustomerId[];
        readonly client?: Pick<Transaction, "select">;
      }) =>
        Match.value(input.campaign.purpose).pipe(
          Match.when("marketing", () =>
            loadActiveConsents(input.customerIds, input.client)
          ),
          Match.orElse(() => Effect.succeed(new Set(input.customerIds)))
        );

      const loadProfiles = (customerIds: readonly DotyposCustomerId[]) =>
        dotypos
          .getCustomers({ ids: customerIds })
          .pipe(
            Effect.map(
              (profiles) =>
                new Map(
                  profiles.flatMap((profile: DotyposCustomer) =>
                    profile.id === undefined
                      ? []
                      : [[profile.id, profile] as const]
                  )
                )
            )
          );

      /** The address to mail the recipient at, or why they're skipped. */
      const classifyRecipient = (input: {
        readonly recipient: BatchRecipient;
        readonly profiles: ReadonlyMap<DotyposCustomerId, DotyposCustomer>;
        readonly consenting: ReadonlySet<DotyposCustomerId>;
      }): Result.Result<ReachableRecipient, SkippedRecipient> => {
        const { recipient } = input;
        const skip = (reason: CampaignRecipientSkipReason) => ({
          dotyposCustomerId: recipient.dotyposCustomerId,
          reason,
        });
        if (!input.consenting.has(recipient.dotyposCustomerId)) {
          return Result.fail(skip("consent-withdrawn"));
        }
        return reachableCampaignEmail(
          Option.fromNullishOr(input.profiles.get(recipient.dotyposCustomerId))
        ).pipe(
          Result.flatMap((to) =>
            config.deploymentEnvironment === "production" ||
            isTestEmailRecipient(to)
              ? Result.succeed({ ...recipient, to })
              : Result.fail("outside-test-domain" as const)
          ),
          Result.mapError(skip)
        );
      };

      const classifyRecipients = (input: {
        readonly recipients: readonly BatchRecipient[];
        readonly profiles: ReadonlyMap<DotyposCustomerId, DotyposCustomer>;
        readonly consenting: ReadonlySet<DotyposCustomerId>;
      }) =>
        input.recipients.map((recipient) =>
          classifyRecipient({ ...input, recipient })
        );

      /**
       * Re-reads each recipient's email and, for marketing, consent, then
       * applies the test-domain guard outside production. Each recipient
       * gets the address to mail or why they're skipped; nothing reaches the
       * provider without passing here.
       */
      const hydrate = (input: {
        readonly context: DeliveryContext;
        readonly recipients: readonly BatchRecipient[];
      }) =>
        Effect.Do.pipe(
          Effect.let("customerIds", () =>
            input.recipients.map(({ dotyposCustomerId }) => dotyposCustomerId)
          ),
          Effect.bind("profiles", ({ customerIds }) =>
            loadProfiles(customerIds)
          ),
          Effect.bind("consenting", ({ customerIds }) =>
            loadConsenting({ campaign: input.context.campaign, customerIds })
          ),
          Effect.map(({ profiles, consenting }) =>
            classifyRecipients({
              recipients: input.recipients,
              profiles,
              consenting,
            })
          ),
          Effect.withSpan("CampaignDeliveryService.hydrate")
        );

      const renderMessage = (input: {
        readonly context: DeliveryContext;
        readonly recipient: ReachableRecipient;
      }) =>
        Effect.succeed(input).pipe(
          Effect.let("recipientTags", ({ context, recipient }) => ({
            sendId: context.sendId,
            dotyposCustomerId: recipient.dotyposCustomerId,
          })),
          Effect.bind("unsubscribeUrl", ({ context, recipientTags }) =>
            unsubscribe
              .unsubscribeUrl(recipientTags)
              .pipe(
                Effect.when(
                  Effect.succeed(context.campaign.purpose === "marketing")
                )
              )
          ),
          Effect.let("localized", ({ context, recipient }) =>
            campaignContentFor(context.campaign, recipient.locale)
          ),
          Effect.bind("rendered", ({ context, unsubscribeUrl, localized }) =>
            renderCampaignEmail({
              templateKey: context.campaign.templateKey,
              locale: localized.locale,
              content: localized.content,
              footer: Option.match(unsubscribeUrl, {
                onNone: () => CampaignEmailFooter.Operational(),
                onSome: (marketingPreferencesUrl) =>
                  CampaignEmailFooter.Marketing({ marketingPreferencesUrl }),
              }),
            })
          ),
          Effect.map(({ recipient, recipientTags, unsubscribeUrl, rendered }) =>
            campaignDeliveryMessage({
              sender: config,
              to: recipient.to,
              email: rendered,
              unsubscribeUrl,
              recipient: recipientTags,
              deploymentEnvironment: config.deploymentEnvironment,
            })
          ),
          Effect.withSpan("CampaignDeliveryService.renderMessage")
        );

      const renderMessages = (input: {
        readonly context: DeliveryContext;
        readonly recipients: readonly ReachableRecipient[];
      }) =>
        Effect.forEach(input.recipients, (recipient) =>
          renderMessage({ context: input.context, recipient })
        );

      /** Moves the given recipients that are still `pending` to `status`. */
      const settlePendingRecipients = (
        tx: Transaction,
        input: {
          readonly sendId: CampaignSendId;
          readonly customerIds: readonly DotyposCustomerId[];
          readonly status: "failed" | "unconfirmed";
          readonly now: Temporal.Instant;
        }
      ) =>
        tx
          .update(emailCampaignRecipients)
          .set({ status: input.status, statusUpdatedAt: input.now })
          .where(
            and(
              eq(emailCampaignRecipients.sendId, input.sendId),
              inArray(emailCampaignRecipients.dotyposCustomerId, [
                ...input.customerIds,
              ]),
              eq(emailCampaignRecipients.status, "pending")
            )
          );

      const markSkipped = (
        tx: Transaction,
        input: {
          readonly sendId: CampaignSendId;
          readonly skipped: readonly SkippedRecipient[];
          readonly now: Temporal.Instant;
        }
      ) =>
        Effect.forEach(input.skipped, ({ dotyposCustomerId, reason }) =>
          tx
            .update(emailCampaignRecipients)
            .set({
              status: "skipped",
              skipReason: reason,
              statusUpdatedAt: input.now,
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

      /**
       * Records the provider's message IDs. An accepted batch wins over any
       * failure recorded for its recipients; a webhook that arrived first
       * may already have moved one past `sent`, and that status stays.
       */
      const markBatchSent = (
        tx: Transaction,
        input: {
          readonly batch: DeliveryBatch;
          readonly ids: readonly string[];
          readonly now: Temporal.Instant;
        }
      ) =>
        Effect.forEach(
          input.batch.dotyposCustomerIds,
          (dotyposCustomerId, index) =>
            tx
              .update(emailCampaignRecipients)
              .set({
                providerMessageId: input.ids[index]!,
                status: sql`case when ${emailCampaignRecipients.status} in ('pending', 'failed', 'unconfirmed') then 'sent' else ${emailCampaignRecipients.status} end`,
                statusUpdatedAt: input.now,
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

      const recordBatchStatus = (
        tx: Transaction,
        input: {
          readonly batch: DeliveryBatch;
          readonly outcome: BatchOutcome;
          readonly now: Temporal.Instant;
        }
      ) =>
        tx
          .update(emailCampaignDeliveryBatches)
          .set({ status: input.outcome.status, settledAt: input.now })
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
      const recordRecipientsOutcome = (
        tx: Transaction,
        input: {
          readonly batch: DeliveryBatch;
          readonly outcome: BatchOutcome;
          readonly now: Temporal.Instant;
        }
      ): Effect.Effect<void, EffectDrizzleQueryError> =>
        Match.value(input.outcome).pipe(
          Match.when({ status: "accepted" }, ({ ids }) =>
            markBatchSent(tx, { ...input, ids }).pipe(Effect.asVoid)
          ),
          Match.orElse(({ status }) =>
            settlePendingRecipients(tx, {
              sendId: input.batch.sendId,
              customerIds: input.batch.dotyposCustomerIds,
              status: recipientStatusOf[status],
              now: input.now,
            }).pipe(Effect.asVoid)
          )
        );

      /** Settles a batch's outcome together with its recipients. */
      const settleBatch = (input: {
        readonly context: AttemptContext;
        readonly batch: DeliveryBatch;
        readonly outcome: BatchOutcome;
      }) =>
        currentInstant.pipe(
          Effect.flatMap((now) =>
            leasedTransaction(input.context, (tx) =>
              recordBatchStatus(tx, { ...input, now }).pipe(
                Effect.andThen(recordRecipientsOutcome(tx, { ...input, now }))
              )
            )
          ),
          Effect.withSpan("CampaignDeliveryService.settleBatch")
        );

      /**
       * Sends a persisted batch under its key, once. A refusal of its first
       * request fails its recipients, so a retry can't mail them twice. An
       * unknown outcome leaves the batch `requested` and ends the run, so the
       * redelivered message replays it. A replay's refusal says nothing about
       * the earlier request, so its recipients become `unconfirmed`.
       */
      const requestBatch = (
        input: PreparedBatch & {
          readonly context: AttemptContext;
          readonly replay: boolean;
        }
      ) =>
        requestOutcome(input).pipe(
          Effect.flatMap((outcome) => settleBatch({ ...input, outcome }))
        );

      /** What a persisted batch's request under its key settled as. */
      const requestOutcome = (
        input: PreparedBatch & {
          readonly context: CampaignDeliveryAttempt;
          readonly replay: boolean;
        }
      ) =>
        email
          .sendBatch(input.messages, {
            idempotencyKey: campaignDeliveryBatchIdempotencyKey(input.batch),
          })
          .pipe(
            Effect.map(
              (results): BatchOutcome => ({
                status: "accepted",
                ids: results.map(({ id }) => id),
              })
            ),
            Effect.catchTags({
              EmailServiceError: () =>
                Effect.logError("Campaign delivery batch refused", {
                  replay: input.replay,
                }).pipe(
                  Effect.as<BatchOutcome>({
                    status: input.replay ? "unconfirmed" : "rejected",
                  })
                ),
              NetworkError: () =>
                Effect.logWarning(
                  "Campaign delivery batch outcome unknown; it will be replayed"
                ).pipe(Effect.andThen(incomplete(input.context))),
            }),
            Effect.annotateLogs({
              batchIndex: input.batch.batchIndex,
              batchSize: input.batch.dotyposCustomerIds.length,
            }),
            Effect.withSpan("CampaignDeliveryService.requestBatch")
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

      const ensureReplayWindow = (requested: RequestedBatch) =>
        currentInstant.pipe(
          Effect.filterOrFail(
            (now) =>
              now.epochMilliseconds - requested.requestedAt.epochMilliseconds <=
              Duration.toMillis(campaignDeliveryBatchReplayWindow),
            () => new UnreplayableBatch({ reason: "key-expired" })
          ),
          Effect.asVoid
        );

      /**
       * Re-renders a requested batch for its replay. Its payload must hash
       * the same: every recipient still reachable at the same address, and
       * the same rendering.
       */
      const reproducePayload = (input: {
        readonly context: DeliveryContext;
        readonly batch: DeliveryBatch;
        readonly requested: RequestedBatch;
        /** The batch was just persisted from these profiles. */
        readonly profiles: Option.Option<
          ReadonlyMap<DotyposCustomerId, DotyposCustomer>
        >;
      }) =>
        loadBatchRecipients(input.batch).pipe(
          Effect.filterOrFail(
            (recipients) =>
              recipients.length === input.batch.dotyposCustomerIds.length,
            payloadChanged
          ),
          Effect.flatMap((recipients) =>
            Option.match(input.profiles, {
              onNone: () => hydrate({ context: input.context, recipients }),
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
            renderMessages({ context: input.context, recipients })
          ),
          Effect.filterOrFail(
            (messages) =>
              campaignDeliveryPayloadHash(messages) ===
              input.requested.payloadHash,
            payloadChanged
          ),
          // Rendering fails the same way every time, so the payload can't
          // be reproduced.
          Effect.catchTag("EmailServiceError", () =>
            Effect.fail(payloadChanged())
          ),
          // The batch may have been delivered, so it waits for a replay.
          Effect.catchTags({
            NetworkError: () => incomplete(input.context),
            ValidationError: () => incomplete(input.context),
            ExternalAPIError: () => incomplete(input.context),
            WorkspaceUrlConfigError: () => incomplete(input.context),
          })
        );

      /**
       * Replays a batch whose outcome is unknown with its identical payload
       * under its key. A batch past the key's replay window, or whose
       * payload can't be reproduced (a recipient's email or consent changed,
       * or the rendering did), is never resent: its recipients become
       * `unconfirmed`.
       */
      const replayRequestedBatch = (input: {
        readonly context: AttemptContext;
        readonly requested: RequestedBatch;
        readonly batch: DeliveryBatch;
      }) =>
        requestedBatchOutcome({
          ...input,
          profiles: Option.none(),
          beforeRequest: ensureStartBudget(input.context),
        }).pipe(
          Effect.flatMap((outcome) => settleBatch({ ...input, outcome })),
          Effect.withSpan("CampaignDeliveryService.replayRequestedBatch")
        );

      /**
       * Requests a persisted batch with its reproduced payload, within its
       * key's replay window. Without the profiles it was persisted from, the
       * request is a replay. A batch that can't be requested again is
       * `unconfirmed`.
       */
      const requestedBatchOutcome = (input: {
        readonly context: DeliveryContext;
        readonly requested: RequestedBatch;
        readonly batch: DeliveryBatch;
        readonly profiles: Option.Option<
          ReadonlyMap<DotyposCustomerId, DotyposCustomer>
        >;
        readonly beforeRequest: Effect.Effect<void, CampaignDeliveryIncomplete>;
      }) =>
        ensureReplayWindow(input.requested).pipe(
          Effect.andThen(input.beforeRequest),
          Effect.andThen(reproducePayload(input)),
          Effect.flatMap((messages) =>
            requestOutcome({
              context: input.context,
              batch: input.batch,
              messages,
              replay: Option.isNone(input.profiles),
            })
          ),
          Effect.catchTag("UnreplayableBatch", ({ reason }) =>
            Effect.logWarning("Campaign delivery batch unconfirmed", {
              batchIndex: input.batch.batchIndex,
              reason,
            }).pipe(Effect.as<BatchOutcome>({ status: "unconfirmed" }))
          )
        );

      const replayRequestedBatches = (context: AttemptContext) =>
        listRequestedBatches(context).pipe(
          Effect.flatMap((requested) =>
            Effect.forEach(
              requested,
              (batch) =>
                replayRequestedBatch({
                  context,
                  requested: batch,
                  batch: requestedDeliveryBatch(context, batch),
                }),
              { discard: true }
            )
          )
        );

      const countUnbatchedPending = (
        tx: Transaction,
        input: {
          readonly context: AttemptContext;
          readonly customerIds: readonly DotyposCustomerId[];
        }
      ) =>
        tx
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

      const nextBatchIndex = (
        tx: Transaction,
        context: CampaignDeliveryAttempt
      ) =>
        tx
          .select({
            batchIndex: sql<number>`coalesce(max(${emailCampaignDeliveryBatches.batchIndex}), -1)::int`,
          })
          .from(emailCampaignDeliveryBatches)
          .where(
            and(
              eq(emailCampaignDeliveryBatches.sendId, context.sendId),
              eq(
                emailCampaignDeliveryBatches.deliveryAttempt,
                context.deliveryAttempt
              )
            )
          )
          .pipe(Effect.map(([last]) => (last?.batchIndex ?? -1) + 1));

      const insertBatch = (
        tx: Transaction,
        input: {
          readonly context: CampaignDeliveryAttempt;
          readonly reachable: readonly ReachableRecipient[];
          readonly payloadHash: string;
          readonly now: Temporal.Instant;
        }
      ) =>
        nextBatchIndex(tx, input.context).pipe(
          Effect.map(
            (batchIndex): DeliveryBatch => ({
              sendId: input.context.sendId,
              deliveryAttempt: input.context.deliveryAttempt,
              batchIndex,
              dotyposCustomerIds: input.reachable.map(
                ({ dotyposCustomerId }) => dotyposCustomerId
              ),
            })
          ),
          Effect.tap((batch) =>
            tx.insert(emailCampaignDeliveryBatches).values({
              ...batch,
              dotyposCustomerIds: [...batch.dotyposCustomerIds],
              payloadHash: input.payloadHash,
              requestedAt: input.now,
            })
          )
        );

      /**
       * Persists the next batch before its first request, with the
       * recipients skipped while preparing it, after re-checking that these
       * recipients are still pending and unbatched.
       */
      const persistBatch = (input: {
        readonly context: AttemptContext;
        readonly recipients: readonly BatchRecipient[];
        readonly reachable: readonly ReachableRecipient[];
        readonly skipped: readonly SkippedRecipient[];
        readonly payloadHash: string;
      }) =>
        currentInstant.pipe(
          Effect.flatMap((now) =>
            leasedTransaction(input.context, (tx) =>
              countUnbatchedPending(tx, {
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
                  markSkipped(tx, {
                    sendId: input.context.sendId,
                    skipped: input.skipped,
                    now,
                  })
                ),
                Effect.andThen(
                  insertBatch(tx, { ...input, now }).pipe(
                    Effect.when(Effect.succeed(input.reachable.length > 0))
                  )
                )
              )
            )
          ),
          Effect.withSpan("CampaignDeliveryService.persistBatch")
        );

      /**
       * Fails recipients whose batch couldn't be prepared (Dotypos or the
       * unsubscribe link failed past their retries). Nothing was requested,
       * so the admin can retry them safely.
       */
      const failUnrequested = (
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
          Effect.flatMap((now) =>
            leasedTransaction(input.context, (tx) =>
              settlePendingRecipients(tx, {
                sendId: input.context.sendId,
                customerIds: input.recipients.map(
                  ({ dotyposCustomerId }) => dotyposCustomerId
                ),
                status: "failed",
                now,
              })
            )
          ),
          Effect.as(Option.none<PreparedBatch>())
        );

      /**
       * Prepares the next batch from the recipients no batch carries yet:
       * re-reads and guards them, renders their emails, and persists the
       * batch before its first request.
       */
      const prepareNextBatch = (input: {
        readonly context: AttemptContext;
        readonly recipients: readonly BatchRecipient[];
      }) =>
        hydrate(input).pipe(
          Effect.map((hydrated) => {
            const [skipped, reachable] = Arr.separate(hydrated);
            return { skipped, reachable };
          }),
          Effect.bind("messages", ({ reachable }) =>
            renderMessages({ context: input.context, recipients: reachable })
          ),
          Effect.bind("batch", ({ reachable, skipped, messages }) =>
            persistBatch({
              ...input,
              reachable,
              skipped,
              payloadHash: campaignDeliveryPayloadHash(messages),
            })
          ),
          Effect.map(({ batch, messages }) =>
            Option.map(
              batch,
              (persisted): PreparedBatch => ({
                batch: persisted,
                messages,
              })
            )
          ),
          Effect.catchTags({
            EmailServiceError: (cause) => failUnrequested(input, cause),
            NetworkError: (cause) => failUnrequested(input, cause),
            ValidationError: (cause) => failUnrequested(input, cause),
            ExternalAPIError: (cause) => failUnrequested(input, cause),
            WorkspaceUrlConfigError: (cause) => failUnrequested(input, cause),
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
              onSome: (prepared) =>
                requestBatch({
                  ...prepared,
                  context: input.context,
                  replay: false,
                }),
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

      const countUndelivered = (tx: Transaction, context: AttemptContext) =>
        tx
          .select({ count: sql<number>`count(*)::int` })
          .from(emailCampaignRecipients)
          .where(
            and(
              eq(emailCampaignRecipients.sendId, context.sendId),
              inArray(emailCampaignRecipients.status, [
                "pending",
                "failed",
                "unconfirmed",
              ])
            )
          )
          .pipe(Effect.map(([row]) => row?.count ?? 0));

      type SendSettlement = {
        readonly context: AttemptContext;
        readonly status: "sent" | "failed";
        readonly now: Temporal.Instant;
      };

      const recordCampaignStatus = (tx: Transaction, input: SendSettlement) =>
        tx
          .update(emailCampaigns)
          .set({ status: input.status, updatedAt: input.now })
          .where(
            and(
              eq(emailCampaigns.id, input.context.campaign.id),
              eq(emailCampaigns.status, "sending")
            )
          )
          .pipe(
            Effect.andThen(
              tx
                .update(emailCampaignSends)
                .set({
                  completedAt: input.status === "sent" ? input.now : null,
                })
                .where(eq(emailCampaignSends.id, input.context.sendId))
            )
          );

      /**
       * An automated send is never retried, so it completes however its
       * batch settled, and its runs end with it. Its campaign's status
       * belongs to the automation's lifecycle and stays as it is.
       */
      const completeAutomatedSend = (
        tx: Transaction,
        input: {
          readonly sendId: CampaignSendId;
          readonly now: Temporal.Instant;
        }
      ) =>
        tx
          .update(emailCampaignSends)
          .set({ completedAt: input.now })
          .where(eq(emailCampaignSends.id, input.sendId))
          .pipe(
            Effect.andThen(
              runSettlement.settle(tx, { sendId: input.sendId, at: input.now })
            )
          );

      const recordSendOutcome = (tx: Transaction, input: SendSettlement) =>
        input.context.campaign.automationVersionId === null
          ? recordCampaignStatus(tx, input)
          : completeAutomatedSend(tx, {
              sendId: input.context.sendId,
              now: input.now,
            });

      /**
       * Settles the send: a one-off campaign becomes Sent, or Failed when
       * anyone wasn't delivered; an automated send completes.
       */
      const settle = (context: AttemptContext) =>
        currentInstant.pipe(
          Effect.flatMap((now) =>
            leasedTransaction(context, (tx) =>
              countUndelivered(tx, context).pipe(
                Effect.map((undelivered) =>
                  undelivered > 0 ? ("failed" as const) : ("sent" as const)
                ),
                Effect.tap((status) =>
                  recordSendOutcome(tx, { context, status, now })
                )
              )
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

      /** The campaign email a version pins, as an automated send mails it. */
      const automatedCampaign = (
        tx: Transaction,
        sendId: CampaignSendId
      ): Effect.Effect<DeliveredCampaign, DatabaseQueryError> =>
        tx
          .select({
            id: emailCampaignSends.campaignId,
            automationVersionId: emailCampaignAutomationVersions.id,
            purpose: emailCampaignAutomationVersions.purpose,
            templateKey: emailCampaignAutomationVersions.templateKey,
            content: emailCampaignAutomationVersions.content,
          })
          .from(emailCampaignSends)
          .innerJoin(emailCampaignAutomationVersions, sendAutomationVersion)
          .where(eq(emailCampaignSends.id, sendId))
          .pipe(Effect.map(([campaign]) => campaign!));

      const createAutomatedSend: ICampaignDeliveryService["createAutomatedSend"] =
        (tx, input) =>
          tx
            .select({
              audienceFilter: emailCampaignAutomationVersions.audienceFilter,
              contentHash: emailCampaignAutomationVersions.contentHash,
            })
            .from(emailCampaignAutomationVersions)
            .where(
              and(
                eq(emailCampaignAutomationVersions.id, input.versionId),
                eq(emailCampaignAutomationVersions.campaignId, input.campaignId)
              )
            )
            .pipe(
              Effect.flatMap(([version]) =>
                tx
                  .insert(emailCampaignSends)
                  .values({
                    campaignId: input.campaignId,
                    automationVersionId: input.versionId,
                    audienceFilter: version!.audienceFilter,
                    contentHash: version!.contentHash,
                    createdAt: input.at,
                  })
                  .returning({ id: emailCampaignSends.id })
              ),
              Effect.map(([send]) => send!.id)
            );

      /** Renders the batch's emails; a rendering failure fails them all. */
      const renderAutomatedBatch = (input: {
        readonly context: DeliveryContext;
        readonly reachable: readonly ReachableRecipient[];
      }) =>
        renderMessages({
          context: input.context,
          recipients: input.reachable,
        }).pipe(
          Effect.map(Option.some),
          Effect.catchTags({
            EmailServiceError: (cause) => renderingFailed(cause),
            WorkspaceUrlConfigError: (cause) => renderingFailed(cause),
          })
        );

      const persistAutomatedBatch: ICampaignDeliveryService["persistAutomatedBatch"] =
        (tx, input) =>
          Effect.Do.pipe(
            Effect.let("customerIds", () =>
              input.recipients.map(({ dotyposCustomerId }) => dotyposCustomerId)
            ),
            Effect.let("attempt", () => automatedAttempt(input.sendId)),
            Effect.tap(() =>
              tx.insert(emailCampaignRecipients).values(
                input.recipients.map((recipient) => ({
                  ...recipient,
                  sendId: input.sendId,
                  statusUpdatedAt: input.at,
                }))
              )
            ),
            Effect.bind("campaign", () => automatedCampaign(tx, input.sendId)),
            Effect.bind("consenting", ({ campaign, customerIds }) =>
              loadConsenting({ campaign, customerIds, client: tx })
            ),
            Effect.let("classified", ({ consenting }) =>
              Arr.separate(
                classifyRecipients({
                  recipients: input.recipients,
                  profiles: input.profiles,
                  consenting,
                })
              )
            ),
            Effect.tap(({ classified: [skipped] }) =>
              markSkipped(tx, { sendId: input.sendId, skipped, now: input.at })
            ),
            Effect.bind("messages", ({ attempt, campaign, classified }) =>
              renderAutomatedBatch({
                context: { ...attempt, campaign },
                reachable: classified[1],
              })
            ),
            Effect.tap(({ attempt, classified: [, reachable], messages }) =>
              Option.match(messages, {
                onSome: (rendered) =>
                  insertBatch(tx, {
                    context: attempt,
                    reachable,
                    payloadHash: campaignDeliveryPayloadHash(rendered),
                    now: input.at,
                  }).pipe(
                    Effect.when(Effect.succeed(reachable.length > 0)),
                    Effect.asVoid
                  ),
                onNone: () =>
                  settlePendingRecipients(tx, {
                    sendId: input.sendId,
                    customerIds: reachable.map(
                      ({ dotyposCustomerId }) => dotyposCustomerId
                    ),
                    status: "failed",
                    now: input.at,
                  }).pipe(Effect.asVoid),
              })
            ),
            Effect.asVoid,
            Effect.withSpan("CampaignDeliveryService.persistAutomatedBatch")
          );

      const submitAutomatedSend: ICampaignDeliveryService["submitAutomatedSend"] =
        (input) =>
          findCurrentAttempt(automatedAttempt(input.sendId)).pipe(
            Effect.flatMap(
              Option.match({
                // Completed meanwhile: nothing is left to settle.
                onNone: () =>
                  Effect.succeed<AutomatedSendSettlement>(() => Effect.void),
                onSome: (campaign) =>
                  listRequestedBatches(automatedAttempt(input.sendId)).pipe(
                    Effect.flatMap((requested) =>
                      Effect.forEach(requested, (batch) =>
                        Effect.succeed(
                          requestedDeliveryBatch(
                            automatedAttempt(input.sendId),
                            batch
                          )
                        ).pipe(
                          Effect.bindTo("batch"),
                          Effect.bind("outcome", ({ batch: delivery }) =>
                            requestedBatchOutcome({
                              context: {
                                ...automatedAttempt(input.sendId),
                                campaign,
                              },
                              requested: batch,
                              batch: delivery,
                              profiles: input.profiles,
                              beforeRequest: Effect.void,
                            })
                          )
                        )
                      )
                    ),
                    Effect.map(
                      (settled): AutomatedSendSettlement =>
                        (tx, at) =>
                          Effect.forEach(
                            settled,
                            (batch) =>
                              recordBatchStatus(tx, { ...batch, now: at }).pipe(
                                Effect.andThen(
                                  recordRecipientsOutcome(tx, {
                                    ...batch,
                                    now: at,
                                  })
                                )
                              ),
                            { discard: true }
                          ).pipe(
                            Effect.andThen(
                              completeAutomatedSend(tx, {
                                sendId: input.sendId,
                                now: at,
                              })
                            )
                          )
                    )
                  ),
              })
            ),
            Effect.annotateLogs({ sendId: input.sendId }),
            Effect.withSpan("CampaignDeliveryService.submitAutomatedSend")
          );

      return {
        createAutomatedSend,
        persistAutomatedBatch,
        submitAutomatedSend,
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
      Layer.mergeAll(
        CampaignEmailConfig.Default,
        CampaignUnsubscribeService.Live,
        AutomationRunSettlement.Default,
        WorkspaceDotyposLayer,
        EmailServiceTag.RecipientRouted.pipe(Layer.provide(EmailConfigLayer))
      )
    ),
    Layer.provide(WorkspaceDatabase.Default)
  );
}

const renderingFailed = (cause: { readonly _tag: string }) =>
  Effect.logError("Automated send batch could not be rendered", {
    errorType: cause._tag,
  }).pipe(Effect.as(Option.none<readonly EmailMessage[]>()));

const payloadChanged = () =>
  new UnreplayableBatch({ reason: "payload-changed" });

const requestedDeliveryBatch = (
  attempt: CampaignDeliveryAttempt,
  requested: RequestedBatch
): DeliveryBatch => ({
  sendId: attempt.sendId,
  deliveryAttempt: attempt.deliveryAttempt,
  batchIndex: requested.batchIndex,
  dotyposCustomerIds: requested.dotyposCustomerIds,
});

type CampaignEmail = Pick<
  DeliveredCampaign,
  "purpose" | "templateKey" | "content"
>;

const deliveredCampaign = ({
  campaign,
  version,
}: {
  readonly campaign: CampaignEmail & { readonly id: CampaignId };
  readonly version:
    | (CampaignEmail & { readonly id: AutomationVersionId })
    | null;
}): DeliveredCampaign =>
  version === null
    ? { ...campaign, automationVersionId: null }
    : { ...version, id: campaign.id, automationVersionId: version.id };

const incomplete = (attempt: CampaignDeliveryAttempt) =>
  Effect.fail(
    new CampaignDeliveryIncomplete({
      sendId: attempt.sendId,
      deliveryAttempt: attempt.deliveryAttempt,
    })
  );

/**
 * The content a recipient reads: their locale's, else Czech, else the
 * campaign's only locale (an audience restricted to it).
 */
const campaignContentFor = (
  campaign: DeliveredCampaign,
  locale: Locale
): { readonly locale: Locale; readonly content: CampaignLocaleContent } => {
  const candidates = [locale, campaignFallbackLocale, ...localesOf(campaign)];
  const chosen = candidates.find((candidate) => campaign.content[candidate]);
  return { locale: chosen!, content: campaign.content[chosen!]! };
};

const localesOf = (campaign: DeliveredCampaign) =>
  locales.filter((locale) => campaign.content[locale] !== undefined);
