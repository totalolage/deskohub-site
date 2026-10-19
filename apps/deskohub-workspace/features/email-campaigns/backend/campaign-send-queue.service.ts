import type { send } from "@vercel/queue";
import { Context, Data, Effect, Layer } from "effect";
import { publishQueueMessage } from "@/shared/backend/queue/queue-message";
import type { CampaignSendId } from "../campaign-identifiers";

export const campaignSendQueueTopic = "workspace-email-campaign-send";

/**
 * A batch with an unknown outcome is replayed for up to 23 hours after its
 * first request (the provider keeps its key for 24). The message outlives
 * that window by a day, so a later run always finds the expired batch and
 * settles its recipients as `unconfirmed` instead of leaving the campaign
 * Sending.
 */
const campaignSendMessageRetentionSeconds = 48 * 60 * 60;

export class CampaignSendQueueError extends Data.TaggedError(
  "CampaignSendQueueError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** One delivery attempt of a frozen campaign send. */
export type CampaignDeliveryAttempt = {
  readonly sendId: CampaignSendId;
  readonly deliveryAttempt: number;
};

interface ICampaignSendQueueService {
  readonly enqueue: (
    attempt: CampaignDeliveryAttempt
  ) => Effect.Effect<void, CampaignSendQueueError>;
}

/**
 * Hands a delivery attempt to the durable queue, so an admin request never
 * waits on the email provider. One message per attempt; the consumer
 * redelivers it until every batch of the attempt went out.
 */
export const makeCampaignSendQueueService = (
  sendMessage?: typeof send
): ICampaignSendQueueService => ({
  enqueue: Effect.fn("campaignSendQueue.enqueue")(function* (attempt) {
    yield* publishQueueMessage(
      campaignSendQueueTopic,
      { sendId: attempt.sendId, deliveryAttempt: attempt.deliveryAttempt },
      {
        retentionSeconds: campaignSendMessageRetentionSeconds,
        idempotencyKey: `email-campaign-send:${attempt.sendId}:${attempt.deliveryAttempt}`,
      },
      sendMessage
    ).pipe(
      Effect.mapError(
        (cause) =>
          new CampaignSendQueueError({
            message: "Campaign delivery could not be enqueued.",
            cause,
          })
      )
    );
  }),
});

export class CampaignSendQueueService extends Context.Service<
  CampaignSendQueueService,
  ICampaignSendQueueService
>()("@deskohub-workspace/email-campaigns/CampaignSendQueueService") {
  static Default = Layer.succeed(this, makeCampaignSendQueueService());
}
