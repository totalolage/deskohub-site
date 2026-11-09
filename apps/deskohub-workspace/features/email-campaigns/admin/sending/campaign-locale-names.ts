import { getLocaleDefinition } from "@deskohub/i18n/locale-registry";
import type { Locale } from "@/features/i18n";

/** The name of a campaign content or recipient language, in that language. */
export const campaignLocaleName = (contentLocale: Locale) =>
  getLocaleDefinition(contentLocale).nativeName;

export const describeCampaignLocales = (contentLocales: readonly Locale[]) =>
  contentLocales.map(campaignLocaleName).join(", ");
