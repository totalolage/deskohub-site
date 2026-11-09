import { Option } from "effect";
import { isLocale, type Locale, locales } from "@/features/i18n";
import { type AudienceFilter, audienceSingleLocale } from "./audience-filter";
import type {
  CampaignLocaleContent,
  CampaignLocalizedContent,
} from "./body/campaign-content";

/** Locale for recipients without a known or covered preference. */
export const campaignFallbackLocale: Locale = "cs-CZ";

/** Campaign locales in display order: the required fallback first. */
export const campaignLocales: readonly Locale[] = [
  campaignFallbackLocale,
  ...locales.filter((locale) => locale !== campaignFallbackLocale),
];

/**
 * The order campaign content is read, changed, written, listed and test-sent
 * in. It differs from the display order `campaignLocales`, and changing
 * either is visible to administration API clients.
 */
export const campaignContentLocaleOrder: readonly Locale[] = locales;

/**
 * The locales a per-locale record has a value for, with their values, in
 * `order`: content order unless a caller asks for display order.
 */
export const campaignLocaleEntries = <Value>(
  record: Partial<Record<Locale, Value>>,
  order: readonly Locale[] = campaignContentLocaleOrder
): ReadonlyArray<readonly [Locale, Value]> =>
  order.flatMap((locale) => {
    const value = record[locale];
    return value === undefined ? [] : [[locale, value] as const];
  });

/** The locales the campaign has content for, in content order. */
export const campaignContentLocales = (
  content: CampaignLocalizedContent
): ReadonlyArray<Locale> =>
  campaignLocaleEntries(content).map(([locale]) => locale);

/**
 * The language a campaign email reaches a customer in, and the value the
 * audience locale condition filters on: the linked account's preference,
 * then the latest reservation's locale, then the marketing consent's locale,
 * then Czech.
 */
export const resolveRecipientLocale = (sources: {
  readonly accountLocale: string | null;
  readonly latestReservationLocale: string | null;
  readonly consentLocale: string | null;
}): Locale =>
  [
    sources.accountLocale,
    sources.latestReservationLocale,
    sources.consentLocale,
  ].find((locale): locale is Locale => locale !== null && isLocale(locale)) ??
  campaignFallbackLocale;

/**
 * The content a recipient reads: their locale's, else Czech, else the
 * campaign's first content locale (an audience restricted to it). The
 * campaign must have content.
 */
export const campaignContentForRecipient = (
  content: CampaignLocalizedContent,
  recipientLocale: Locale
): { readonly locale: Locale; readonly content: CampaignLocaleContent } => {
  const candidates = [
    recipientLocale,
    campaignFallbackLocale,
    ...campaignContentLocales(content),
  ];
  const chosen = candidates.find((candidate) => content[candidate]);
  return { locale: chosen!, content: content[chosen!]! };
};

/**
 * Whether every recipient the audience can reach gets content meant for
 * them. A recipient in a locale without content gets the Czech fallback, so
 * the campaign needs Czech content unless the audience is restricted to a
 * single locale it has content for. A campaign without an audience is
 * unrestricted. The composer's rule for which locales an editor must fill
 * is stricter on purpose and lives with the composer.
 */
export const campaignContentCoversAudience = (input: {
  readonly content: CampaignLocalizedContent;
  readonly audienceFilter: Option.Option<AudienceFilter>;
}): boolean =>
  input.content[campaignFallbackLocale] !== undefined ||
  input.audienceFilter.pipe(
    Option.flatMapNullishOr(audienceSingleLocale),
    Option.exists((locale) => input.content[locale] !== undefined)
  );
