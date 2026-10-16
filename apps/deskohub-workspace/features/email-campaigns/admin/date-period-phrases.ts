import type { DatePeriodUnitType } from "@deskohub/workspace-admin-api";
import { Match } from "effect";
import { formatAdministrationPlainDate } from "@/features/administration/formatters";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import type { DatePeriod } from "../date-period";
import type { AudienceMessage } from "./audiences/audience-attribute-wording";

const lastPeriods: Readonly<
  Record<DatePeriodUnitType, AudienceMessage<{ readonly count: number }>>
> = {
  day: m.emailCampaignsAudienceSummaryPeriodLastDay,
  week: m.emailCampaignsAudienceSummaryPeriodLastWeek,
  month: m.emailCampaignsAudienceSummaryPeriodLastMonth,
  year: m.emailCampaignsAudienceSummaryPeriodLastYear,
};

/** A period's date in `locale`; a date still being entered reads as a gap. */
const periodDate = (date: string, locale: Locale) =>
  date === ""
    ? m.emailCampaignsAudienceSummaryGap({}, { locale })
    : formatAdministrationPlainDate(date, locale);

/**
 * The period as audience summaries name it: "at any time", "in the last 10
 * days", "from Jan 1, 2026 to Mar 31, 2026", "since Jan 1, 2026" (through
 * now), "from Jan 1, 2026 onward" (future included), or "until Jan 1, 2026",
 * with dates in `locale`.
 */
export const describeDatePeriod = (
  period: DatePeriod,
  locale: Locale
): string => {
  const options = { locale };
  return Match.value(period).pipe(
    Match.tagsExhaustive({
      AnyTime: () => m.emailCampaignsAudienceSummaryPeriodAnyTime({}, options),
      Last: ({ count, unit }) => lastPeriods[unit]({ count }, options),
      Range: ({ from, to }) =>
        m.emailCampaignsAudienceSummaryPeriodRange(
          { from: periodDate(from, locale), to: periodDate(to, locale) },
          options
        ),
      Since: ({ date }) =>
        m.emailCampaignsAudienceSummaryPeriodSince(
          { date: periodDate(date, locale) },
          options
        ),
      Onward: ({ date }) =>
        m.emailCampaignsAudienceSummaryPeriodOnward(
          { date: periodDate(date, locale) },
          options
        ),
      Until: ({ date }) =>
        m.emailCampaignsAudienceSummaryPeriodUntil(
          { date: periodDate(date, locale) },
          options
        ),
    })
  );
};
