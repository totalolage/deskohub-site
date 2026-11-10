import { and, eq, isNull, type SQL } from "drizzle-orm";
import { Data, Effect, Option } from "effect";
import {
  WorkspaceDatabase,
  type WorkspaceTransaction,
} from "@/db/database.service";
import {
  emailCampaignAutomationVersions,
  emailCampaignRecipients,
  emailCampaignSends,
} from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import {
  type BatchOutcome,
  type BatchProfiles,
  type BatchRecipient,
  BatchRequest,
  CampaignBatchDelivery,
  type CampaignDeliveryIncomplete,
  type DeliveredAttempt,
  type DeliveredCampaign,
  type PersistedBatch,
  PreparedBatch,
} from "../../backend/campaign-batch-delivery.service";
import type { CampaignDeliveryAttempt } from "../../backend/campaign-send-queue.service";
import { sendAutomationVersion } from "../../backend/campaign-send-selection";
import type { CampaignId, CampaignSendId } from "../../campaign-identifiers";
import type { AutomationVersionId } from "../automation-identifiers";

/**
 * What submitting an automated send found. `AlreadyCompleted`: an earlier
 * settlement completed the send, so nothing is left to record and its runs
 * already ended. `Submitted`: the outcome of each batch it requested, for
 * `settle`.
 */
export type AutomatedSendSubmission = Data.TaggedEnum<{
  AlreadyCompleted: Record<never, never>;
  Submitted: { readonly batches: readonly RequestedBatchOutcome[] };
}>;

export const AutomatedSendSubmission =
  Data.taggedEnum<AutomatedSendSubmission>();

/** A persisted batch with what its request settled as. */
type RequestedBatchOutcome = {
  readonly batch: PersistedBatch;
  readonly outcome: BatchOutcome;
};

/** Automated sends are never retried, so they deliver their first attempt only. */
const automatedAttempt = (sendId: CampaignSendId): CampaignDeliveryAttempt => ({
  sendId,
  deliveryAttempt: 1,
});

/**
 * The send steps of a deliver unit (§5.9) over the campaign batch protocol.
 * The unit's claim stands in for a one-off send's lease, and its own
 * transactions interleave its run moves with these steps.
 */
export const makeAutomatedCampaignSend = Effect.gen(function* () {
  const { db } = yield* WorkspaceDatabase;
  const batches = yield* CampaignBatchDelivery;

  /**
   * The campaign email that the version of the automated send `send`
   * selects pins, if such a send exists.
   */
  const automatedCampaignOf = (
    send: SQL | undefined
  ): Effect.Effect<Option.Option<DeliveredCampaign>, DatabaseQueryError> =>
    db
      .select({
        id: emailCampaignSends.campaignId,
        purpose: emailCampaignAutomationVersions.purpose,
        templateKey: emailCampaignAutomationVersions.templateKey,
        content: emailCampaignAutomationVersions.content,
      })
      .from(emailCampaignSends)
      .innerJoin(emailCampaignAutomationVersions, sendAutomationVersion)
      .where(send)
      .pipe(Effect.map(([campaign]) => Option.fromNullishOr(campaign)));

  /** The automated send's first attempt with the email its version pins. */
  const deliveredAttempt = (sendId: CampaignSendId) =>
    automatedCampaignOf(eq(emailCampaignSends.id, sendId)).pipe(
      Effect.map(
        (campaign): DeliveredAttempt => ({
          ...automatedAttempt(sendId),
          campaign: Option.getOrThrow(campaign),
        })
      )
    );

  /**
   * The campaign email of an automated send its deliver unit hasn't
   * settled yet, whatever its campaign's status.
   */
  const uncompletedAutomatedCampaign = (sendId: CampaignSendId) =>
    automatedCampaignOf(
      and(
        eq(emailCampaignSends.id, sendId),
        eq(emailCampaignSends.deliveryAttempt, 1),
        isNull(emailCampaignSends.completedAt)
      )
    );

  /**
   * §5.9 step 2, in a deliver unit's commit transaction: creates the
   * automated send of the version, with the version's audience snapshot and
   * content hash.
   */
  const create = (input: {
    readonly campaignId: CampaignId;
    readonly versionId: AutomationVersionId;
    readonly at: Temporal.Instant;
  }): Effect.Effect<CampaignSendId, DatabaseQueryError, WorkspaceTransaction> =>
    db
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
          db
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

  /**
   * §5.9 step 2, after the runs moved to `sending`: freezes their
   * recipients and persists them as batch 0 from the profiles the unit
   * read, before any request. The delivery recheck skips whoever fails it;
   * rendering that fails fails the rest, as nothing was requested.
   */
  const persistBatch = (input: {
    readonly sendId: CampaignSendId;
    readonly recipients: readonly BatchRecipient[];
    readonly profiles: BatchProfiles;
    readonly at: Temporal.Instant;
  }): Effect.Effect<void, DatabaseQueryError, WorkspaceTransaction> =>
    db
      .insert(emailCampaignRecipients)
      .values(
        input.recipients.map((recipient) => ({
          ...recipient,
          sendId: input.sendId,
          statusUpdatedAt: input.at,
        }))
      )
      .pipe(
        Effect.andThen(deliveredAttempt(input.sendId)),
        Effect.flatMap((send) =>
          batches.prepare({
            send,
            recipients: input.recipients,
            profiles: Option.some(input.profiles),
          })
        ),
        Effect.tap(
          PreparedBatch.$match({
            Rendered: () => Effect.void,
            Unrendered: ({ cause }) =>
              Effect.logError("Automated send batch could not be rendered", {
                errorType: cause._tag,
              }),
          })
        ),
        // The unit read the profiles, so nothing here reads Dotypos.
        Effect.catchTags({
          DotyposUnavailable: Effect.die,
          DotyposRejected: Effect.die,
        }),
        Effect.flatMap((prepared) =>
          batches.persist({ prepared, at: input.at })
        ),
        Effect.asVoid,
        Effect.withSpan("AutomatedCampaignSend.persistBatch")
      );

  /**
   * §5.9 step 3: requests the send's persisted batch under its key and
   * returns each batch's outcome for step 4. With the profiles the batch was
   * persisted from, it's the first request; without them it replays the
   * batch, re-reading its recipients, and past the replay window the batch
   * is `Unconfirmed`. A send already completed requests nothing. An unknown
   * outcome fails, so the unit retries the replay.
   */
  const submit = (input: {
    readonly sendId: CampaignSendId;
    readonly profiles: Option.Option<BatchProfiles>;
  }): Effect.Effect<
    AutomatedSendSubmission,
    CampaignDeliveryIncomplete | DatabaseQueryError
  > =>
    uncompletedAutomatedCampaign(input.sendId).pipe(
      Effect.flatMap(
        Option.match({
          // Completed meanwhile: nothing is left to settle.
          onNone: () =>
            Effect.succeed<AutomatedSendSubmission>(
              AutomatedSendSubmission.AlreadyCompleted()
            ),
          onSome: (campaign) =>
            batches.listRequested(automatedAttempt(input.sendId)).pipe(
              Effect.flatMap((requested) =>
                Effect.forEach(requested, (batch) =>
                  batches
                    .request(
                      batchRequest({
                        send: { ...automatedAttempt(input.sendId), campaign },
                        batch,
                        profiles: input.profiles,
                      })
                    )
                    .pipe(
                      Effect.map(
                        (outcome): RequestedBatchOutcome => ({ batch, outcome })
                      )
                    )
                )
              ),
              Effect.map(
                (submitted): AutomatedSendSubmission =>
                  AutomatedSendSubmission.Submitted({ batches: submitted })
              )
            ),
        })
      ),
      Effect.annotateLogs({ sendId: input.sendId }),
      Effect.withSpan("AutomatedCampaignSend.submit")
    );

  /**
   * §5.9 step 4, in the caller's transaction: records a submitted send's
   * batch outcomes on the batches and their recipients, then completes the
   * send. An automated send is never retried, so it completes however its
   * batch settled. Its campaign's status belongs to the automation's
   * lifecycle and stays as it is; its runs are the caller's.
   */
  const settle = (input: {
    readonly sendId: CampaignSendId;
    readonly batches: readonly RequestedBatchOutcome[];
    readonly at: Temporal.Instant;
  }): Effect.Effect<void, DatabaseQueryError, WorkspaceTransaction> =>
    Effect.forEach(
      input.batches,
      ({ batch, outcome }) => batches.settle({ batch, outcome, at: input.at }),
      { discard: true }
    ).pipe(
      Effect.andThen(
        db
          .update(emailCampaignSends)
          .set({ completedAt: input.at })
          .where(eq(emailCampaignSends.id, input.sendId))
      ),
      Effect.asVoid,
      Effect.withSpan("AutomatedCampaignSend.settle")
    );

  return { create, persistBatch, submit, settle };
});

/**
 * A batch's request from the deliver unit: its first with the profiles this
 * invocation read, or a replay by a unit claimed again.
 */
const batchRequest = (input: {
  readonly send: DeliveredAttempt;
  readonly batch: PersistedBatch;
  readonly profiles: Option.Option<BatchProfiles>;
}): BatchRequest =>
  Option.match(input.profiles, {
    onSome: (profiles) =>
      BatchRequest.Reproduced({
        send: input.send,
        batch: input.batch,
        profiles,
      }),
    onNone: () =>
      BatchRequest.Replay({
        send: input.send,
        batch: input.batch,
        admit: Effect.void,
      }),
  });
