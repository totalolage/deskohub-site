import { createHash } from "node:crypto";
import type { EmailMessage } from "@deskohub/email";
import { Duration } from "effect";
import type { CampaignSendId } from "./campaign-identifiers";

/** Recipients per email provider batch request (Resend's batch limit). */
export const campaignDeliveryBatchSize = 100;

/**
 * How long after its first request a batch with an unknown outcome is
 * replayed. The provider keeps an idempotency key for 24 hours; the hour of
 * margin keeps a replay from reaching an expired key, which would mail the
 * batch again.
 */
export const campaignDeliveryBatchReplayWindow = Duration.hours(23);

/**
 * The provider idempotency key of one batch. A retried transport failure or
 * a resumed delivery replays the batch's identical payload under it, so the
 * provider returns the accepted batch instead of mailing it again; a retry of
 * the undelivered recipients starts a new attempt with new keys.
 */
export const campaignDeliveryBatchIdempotencyKey = (batch: {
  readonly sendId: CampaignSendId;
  readonly deliveryAttempt: number;
  readonly batchIndex: number;
}) =>
  `email-campaign:${batch.sendId}:attempt-${batch.deliveryAttempt}:batch-${batch.batchIndex}`;

/**
 * SHA-256 of a batch's provider payload. A replay sends the batch only when
 * its re-rendered payload hashes the same, since the provider rejects a key
 * reused with a different payload.
 */
export const campaignDeliveryPayloadHash = (
  messages: readonly EmailMessage[]
): string =>
  createHash("sha256").update(JSON.stringify(messages)).digest("hex");
