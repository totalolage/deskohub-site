import { Effect } from "effect";
import { CampaignDeliveryService } from "@/features/email-campaigns/backend/campaign-delivery.service";
import { processCampaignSendMessage } from "@/features/email-campaigns/backend/campaign-send-queue-consumer";
import { defineQueueConsumer } from "@/shared/backend/queue/queue-consumer";

export const maxDuration = 300;

export const POST = defineQueueConsumer("emailCampaignSendQueue", (message) =>
  processCampaignSendMessage(message).pipe(
    Effect.provide(CampaignDeliveryService.Live)
  )
);
