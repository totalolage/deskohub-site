import { Schema } from "effect";

export const AdministrationCampaignId = Schema.NonEmptyString.pipe(
  Schema.brand("CampaignId")
).annotate({
  identifier: "CampaignId",
  description: "Database-generated identifier of one email campaign.",
});
export type AdministrationCampaignId = typeof AdministrationCampaignId.Type;

export const AdministrationCampaignAudienceId = Schema.NonEmptyString.pipe(
  Schema.brand("CampaignAudienceId")
).annotate({
  identifier: "CampaignAudienceId",
  description: "Database-generated identifier of one saved campaign audience.",
});
export type AdministrationCampaignAudienceId =
  typeof AdministrationCampaignAudienceId.Type;
