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

/**
 * Where an occurrence sits in a schedule: leading the day part ("the last
 * Wednesday of every month") or qualifying weekdays ("every Wednesday that
 * is the last Wednesday"). Languages put the two in different cases.
 */
type OccurrencePlace = "lead" | "qualifier";

/**
 * One occurrence, agreeing with its weekday's gender and its place: "last
 * Wednesday", "2nd Tuesday".
 */
const occurrencePhrase = (
  { occurrence, weekday }: CalendarWeekdayOccurrence,
  place: OccurrencePlace,
  { usage, locale }: Phrasing
) => {
  const options = { locale };
  if (usage === "wait") {
    return occurrence === "last"
      ? m.emailCampaignsCalendarLastOccurrenceWait({ weekday }, options)
      : m.emailCampaignsCalendarOccurrence(
          {
            occurrence,
            weekday: m.emailCampaignsCalendarWeekdayWaitName(
              { weekday },
              options
            ),
          },
          options
        );
  }
  if (occurrence === "last") {
    return place === "lead"
      ? m.emailCampaignsCalendarLastOccurrence({ weekday }, options)
      : m.emailCampaignsCalendarLastOccurrenceQualifier({ weekday }, options);
  }
  return m.emailCampaignsCalendarOccurrence(
    {
      occurrence,
      weekday:
        place === "lead"
          ? m.emailCampaignsCalendarWeekdayName({ weekday }, options)
          : m.emailCampaignsCalendarWeekdayQualifierName({ weekday }, options),
    },
    options
  );
};

/** "the 2nd Tuesday and last Friday" (unscoped). */
const occurrencesPhrase = (
  occurrences: readonly CalendarWeekdayOccurrence[],
  place: OccurrencePlace,
  phrasing: Phrasing
) =>
  m.emailCampaignsCalendarOccurrences(
    {
      occurrences: listed(
        occurrences.map((occurrence) =>
          occurrencePhrase(occurrence, place, phrasing)
        ),
        phrasing
      ),
    },
    { locale: phrasing.locale }
  );

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
 * The day-of-month and occurrence phrases, occurrences first. The first one
 * carries the months, and leads the day part unless weekdays do.
 */
const monthBoundPhrases = (
  expression: CalendarExpression,
  phrasing: Phrasing
) => {
  const { weekdays, daysOfMonth, weekdayOccurrences, months } = expression;
  return [
    weekdayOccurrences &&
      occurrencesPhrase(
        weekdayOccurrences,
        weekdays ? "qualifier" : "lead",
        phrasing
      ),
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
};

/**
 * A day part with nothing qualifying its lead. A schedule led by a day of
 * month or an occurrence says "on" before it.
 */
const unqualifiedDayPhrase = (
  lead: string,
  weekdayLed: boolean,
  phrasing: Phrasing
) =>
  weekdayLed || phrasing.usage === "wait"
    ? lead
    : m.emailCampaignsCalendarScheduleOn(
        { subject: lead },
        { locale: phrasing.locale }
      );

/** A lead with its qualifiers: "every Friday that is the 13th". */
const qualifiedDayPhrase = (
  lead: string,
  qualifiers: readonly string[],
  weekdayLed: boolean,
  phrasing: Phrasing
) => {
  const options = { locale: phrasing.locale };
  const qualifier = listed(qualifiers, phrasing, "conjunction");
  return phrasing.usage === "schedule"
    ? m.emailCampaignsCalendarScheduleQualified(
        { subject: lead, qualifier },
        options
      )
    : m.emailCampaignsCalendarWaitQualified(
        { kind: weekdayLed ? "weekday" : "day", subject: lead, qualifier },
        options
      );
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
  const { weekdays } = expression;
  const monthBound = monthBoundPhrases(expression, phrasing);
  const [lead, ...qualifiers] = weekdays
    ? [weekdaysPhrase(weekdays, monthBound.length > 0, phrasing), ...monthBound]
    : monthBound;
  if (lead === undefined) {
    return undefined;
  }
  const weekdayLed = weekdays !== undefined;
  return qualifiers.length === 0
    ? unqualifiedDayPhrase(lead, weekdayLed, phrasing)
    : qualifiedDayPhrase(lead, qualifiers, weekdayLed, phrasing);
};

/**
 * Hours with minutes: a few exact times ("at 09:15 and 17:15"), or more as
 * minutes past hours in a schedule and minutes within hour windows in a wait.
 */
const hoursAndMinutesPhrase = (
  hours: readonly number[],
  minutes: readonly number[],
  phrasing: Phrasing
) => {
  const options = { locale: phrasing.locale };
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
};

/** Hours alone: on the hour in a schedule, within the hours in a wait. */
const hoursPhrase = (hours: readonly number[], phrasing: Phrasing) =>
  phrasing.usage === "schedule"
    ? m.emailCampaignsCalendarTimeAt(
        {
          times: listed(
            hours.map((hour) => clockTime(hour, 0)),
            phrasing
          ),
        },
        { locale: phrasing.locale }
      )
    : hoursWithin(hours, phrasing);

/** Minutes alone: "every hour at :15" behind a schedule's day, else "at :15". */
const minutesPhrase = (
  minutes: readonly number[],
  hasDayScope: boolean,
  phrasing: Phrasing
) => {
  const options = { locale: phrasing.locale };
  return phrasing.usage === "schedule" && hasDayScope
    ? m.emailCampaignsCalendarTimeEveryHourAt(
        { minutes: minuteMarks(minutes, phrasing) },
        options
      )
    : m.emailCampaignsCalendarTimeAt(
        { times: minuteMarks(minutes, phrasing) },
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
  if (hours && minutes) {
    return hoursAndMinutesPhrase(hours, minutes, phrasing);
  }
  if (hours) {
    return hoursPhrase(hours, phrasing);
  }
  if (minutes) {
    return minutesPhrase(minutes, hasDayScope, phrasing);
  }
  return phrasing.usage === "schedule"
    ? m.emailCampaignsCalendarTimeAt(
        { times: clockTime(0, 0) },
        { locale: phrasing.locale }
      )
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

/** The day and month of an expression naming one numbered day in one month. */
const singleDate = ({ daysOfMonth, months }: CalendarExpression) => {
  const [day, ...otherDays] = daysOfMonth ?? [];
  const [month, ...otherMonths] = months ?? [];
  const single = otherDays.length === 0 && otherMonths.length === 0;
  return single && day !== undefined && day !== "last" && month !== undefined
    ? { day, month }
    : undefined;
};

/** One numbered day in one month reads as a date: "on 24 December every year". */
const datePhrase = (
  expression: CalendarExpression,
  phrasing: Phrasing
): string | undefined => {
  const date = singleDate(expression);
  if (
    phrasing.usage !== "schedule" ||
    expression.weekdays ||
    expression.weekdayOccurrences ||
    date === undefined
  ) {
    return undefined;
  }
  const options = { locale: phrasing.locale };
  return m.emailCampaignsCalendarScheduleDate(
    {
      day: date.day,
      month: m.emailCampaignsCalendarMonthOfName(
        { month: String(date.month) },
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

/**
 * A wait for months with no day: "December" alone, else "a December day"
 * with its weeks and time.
 */
const monthsWaitTarget = (
  months: readonly number[],
  weeksOfYear: readonly number[] | undefined,
  time: string | undefined,
  phrasing: Phrasing
) => {
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
          { locale: phrasing.locale }
        ),
    weeksOfYear && weeksPart(weeksOfYear, phrasing),
    time,
  ]
    .filter(Boolean)
    .join(" ");
};

/** A wait for ISO weeks with no day or month: "ISO week 1", or a day in it at a time. */
const weeksWaitTarget = (
  weeksOfYear: readonly number[],
  time: string | undefined,
  phrasing: Phrasing
) => {
  const options = { locale: phrasing.locale };
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
};

/** A wait naming no day: for months, ISO weeks, a clock time, or a minute. */
const waitTargetWithoutDay = (
  expression: CalendarExpression,
  time: string | undefined,
  form: WaitForm,
  phrasing: Phrasing
) => {
  const { weeksOfYear, months, hours, minutes } = expression;
  if (months) {
    return monthsWaitTarget(months, weeksOfYear, time, phrasing);
  }
  if (weeksOfYear) {
    return weeksWaitTarget(weeksOfYear, time, phrasing);
  }
  if (hours) {
    return clockWaitTarget(hours, minutes, form, phrasing);
  }
  const options = { locale: phrasing.locale };
  return minutes
    ? m.emailCampaignsCalendarWaitNextMinute(
        { minutes: minuteMarks(minutes, phrasing) },
        options
      )
    : m.emailCampaignsCalendarWaitTime({ time: time ?? "" }, options);
};

const describeWait = (
  expression: CalendarExpression,
  phrasing: Phrasing,
  form: WaitForm = "sentence"
) => {
  const { weeksOfYear } = expression;
  const day = dayPhrase(expression, phrasing);
  const time = timePhrase(expression, true, phrasing);
  if (day === undefined) {
    return waitTargetWithoutDay(expression, time, form, phrasing);
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
