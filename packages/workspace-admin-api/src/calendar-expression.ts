import { Array as Arr, Order, Schema } from "effect";

/** Days of the week in ISO order, Monday first. */
export const calendarWeekdays = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export const CalendarWeekday = Schema.Literals(calendarWeekdays);
export type CalendarWeekday = typeof CalendarWeekday.Type;

/** Listed values: at least one, each once, at most `max`. */
const valueList = <S extends Schema.Top>(item: S, max: number) =>
  Schema.NonEmptyArray(item).check(
    Schema.isMaxLength(max),
    Schema.isUnique({ description: "List each value once." })
  );

const integerBetween = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ minimum, maximum }));

const CalendarDayOfMonth = Schema.Union([
  integerBetween(1, 31),
  Schema.Literal("last"),
]);
export type CalendarDayOfMonth = typeof CalendarDayOfMonth.Type;

/** The nth (or last) given weekday of a month, such as its 2nd Tuesday. */
const CalendarWeekdayOccurrence = Schema.Struct({
  occurrence: Schema.Union([integerBetween(1, 5), Schema.Literal("last")]),
  weekday: CalendarWeekday,
});
export type CalendarWeekdayOccurrence = typeof CalendarWeekdayOccurrence.Type;

/**
 * An "X of Ys" recurrence in Prague time. Each field is one row: values
 * within a field are alternatives, and every given field must match. A
 * missing field matches anything. The expression denotes periods of its
 * finest given field (minute, hour, day, ISO week or month); a schedule fires
 * at the start of each period, and a wait holds while one lasts.
 */
export const CalendarExpression = Schema.Struct({
  /**
   * Minute of the hour. A schedule trigger may list only the engine's tick
   * minutes (`scheduleMinutesOffTick`); a wait may list any.
   */
  minutes: Schema.optionalKey(valueList(integerBetween(0, 59), 60)),
  /** Hour of the day. */
  hours: Schema.optionalKey(valueList(integerBetween(0, 23), 24)),
  /** Day of the week. */
  weekdays: Schema.optionalKey(valueList(CalendarWeekday, 7)),
  /** Day of the month, or its last day. */
  daysOfMonth: Schema.optionalKey(valueList(CalendarDayOfMonth, 32)),
  /** Nth weekday of the month. */
  weekdayOccurrences: Schema.optionalKey(
    valueList(CalendarWeekdayOccurrence, 35)
  ),
  /** ISO 8601 week of the year. */
  weeksOfYear: Schema.optionalKey(valueList(integerBetween(1, 53), 53)),
  /** Month of the year. */
  months: Schema.optionalKey(valueList(integerBetween(1, 12), 12)),
})
  .check(
    Schema.makeFilter((expression) => Object.keys(expression).length > 0, {
      description: "Choose at least one part.",
    })
  )
  .annotate({
    identifier: "CalendarExpression",
    description:
      "Prague-time recurrence: within a part any listed value matches; all given parts must match.",
  });
export type CalendarExpression = typeof CalendarExpression.Type;

const weekdayOrder = Order.mapInput(Order.Number, (weekday: CalendarWeekday) =>
  calendarWeekdays.indexOf(weekday)
);

/** Numbered days first, then the last day. */
const dayOfMonthOrder = Order.mapInput(
  Order.Number,
  (day: CalendarDayOfMonth) => (day === "last" ? 32 : day)
);

const occurrenceOrder = Order.combine(
  Order.mapInput(Order.Number, ({ occurrence }: CalendarWeekdayOccurrence) =>
    occurrence === "last" ? 6 : occurrence
  ),
  Order.mapInput(
    weekdayOrder,
    ({ weekday }: CalendarWeekdayOccurrence) => weekday
  )
);

/**
 * The expression as stored: fields in schema order and values ascending
 * (weekdays in ISO order, the last day after numbered days), so equal
 * expressions serialize, and hash, identically.
 */
export const canonicalCalendarExpression = (
  expression: CalendarExpression
): CalendarExpression => ({
  ...(expression.minutes && {
    minutes: Arr.sort(expression.minutes, Order.Number),
  }),
  ...(expression.hours && { hours: Arr.sort(expression.hours, Order.Number) }),
  ...(expression.weekdays && {
    weekdays: Arr.sort(expression.weekdays, weekdayOrder),
  }),
  ...(expression.daysOfMonth && {
    daysOfMonth: Arr.sort(expression.daysOfMonth, dayOfMonthOrder),
  }),
  ...(expression.weekdayOccurrences && {
    weekdayOccurrences: Arr.sort(
      expression.weekdayOccurrences,
      occurrenceOrder
    ),
  }),
  ...(expression.weeksOfYear && {
    weeksOfYear: Arr.sort(expression.weeksOfYear, Order.Number),
  }),
  ...(expression.months && {
    months: Arr.sort(expression.months, Order.Number),
  }),
});
