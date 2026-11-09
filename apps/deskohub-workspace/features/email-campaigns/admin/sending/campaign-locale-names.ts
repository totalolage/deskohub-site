import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";

const campaignLocaleNameMessages = {
  "cs-CZ": m.emailCampaignsLocaleNameCzech,
  "en-US": m.emailCampaignsLocaleNameEnglish,
} as const satisfies Record<Locale, typeof m.emailCampaignsLocaleNameCzech>;

/** The admin-facing name of a campaign content or recipient language. */
export const campaignLocaleName = (contentLocale: Locale, locale: Locale) =>
  campaignLocaleNameMessages[contentLocale]({}, { locale });

export const describeCampaignLocales = (
  contentLocales: readonly Locale[],
  locale: Locale
) =>
  contentLocales
    .map((contentLocale) => campaignLocaleName(contentLocale, locale))
    .join(", ");
