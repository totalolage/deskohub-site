import { Schema } from "effect";

/**
 * How a campaign delivers, chosen at creation and never changed. A `once`
 * campaign sends one email to its audience; an `automated` campaign runs a
 * flow for customers as they qualify.
 */
export const campaignDeliveries = ["once", "automated"] as const;
const campaignDeliverySchema = Schema.Literals(campaignDeliveries);
export type CampaignDelivery = typeof campaignDeliverySchema.Type;

/**
 * Draft campaigns are editable. Sending and Sent campaigns have frozen
 * recipients and are read-only; a Failed send can retry its undelivered
 * recipients.
 */
export const onceCampaignStatuses = [
  "draft",
  "sending",
  "sent",
  "failed",
] as const;

/**
 * A Draft automation has never run. Active ones admit customers, Paused ones
 * hold them, and Archived ones have ended for good.
 */
export const automatedCampaignStatuses = [
  "draft",
  "active",
  "paused",
  "archived",
] as const;

const onceCampaignStateSchema = Schema.Struct({
  delivery: Schema.Literal("once"),
  status: Schema.Literals(onceCampaignStatuses),
});

/**
 * The delivery mode with the statuses it allows, as the
 * `email_campaigns_status_check` constraint stores them.
 */
const automatedCampaignStateSchema = Schema.Struct({
  delivery: Schema.Literal("automated"),
  status: Schema.Literals(automatedCampaignStatuses),
});

const campaignStateSchema = Schema.Union([
  onceCampaignStateSchema,
  automatedCampaignStateSchema,
]);
type CampaignState = typeof campaignStateSchema.Type;
export type OnceCampaignStatus = (typeof onceCampaignStatuses)[number];
export type AutomatedCampaignStatus =
  (typeof automatedCampaignStatuses)[number];
export type CampaignStatus = CampaignState["status"];

/**
 * Narrows a stored campaign to a one-off campaign. Send, test send, retry,
 * and the one-off admin pages handle only these.
 */
export const isOnceCampaign = Schema.is(onceCampaignStateSchema);

/** Narrows a campaign to an automated one, whose status is its automation's. */
export const isAutomatedCampaign = Schema.is(automatedCampaignStateSchema);

/**
 * Delivery state of one frozen recipient. `pending` has no confirmed
 * provider outcome yet; a batch carrying it may be awaiting a replay.
 * `sent` was accepted by the provider, and its webhook reports `delivered`,
 * `bounced`, or `complained`. `failed` was refused by the provider, so a
 * retry can't mail it twice. `unconfirmed` may have been mailed: its batch's
 * outcome stayed unknown until the idempotency key expired, or the batch
 * could no longer be reproduced, so only an explicit admin retry mails it
 * again. `skipped` lost its eligibility before delivery (see its reason).
 */
export const campaignRecipientStatuses = [
  "pending",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "unconfirmed",
  "skipped",
] as const;
const campaignRecipientStatusSchema = Schema.Literals(
  campaignRecipientStatuses
);
export type CampaignRecipientStatus = typeof campaignRecipientStatusSchema.Type;

/**
 * Why a recipient was skipped at delivery: their profile no longer gives a
 * reachable email, their marketing consent was withdrawn, or (outside
 * production) their email is outside the email test domain.
 */
export const campaignRecipientSkipReasons = [
  "missing-from-dotypos",
  "deleted-customer",
  "missing-email",
  "invalid-email",
  "consent-withdrawn",
  "outside-test-domain",
] as const;
const campaignRecipientSkipReasonSchema = Schema.Literals(
  campaignRecipientSkipReasons
);
export type CampaignRecipientSkipReason =
  typeof campaignRecipientSkipReasonSchema.Type;

/**
 * State of one provider batch. `requested` is persisted before every
 * provider request and stays until the provider's answer is recorded, so a
 * resumed delivery replays it under the same key. `accepted` and `rejected`
 * are the provider's answers; `unconfirmed` gave up on an unknown outcome.
 */
export const campaignDeliveryBatchStatuses = [
  "requested",
  "accepted",
  "rejected",
  "unconfirmed",
] as const;
const campaignDeliveryBatchStatusSchema = Schema.Literals(
  campaignDeliveryBatchStatuses
);
export type CampaignDeliveryBatchStatus =
  typeof campaignDeliveryBatchStatusSchema.Type;
