import { describe, expect, test } from "bun:test";
import type { CalendarExpressionType as CalendarExpression } from "@deskohub/workspace-admin-api";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import {
  type CalendarExpressionUsage,
  describeCalendarExpression,
  describeCalendarWaitTarget,
} from "./calendar-expression-phrases";

interface Row {
  readonly expression: CalendarExpression;
  readonly schedule: { readonly en: string; readonly cs: string };
  readonly wait?: { readonly en: string; readonly cs: string };
}

const englishWait = (target: string) =>
  `Waits until ${target} (Prague time); continues at once if it's already then`;
const czechWait = (target: string) =>
  `Počká na ${target} (pražský čas); pokud ten čas už nastal, pokračuje hned`;

/** The rows of the design's rendering table. */
const rows: readonly Row[] = [
  {
    expression: { weekdays: ["monday"], hours: [10] },
    schedule: {
      en: "Every Monday at 10:00 (Prague time)",
      cs: "Každé pondělí v 10:00 (pražský čas)",
    },
    wait: {
      en: englishWait("Monday between 10:00 and 10:59"),
      cs: czechWait("pondělí mezi 10:00 a 10:59"),
    },
  },
  {
    expression: { hours: [10] },
    schedule: {
      en: "Every day at 10:00 (Prague time)",
      cs: "Každý den v 10:00 (pražský čas)",
    },
    wait: {
      en: englishWait("it's between 10:00 and 10:59"),
      cs: czechWait("dobu mezi 10:00 a 10:59"),
    },
  },
  {
    expression: { minutes: [0, 30] },
    schedule: {
      en: "Every hour at :00 and :30 (Prague time)",
      cs: "Každou hodinu v xx:00 a\u00a0xx:30 (pražský čas)",
    },
    wait: {
      en: englishWait("the next :00 or :30"),
      cs: czechWait("nejbližší xx:00 nebo xx:30"),
    },
  },
  {
    expression: { months: [12] },
    schedule: {
      en: "On 1 December every year at 00:00 (Prague time)",
      cs: "Každý rok 1. prosince v 00:00 (pražský čas)",
    },
    wait: { en: englishWait("December"), cs: czechWait("prosinec") },
  },
  {
    expression: { months: [1, 7] },
    schedule: {
      en: "On the first day of January and July every year at 00:00 (Prague time)",
      cs: "Každý rok první den ledna a\u00a0července v 00:00 (pražský čas)",
    },
    wait: {
      en: englishWait("January or July"),
      cs: czechWait("leden nebo červenec"),
    },
  },
  {
    expression: { weeksOfYear: [1] },
    schedule: {
      en: "At the start of ISO week 1 (Monday) every year at 00:00 (Prague time)",
      cs: "Každý rok na začátku 1. kalendářního týdne (v pondělí) v 00:00 (pražský čas)",
    },
    wait: {
      en: englishWait("ISO week 1"),
      cs: czechWait("1. kalendářní týden"),
    },
  },
  {
    expression: { weeksOfYear: [1], months: [1] },
    schedule: {
      en: "On the first day of ISO week 1 that falls in January, every year at 00:00 (Prague time)",
      cs: "Každý rok první den 1. kalendářního týdne připadající na leden v 00:00 (pražský čas)",
    },
    wait: {
      en: englishWait("a January day in ISO week 1"),
      cs: czechWait("den v lednu v 1. kalendářním týdnu"),
    },
  },
  {
    expression: { months: [12], hours: [9] },
    schedule: {
      en: "Every day in December at 09:00 (Prague time)",
      cs: "Každý den v prosinci v 09:00 (pražský čas)",
    },
    wait: {
      en: englishWait("a December day between 09:00 and 09:59"),
      cs: czechWait("den v prosinci mezi 09:00 a 09:59"),
    },
  },
  {
    expression: { daysOfMonth: [1], hours: [9], minutes: [30] },
    schedule: {
      en: "On the 1st of every month at 09:30 (Prague time)",
      cs: "1. den v měsíci v 09:30 (pražský čas)",
    },
  },
  {
    expression: {
      weekdayOccurrences: [{ occurrence: 2, weekday: "tuesday" }],
      hours: [18],
    },
    schedule: {
      en: "On the 2nd Tuesday of every month at 18:00 (Prague time)",
      cs: "2. úterý v měsíci v 18:00 (pražský čas)",
    },
  },
  {
    expression: { daysOfMonth: ["last"], hours: [17] },
    schedule: {
      en: "On the last day of every month at 17:00 (Prague time)",
      cs: "Poslední den v měsíci v 17:00 (pražský čas)",
    },
  },
  {
    expression: { weekdays: ["friday"], daysOfMonth: [13] },
    schedule: {
      en: "On every Friday that is the 13th at 00:00 (Prague time)",
      cs: "Každý pátek připadající na 13. den v měsíci v 00:00 (pražský čas)",
    },
    wait: {
      en: englishWait("a Friday the 13th"),
      cs: czechWait("pátek připadající na 13. den v měsíci"),
    },
  },
  {
    expression: { weeksOfYear: [1], weekdays: ["monday"], hours: [8] },
    schedule: {
      en: "Every Monday in ISO week 1 at 08:00 (Prague time)",
      cs: "Každé pondělí v 1. kalendářním týdnu v 08:00 (pražský čas)",
    },
  },
  {
    expression: { months: [12], daysOfMonth: [24], hours: [18] },
    schedule: {
      en: "On 24 December every year at 18:00 (Prague time)",
      cs: "Každý rok 24. prosince v 18:00 (pražský čas)",
    },
  },
  {
    expression: {
      weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      hours: [9, 17],
    },
    schedule: {
      en: "Every weekday at 09:00 and 17:00 (Prague time)",
      cs: "Každý pracovní den v 09:00 a\u00a017:00 (pražský čas)",
    },
  },
];

const cases = (usage: CalendarExpressionUsage) =>
  rows.flatMap(({ expression, schedule, wait }) => {
    const expected = usage === "schedule" ? schedule : wait;
    return expected
      ? [
          { expression, locale: "en-US" as const, sentence: expected.en },
          { expression, locale: "cs-CZ" as const, sentence: expected.cs },
        ]
      : [];
  });

describe("describeCalendarExpression", () => {
  test.each(cases("schedule"))(
    "schedules $expression in $locale",
    ({ expression, locale, sentence }) => {
      expect(describeCalendarExpression(expression, "schedule", locale)).toBe(
        sentence
      );
    }
  );

  test.each(cases("wait"))(
    "waits for $expression in $locale",
    ({ expression, locale, sentence }) => {
      expect(describeCalendarExpression(expression, "wait", locale)).toBe(
        sentence
      );
    }
  );

  test("lists several weeks, days and occurrences", () => {
    const expression: CalendarExpression = {
      weekdayOccurrences: [
        { occurrence: 1, weekday: "wednesday" },
        { occurrence: "last", weekday: "sunday" },
      ],
      months: [3, 11],
      hours: [7],
    };
    expect(describeCalendarExpression(expression, "schedule", "en-US")).toBe(
      "On the 1st Wednesday and last Sunday of March and November at 07:00 (Prague time)"
    );
    expect(describeCalendarExpression(expression, "schedule", "cs-CZ")).toBe(
      "1. středa a\u00a0poslední neděle v březnu a\u00a0listopadu v 07:00 (pražský čas)"
    );
    expect(describeCalendarExpression(expression, "wait", "cs-CZ")).toBe(
      czechWait(
        "1. středu nebo poslední neděli v březnu nebo listopadu mezi 07:00 a 07:59"
      )
    );
    expect(
      describeCalendarExpression(
        { weeksOfYear: [1, 27], weekdays: ["saturday", "sunday"] },
        "schedule",
        "cs-CZ"
      )
    ).toBe(
      "Každý víkendový den v 1. a\u00a027. kalendářních týdnech v 00:00 (pražský čas)"
    );
    expect(
      describeCalendarExpression(
        { daysOfMonth: [1, 15, "last"], weekdays: ["monday", "wednesday"] },
        "schedule",
        "en-US"
      )
    ).toBe(
      "On every Monday and Wednesday that is the 1st, 15th, and last day at 00:00 (Prague time)"
    );
  });

  test("names many minute and hour combinations compactly", () => {
    const expression: CalendarExpression = {
      hours: [9, 10, 11],
      minutes: [0, 15, 30],
    };
    expect(describeCalendarExpression(expression, "schedule", "en-US")).toBe(
      "Every day at :00, :15, and :30 past 09, 10, and 11 (Prague time)"
    );
    expect(describeCalendarExpression(expression, "schedule", "cs-CZ")).toBe(
      "Každý den v hodinách 09, 10 a\u00a011 vždy v xx:00, xx:15 a\u00a0xx:30 (pražský čas)"
    );
  });
});

describe("wait hour windows", () => {
  const locales: readonly Locale[] = ["en-US", "cs-CZ"];
  const window = (first: number, last: number) => ({
    start: `${String(first).padStart(2, "0")}:00`,
    end: `${String(last).padStart(2, "0")}:59`,
  });
  const span = (first: number, last: number, locale: Locale) =>
    m.emailCampaignsCalendarHourSpan(window(first, last), { locale });
  const range = (first: number, last: number, locale: Locale) =>
    m.emailCampaignsCalendarHourRange(window(first, last), { locale });
  const alternatives = (items: readonly string[], locale: Locale) =>
    new Intl.ListFormat(locale, { type: "disjunction" }).format(items);

  test.each(locales)(
    "merges consecutive hours into one window (%s)",
    (locale) => {
      expect(describeCalendarWaitTarget({ hours: [11, 9, 10] }, locale)).toBe(
        span(9, 11, locale)
      );
    }
  );

  test.each(locales)(
    "keeps separate runs as separate windows (%s)",
    (locale) => {
      expect(
        describeCalendarWaitTarget({ hours: [8, 9, 14, 20] }, locale)
      ).toBe(
        alternatives(
          [span(8, 9, locale), span(14, 14, locale), span(20, 20, locale)],
          locale
        )
      );
    }
  );

  test.each(locales)(
    "names one merged window in the sentence (%s)",
    (locale) => {
      const sentence = describeCalendarExpression(
        { hours: [9, 10, 11] },
        "wait",
        locale
      );
      expect(sentence).toContain(range(9, 11, locale));
      expect(sentence).not.toContain(range(10, 10, locale));
    }
  );

  test.each(locales)(
    "lists several windows once each in the sentence (%s)",
    (locale) => {
      const sentence = describeCalendarExpression(
        { weekdays: ["monday"], hours: [8, 9, 14, 15, 20] },
        "wait",
        locale
      );
      const spans = [
        span(8, 9, locale),
        span(14, 15, locale),
        span(20, 20, locale),
      ];
      expect(sentence).toContain(alternatives(spans, locale));
      expect(sentence).not.toContain(range(8, 9, locale));
    }
  );

  test.each(locales)(
    "names many hour and minute combinations by their windows (%s)",
    (locale) => {
      const expression: CalendarExpression = {
        hours: [9, 10, 11, 12],
        minutes: [0, 15],
      };
      for (const target of [
        describeCalendarExpression(expression, "wait", locale),
        describeCalendarWaitTarget(expression, locale),
      ]) {
        expect(target).toContain(range(9, 12, locale));
        expect(target).toContain(
          alternatives(
            ["00", "15"].map((minute) =>
              m.emailCampaignsCalendarMinute({ minute }, { locale })
            ),
            locale
          )
        );
        expect(target).not.toContain("09:15");
      }
      expect(
        describeCalendarExpression(
          { ...expression, weekdays: ["monday"] },
          "wait",
          locale
        )
      ).toContain(range(9, 12, locale));
    }
  );

  test.each(locales)("merges hours in a month-scoped wait (%s)", (locale) => {
    const sentence = describeCalendarExpression(
      { months: [12], hours: [9, 10, 11] },
      "wait",
      locale
    );
    expect(sentence).toContain(range(9, 11, locale));
    expect(sentence).not.toContain(range(10, 10, locale));
  });
});
