import { Schema } from "effect";

export const campaignIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("CampaignId")
).annotate({
  identifier: "CampaignId",
  description: "Database-generated identifier of one email campaign.",
});
export type CampaignId = typeof campaignIdSchema.Type;

export const campaignAudienceIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("CampaignAudienceId")
).annotate({
  identifier: "CampaignAudienceId",
  description: "Database-generated identifier of one saved campaign audience.",
});
export type CampaignAudienceId = typeof campaignAudienceIdSchema.Type;

export const campaignSendIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("CampaignSendId")
).annotate({
  identifier: "CampaignSendId",
  description:
    "Database-generated identifier of the send that froze a campaign's recipients.",
});
export type CampaignSendId = typeof campaignSendIdSchema.Type;

export const campaignConfirmationCodeSchema = Schema.NonEmptyString.pipe(
  Schema.brand("CampaignConfirmationCode")
).annotate({
  identifier: "CampaignConfirmationCode",
  description:
    "Code delivered in a campaign test email that the operator types back to confirm the real send.",
});
export type CampaignConfirmationCode =
  typeof campaignConfirmationCodeSchema.Type;
