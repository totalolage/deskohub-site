import { Context, Data, Duration, Effect, Layer, Schema } from "effect";
import { QueuePublisher } from "@/shared/backend/queue/queue-publisher";
import { defineQueueTopic } from "@/shared/backend/queue/queue-topic";
import {
  type CampaignSendId,
  campaignSendIdSchema,
} from "../campaign-identifiers";

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

/** One message per delivery attempt. */
export const campaignSendTopic = defineQueueTopic({
  topic: "workspace-email-campaign-send",
  label: "Campaign send",
  message: Schema.toStandardSchemaV1(
    Schema.Struct({
      sendId: campaignSendIdSchema,
      deliveryAttempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    })
  ),
  publish: (attempt: CampaignDeliveryAttempt) => ({
    message: {
      sendId: attempt.sendId,
      deliveryAttempt: attempt.deliveryAttempt,
    },
    key: `email-campaign-send:${attempt.sendId}:${attempt.deliveryAttempt}`,
  }),
  /**
   * A batch with an unknown outcome is replayed for up to 23 hours after its
   * first request (the provider keeps its key for 24). The message outlives
   * that window by a day, so a later run always finds the expired batch and
   * settles its recipients as `unconfirmed` instead of leaving the campaign
   * Sending.
   */
  retention: Duration.hours(48),
});

interface ICampaignSendQueueService {
  readonly enqueue: (
    attempt: CampaignDeliveryAttempt
  ) => Effect.Effect<void, CampaignSendQueueError>;
}

/**
 * Hands a delivery attempt to the durable queue, so an admin request never
 * waits on the email provider. The consumer redelivers the attempt's message
 * until every batch of the attempt went out.
 */
export class CampaignSendQueueService extends Context.Service<
  CampaignSendQueueService,
  ICampaignSendQueueService
>()("@deskohub-workspace/email-campaigns/CampaignSendQueueService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const publisher = yield* QueuePublisher;
      return {
        enqueue: Effect.fn("campaignSendQueue.enqueue")(function* (attempt) {
          yield* campaignSendTopic.publish(attempt).pipe(
            Effect.provideService(QueuePublisher, publisher),
            Effect.mapError(
              (cause) =>
                new CampaignSendQueueError({
                  message: "Campaign delivery could not be enqueued.",
                  cause,
                })
            )
          );
        }),
      };
    })
  );

  static Live = this.Default.pipe(Layer.provide(QueuePublisher.Default));
}
