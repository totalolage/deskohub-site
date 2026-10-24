import type {
  CalendarDayOfMonth,
  CalendarExpressionType as CalendarExpression,
  CalendarWeekdayType as CalendarWeekday,
  CalendarWeekdayOccurrence,
} from "@deskohub/workspace-admin-api";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { consecutiveRuns } from "@/shared/utils/number";
import { upperCaseFirst } from "@/shared/utils/text-case";

/**
 * A schedule names when each period starts; a wait names the period it waits
 * for.
 */
export type CalendarExpressionUsage = "schedule" | "wait";

interface Phrasing {
  readonly usage: CalendarExpressionUsage;
  readonly locale: Locale;
}

type ListType = "conjunction" | "disjunction";

/**
 * Values joined for the sentence. A schedule lists every value it fires at;
 * a wait lists the alternatives it waits for.
 */
const listed = (
  items: readonly string[],
  { usage, locale }: Phrasing,
  type: ListType = usage === "schedule" ? "conjunction" : "disjunction"
) => new Intl.ListFormat(locale, { type }).format(items);

const twoDigits = (value: number) => String(value).padStart(2, "0");

const clockTime = (hour: number, minute: number) =>
  `${twoDigits(hour)}:${twoDigits(minute)}`;

/** ":15" in English, "xx:15" in Czech, listed for the sentence. */
const minuteMarks = (minutes: readonly number[], phrasing: Phrasing) =>
  listed(
    minutes.map((minute) =>
      m.emailCampaignsCalendarMinute(
        { minute: twoDigits(minute) },
        { locale: phrasing.locale }
      )
    ),
    phrasing
  );

/**
 * A wait's hours as clock windows, consecutive hours merged into one: hours
 * 9, 10, 11 and 14 are 09:00–11:59 and 14:00–14:59.
 */
const hourWindows = (hours: readonly number[]) =>
  consecutiveRuns(hours).map(({ first, last }) => ({
    start: clockTime(first, 0),
    end: clockTime(last, 59),
  }));

/** "09:00–11:59 or 14:00–14:59". */
const hourSpans = (hours: readonly number[], phrasing: Phrasing) =>
  listed(
    hourWindows(hours).map((window) =>
      m.emailCampaignsCalendarHourSpan(window, { locale: phrasing.locale })
    ),
    phrasing
  );

/**
 * When in the day a wait waits for: "between 09:00 and 11:59" for one
 * window, "during 09:00–11:59 or 14:00–14:59" for several.
 */
const hoursWithin = (hours: readonly number[], phrasing: Phrasing) => {
  const options = { locale: phrasing.locale };
  const [window, ...others] = hourWindows(hours);
  return window && others.length === 0
    ? m.emailCampaignsCalendarHourRange(window, options)
    : m.emailCampaignsCalendarHourSpans(
        { spans: hourSpans(hours, phrasing) },
        options
      );
};

const workdays = ["monday", "tuesday", "wednesday", "thursday", "friday"];
const weekend = ["saturday", "sunday"];

const sameSet = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value) => right.includes(value));

const weekdaySet = (weekdays: readonly CalendarWeekday[]) => {
  if (sameSet(weekdays, workdays)) {
    return "workdays";
  }
  return sameSet(weekdays, weekend) ? "weekend" : "listed";
};

/** "every Monday and Friday", "every weekday"; "Monday or Friday" in a wait. */
const weekdaysPhrase = (
  weekdays: readonly CalendarWeekday[],
  qualified: boolean,
  phrasing: Phrasing
) => {
  const options = { locale: phrasing.locale };
  const names = weekdays.map((weekday) =>
    phrasing.usage === "schedule"
      ? m.emailCampaignsCalendarWeekdayEveryName({ weekday }, options)
      : m.emailCampaignsCalendarWeekdayWaitName({ weekday }, options)
  );
  const inputs = {
    set: weekdaySet(weekdays),
    weekdays: listed(names, phrasing),
  };
  if (phrasing.usage === "schedule") {
    return m.emailCampaignsCalendarWeekdaysEvery(inputs, options);
  }
  return qualified
    ? m.emailCampaignsCalendarWeekdaysWaitQualified(inputs, options)
    : m.emailCampaignsCalendarWeekdaysWait(inputs, options);
};

/** "the 1st and last day" (unscoped). */
const daysOfMonthPhrase = (
  days: readonly CalendarDayOfMonth[],
  phrasing: Phrasing
) => {
  const options = { locale: phrasing.locale };
  const names = days.map((day) =>
    day === "last"
      ? m.emailCampaignsCalendarLastDayOfMonth({}, options)
      : m.emailCampaignsCalendarDayOfMonth({ day }, options)
  );
  return m.emailCampaignsCalendarDaysOfMonth(
    { days: listed(names, phrasing) },
    options
  );
};

/** "the 2nd Tuesday and last Friday" (unscoped). */
const occurrencesPhrase = (
  occurrences: readonly CalendarWeekdayOccurrence[],
  phrasing: Phrasing
) => {
  const options = { locale: phrasing.locale };
  const names = occurrences.map(({ occurrence, weekday }) => {
    const name =
      phrasing.usage === "schedule"
        ? m.emailCampaignsCalendarWeekdayName({ weekday }, options)
        : m.emailCampaignsCalendarWeekdayWaitName({ weekday }, options);
    return occurrence === "last"
      ? m.emailCampaignsCalendarLastOccurrence({ weekday: name }, options)
      : m.emailCampaignsCalendarOccurrence(
          { occurrence, weekday: name },
          options
        );
  });
  return m.emailCampaignsCalendarOccurrences(
    { occurrences: listed(names, phrasing) },
    options
  );
};

const monthNames = (
  months: readonly number[],
  message:
    | typeof m.emailCampaignsCalendarMonthName
    | typeof m.emailCampaignsCalendarMonthInName
    | typeof m.emailCampaignsCalendarMonthOfName,
  phrasing: Phrasing,
  type?: ListType
) =>
  listed(
    months.map((month) =>
      message({ month: String(month) }, { locale: phrasing.locale })
    ),
    phrasing,
    type
  );

const weekNumbers = (weeks: readonly number[], phrasing: Phrasing) =>
  listed(
    weeks.map((week) =>
      m.emailCampaignsCalendarWeekNumber({ week }, { locale: phrasing.locale })
    ),
    phrasing
  );

/** Lists name one period in a wait, so only a schedule's lists read plural. */
const listCount = (values: readonly unknown[], { usage }: Phrasing) =>
  usage === "schedule" ? values.length : 1;

type MonthScope = "subject" | "qualifier";

/**
 * A day-of-month or occurrence phrase with its months: "the 1st of every
 * month", "the 2nd Tuesday of December". Behind a weekday ("every Friday that
 * is the 13th") an unrestricted month goes unsaid in English.
 */
const scopedToMonths = (
  phrase: string,
  months: readonly number[] | undefined,
  scope: MonthScope,
  phrasing: Phrasing
) => {
  const options = { locale: phrasing.locale };
  if (months) {
    return m.emailCampaignsCalendarScopeMonths(
      {
        phrase,
        months: monthNames(
          months,
          m.emailCampaignsCalendarMonthInName,
          phrasing
        ),
      },
      options
    );
  }
  if (scope === "qualifier") {
    return m.emailCampaignsCalendarScopeQualifier({ phrase }, options);
  }
  return phrasing.usage === "schedule"
    ? m.emailCampaignsCalendarScopeEveryMonth({ phrase }, options)
    : m.emailCampaignsCalendarScopeAnyMonth({ phrase }, options);
};

/**
 * The day part: weekdays lead, and days of month or occurrences qualify them
 * ("every Friday that is the 13th"); otherwise occurrences lead days of
 * month. The months attach to the first day-of-month or occurrence phrase.
 */
const dayPhrase = (
  expression: CalendarExpression,
  phrasing: Phrasing
): string | undefined => {
  const { weekdays, daysOfMonth, weekdayOccurrences, months } = expression;
  const options = { locale: phrasing.locale };
  const monthBound = [
    weekdayOccurrences && occurrencesPhrase(weekdayOccurrences, phrasing),
    daysOfMonth && daysOfMonthPhrase(daysOfMonth, phrasing),
  ]
    .filter((phrase) => phrase !== undefined)
    .map((phrase, index) =>
      scopedToMonths(
        phrase,
        index === 0 ? months : undefined,
        index === 0 && !weekdays ? "subject" : "qualifier",
        phrasing
      )
    );
  const [lead, ...qualifiers] = weekdays
    ? [weekdaysPhrase(weekdays, monthBound.length > 0, phrasing), ...monthBound]
    : monthBound;
  if (lead === undefined) {
    return undefined;
  }
  if (qualifiers.length === 0) {
    return weekdays || phrasing.usage === "wait"
      ? lead
      : m.emailCampaignsCalendarScheduleOn({ subject: lead }, options);
  }
  const qualifier = listed(qualifiers, phrasing, "conjunction");
  return phrasing.usage === "schedule"
    ? m.emailCampaignsCalendarScheduleQualified(
        { subject: lead, qualifier },
        options
      )
    : m.emailCampaignsCalendarWaitQualified(
        { kind: weekdays ? "weekday" : "day", subject: lead, qualifier },
        options
      );
};

/** The time of day: "at 09:00 and 17:00", "between 10:00 and 10:59", …. */
const timePhrase = (
  expression: CalendarExpression,
  hasDayScope: boolean,
  phrasing: Phrasing
): string | undefined => {
  const { hours, minutes } = expression;
  const options = { locale: phrasing.locale };
  if (hours && minutes) {
    if (hours.length * minutes.length <= 6) {
      const times = hours.flatMap((hour) =>
        minutes.map((minute) => clockTime(hour, minute))
      );
      return m.emailCampaignsCalendarTimeAt(
        { times: listed(times, phrasing) },
        options
      );
    }
    return phrasing.usage === "schedule"
      ? m.emailCampaignsCalendarTimeMinutesPastHours(
          {
            minutes: minuteMarks(minutes, phrasing),
            hours: listed(hours.map(twoDigits), phrasing),
          },
          options
        )
      : [
          m.emailCampaignsCalendarTimeAt(
            { times: minuteMarks(minutes, phrasing) },
            options
          ),
          hoursWithin(hours, phrasing),
        ].join(" ");
  }
  if (hours) {
    return phrasing.usage === "schedule"
      ? m.emailCampaignsCalendarTimeAt(
          {
            times: listed(
              hours.map((hour) => clockTime(hour, 0)),
              phrasing
            ),
          },
          options
        )
      : hoursWithin(hours, phrasing);
  }
  if (minutes) {
    return phrasing.usage === "schedule" && hasDayScope
      ? m.emailCampaignsCalendarTimeEveryHourAt(
          { minutes: minuteMarks(minutes, phrasing) },
          options
        )
      : m.emailCampaignsCalendarTimeAt(
          { times: minuteMarks(minutes, phrasing) },
          options
        );
  }
  return phrasing.usage === "schedule"
    ? m.emailCampaignsCalendarTimeAt({ times: clockTime(0, 0) }, options)
    : undefined;
};

const weeksPart = (weeks: readonly number[], phrasing: Phrasing) =>
  m.emailCampaignsCalendarInWeeks(
    { count: listCount(weeks, phrasing), weeks: weekNumbers(weeks, phrasing) },
    { locale: phrasing.locale }
  );

/**
 * A schedule at ISO week or month grain fires at the period's first day:
 * "at the start of ISO week 1 (Monday) every year", "on 1 December every
 * year".
 */
const periodStartPhrase = (
  weeks: readonly number[] | undefined,
  months: readonly number[] | undefined,
  phrasing: Phrasing
) => {
  const options = { locale: phrasing.locale };
  if (weeks && months) {
    return m.emailCampaignsCalendarScheduleWeekMonthStart(
      {
        count: weeks.length,
        weeks: weekNumbers(weeks, phrasing),
        months: monthNames(
          months,
          m.emailCampaignsCalendarMonthName,
          phrasing,
          "disjunction"
        ),
      },
      options
    );
  }
  if (weeks) {
    return m.emailCampaignsCalendarScheduleWeekStart(
      { count: weeks.length, weeks: weekNumbers(weeks, phrasing) },
      options
    );
  }
  const [month, ...otherMonths] = months ?? [];
  return month !== undefined && otherMonths.length === 0
    ? m.emailCampaignsCalendarScheduleDate(
        {
          day: 1,
          month: m.emailCampaignsCalendarMonthOfName(
            { month: String(month) },
            options
          ),
        },
        options
      )
    : m.emailCampaignsCalendarScheduleMonthStart(
        {
          months: monthNames(
            months ?? [],
            m.emailCampaignsCalendarMonthOfName,
            phrasing
          ),
        },
        options
      );
};

/** One numbered day in one month reads as a date: "on 24 December every year". */
const datePhrase = (
  expression: CalendarExpression,
  phrasing: Phrasing
): string | undefined => {
  const { daysOfMonth, months, weekdays, weekdayOccurrences } = expression;
  const [day, ...otherDays] = daysOfMonth ?? [];
  const [month, ...otherMonths] = months ?? [];
  if (
    phrasing.usage !== "schedule" ||
    weekdays ||
    weekdayOccurrences ||
    day === undefined ||
    day === "last" ||
    month === undefined ||
    otherDays.length > 0 ||
    otherMonths.length > 0
  ) {
    return undefined;
  }
  const options = { locale: phrasing.locale };
  return m.emailCampaignsCalendarScheduleDate(
    {
      day,
      month: m.emailCampaignsCalendarMonthOfName(
        { month: String(month) },
        options
      ),
    },
    options
  );
};

/**
 * "in December", unless a day-of-month or occurrence phrase already carries
 * the months.
 */
const monthsPart = (expression: CalendarExpression, phrasing: Phrasing) =>
  expression.months && !expression.daysOfMonth && !expression.weekdayOccurrences
    ? m.emailCampaignsCalendarInMonths(
        {
          months: monthNames(
            expression.months,
            m.emailCampaignsCalendarMonthInName,
            phrasing
          ),
        },
        { locale: phrasing.locale }
      )
    : undefined;

const describeSchedule = (
  expression: CalendarExpression,
  phrasing: Phrasing
) => {
  const { weeksOfYear, months, hours, minutes } = expression;
  const options = { locale: phrasing.locale };
  const day =
    datePhrase(expression, phrasing) ?? dayPhrase(expression, phrasing);
  if (day === undefined && !hours && !minutes) {
    return [
      periodStartPhrase(weeksOfYear, months, phrasing),
      timePhrase(expression, true, phrasing),
    ].join(" ");
  }
  return [
    day ??
      (hours
        ? m.emailCampaignsCalendarEveryDay({}, options)
        : m.emailCampaignsCalendarEveryHour({}, options)),
    weeksOfYear && weeksPart(weeksOfYear, phrasing),
    monthsPart(expression, phrasing),
    timePhrase(expression, day !== undefined, phrasing),
  ]
    .filter(Boolean)
    .join(" ");
};

/** Where a wait's period is named: in the sentence, or as a step's label. */
type WaitForm = "sentence" | "label";

/**
 * A wait for a time of any day. A few exact times are listed ("10:15");
 * more read as minutes within hour windows ("the next :00 or :15 between
 * 09:00 and 11:59"). Hour windows read "it's between 10:00 and 10:59" in the
 * sentence and "10:00–10:59" in a label.
 */
const clockWaitTarget = (
  hours: readonly number[],
  minutes: readonly number[] | undefined,
  form: WaitForm,
  phrasing: Phrasing
): string => {
  const options = { locale: phrasing.locale };
  if (minutes) {
    return hours.length * minutes.length <= 6
      ? listed(
          hours.flatMap((hour) =>
            minutes.map((minute) => clockTime(hour, minute))
          ),
          phrasing
        )
      : [
          m.emailCampaignsCalendarWaitNextMinute(
            { minutes: minuteMarks(minutes, phrasing) },
            options
          ),
          hoursWithin(hours, phrasing),
        ].join(" ");
  }
  if (form === "label") {
    return hourSpans(hours, phrasing);
  }
  const [window, ...others] = hourWindows(hours);
  return m.emailCampaignsCalendarWaitClockWindow(
    {
      windows:
        window && others.length === 0
          ? m.emailCampaignsCalendarHourRange(window, options)
          : hourSpans(hours, phrasing),
    },
    options
  );
};

const describeWait = (
  expression: CalendarExpression,
  phrasing: Phrasing,
  form: WaitForm = "sentence"
) => {
  const { weeksOfYear, months, hours, minutes } = expression;
  const options = { locale: phrasing.locale };
  const day = dayPhrase(expression, phrasing);
  const time = timePhrase(expression, true, phrasing);
  if (day === undefined) {
    if (months) {
      const monthNamed = !weeksOfYear && !time;
      return [
        monthNamed
          ? monthNames(months, m.emailCampaignsCalendarMonthName, phrasing)
          : m.emailCampaignsCalendarWaitMonthDay(
              {
                months: monthNames(
                  months,
                  m.emailCampaignsCalendarMonthInName,
                  phrasing
                ),
              },
              options
            ),
        weeksOfYear && weeksPart(weeksOfYear, phrasing),
        time,
      ]
        .filter(Boolean)
        .join(" ");
    }
    if (weeksOfYear) {
      return time
        ? [
            m.emailCampaignsCalendarWaitDay({}, options),
            weeksPart(weeksOfYear, phrasing),
            time,
          ].join(" ")
        : m.emailCampaignsCalendarWaitWeeks(
            { weeks: weekNumbers(weeksOfYear, phrasing) },
            options
          );
    }
    if (hours) {
      return clockWaitTarget(hours, minutes, form, phrasing);
    }
    return minutes
      ? m.emailCampaignsCalendarWaitNextMinute(
          { minutes: minuteMarks(minutes, phrasing) },
          options
        )
      : m.emailCampaignsCalendarWaitTime({ time: time ?? "" }, options);
  }
  return [
    day,
    weeksOfYear && weeksPart(weeksOfYear, phrasing),
    monthsPart(expression, phrasing),
    time,
  ]
    .filter(Boolean)
    .join(" ");
};

/**
 * The expression as a sentence in `locale`. A schedule names each period's
 * start ("On 1 December every year at 00:00 (Prague time)"); a wait names
 * the period ("Waits until December (Prague time); continues at once if it's
 * already then").
 */
export const describeCalendarExpression = (
  expression: CalendarExpression,
  usage: CalendarExpressionUsage,
  locale: Locale
): string => {
  const phrasing = { usage, locale };
  return usage === "schedule"
    ? upperCaseFirst(
        m.emailCampaignsCalendarSchedule(
          { description: describeSchedule(expression, phrasing) },
          { locale }
        ),
        locale
      )
    : m.emailCampaignsCalendarWait(
        { target: describeWait(expression, phrasing) },
        { locale }
      );
};

/**
 * The period a calendar wait waits for, as a phrase in `locale` that names
 * the step, without the sentence `describeCalendarExpression` wraps it in.
 */
export const describeCalendarWaitTarget = (
  expression: CalendarExpression,
  locale: Locale
): string => describeWait(expression, { usage: "wait", locale }, "label");
