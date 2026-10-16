import type { DatePeriodUnitType } from "@deskohub/workspace-admin-api";
import { Match } from "effect";
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

/**
 * The period as audience summaries name it: "at any time", "in the last 10
 * days", "from 2026-01-01 to 2026-03-31", "since 2026-01-01" (through now),
 * "from 2026-01-01 onward" (future included), or "until 2026-01-01".
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
        m.emailCampaignsAudienceSummaryPeriodRange({ from, to }, options),
      Since: ({ date }) =>
        m.emailCampaignsAudienceSummaryPeriodSince({ date }, options),
      Onward: ({ date }) =>
        m.emailCampaignsAudienceSummaryPeriodOnward({ date }, options),
      Until: ({ date }) =>
        m.emailCampaignsAudienceSummaryPeriodUntil({ date }, options),
    })
  );
};
