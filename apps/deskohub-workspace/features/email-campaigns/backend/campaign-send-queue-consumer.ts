import { Effect } from "effect";
import { CampaignDeliveryService } from "./campaign-delivery.service";
import type { CampaignDeliveryAttempt } from "./campaign-send-queue.service";

/**
 * Delivers one queued attempt. A failure (an unavailable database, or an
 * attempt that ran out of time) fails the message, so the queue redelivers
 * it and the attempt resumes with the batches still pending.
 */
export const processCampaignSendMessage = Effect.fn(
  "campaignSendQueue.processMessage"
)(function* (attempt: CampaignDeliveryAttempt) {
  const delivery = yield* CampaignDeliveryService;
  return yield* delivery.deliverAttempt(attempt);
});
