import { supportedLocales } from "@deskohub/i18n/locale-registry";
import { Schema } from "effect";

export const AdministrationCampaignLocale = Schema.Literals(supportedLocales);
export type AdministrationCampaignLocale =
  typeof AdministrationCampaignLocale.Type;

export const AdministrationCampaignPurpose = Schema.Literals([
  "marketing",
  "operational",
]);
export type AdministrationCampaignPurpose =
  typeof AdministrationCampaignPurpose.Type;
