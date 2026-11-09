import { Schema } from "effect";

export const AdministrationCampaignLocale = Schema.Literals(["cs-CZ", "en-US"]);
export type AdministrationCampaignLocale =
  typeof AdministrationCampaignLocale.Type;

export const AdministrationCampaignPurpose = Schema.Literals([
  "marketing",
  "operational",
]);
export type AdministrationCampaignPurpose =
  typeof AdministrationCampaignPurpose.Type;
