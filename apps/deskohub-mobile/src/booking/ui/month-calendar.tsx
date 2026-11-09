import type { CustomerLocale } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { theme } from "../../theme";
import { Text } from "../../ui/text";
import type { DateChoice } from "../selection/booking-selection";
import {
  addMonthsToMonth,
  type PragueDate,
  type PragueMonth,
} from "../selection/prague-date";
import {
  type CalendarDay,
  initialCalendarMonth,
  monthCalendarModel,
} from "./month-calendar-model";

// Noon UTC on the calendar date, formatted in UTC, names the same day in
// every device time zone.
const utcNoon = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day, 12));

const monthTitle = ({ year, month }: PragueMonth, locale: CustomerLocale) => {
  const title = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcNoon(year, month, 1));
  return title.charAt(0).toLocaleUpperCase(locale) + title.slice(1);
};

// 1 January 2024 is a Monday, so its week names the weekdays Monday first.
const weekdayNames = (locale: CustomerLocale) => {
  const format = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    timeZone: "UTC",
  });
  return Array.from({ length: 7 }, (_, index) =>
    format.format(utcNoon(2024, 1, 1 + index))
  );
};

// A week's cells sit in fixed Monday-first columns, which key them.
const weekdayColumns = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// Every week holds at least one day of the month; its first names the week.
const weekKey = (week: ReadonlyArray<Option.Option<CalendarDay>>) =>
  week.flatMap(Option.toArray)[0]?.date ?? "";

/**
 * A month of dates to pick one from, Monday first. It pages between the
 * months the dates span and follows the selection to its month.
 */
export function MonthCalendar({
  label,
  locale,
  dates,
  selected,
  onSelect,
  previousMonthLabel,
  nextMonthLabel,
  unavailableLabel,
  disabled = false,
}: {
  /** Names the calendar for assistive technology. */
  readonly label: string;
  readonly locale: CustomerLocale;
  readonly dates: DateChoice;
  readonly selected: PragueDate | undefined;
  readonly onSelect: (date: PragueDate) => void;
  readonly previousMonthLabel: string;
  readonly nextMonthLabel: string;
  /** Follows an unavailable day's date for assistive technology. */
  readonly unavailableLabel: string;
  readonly disabled?: boolean;
}) {
  const [shownMonth, setShownMonth] = useState(() =>
    initialCalendarMonth(dates, selected)
  );
  const [followedSelection, setFollowedSelection] = useState(selected);
  if (selected !== followedSelection) {
    setFollowedSelection(selected);
    if (selected !== undefined) {
      setShownMonth(initialCalendarMonth(dates, selected));
    }
  }

  const calendar = monthCalendarModel({ month: shownMonth, dates, selected });
  const dayName = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const dayLabel = ({ date, state }: CalendarDay) => {
    const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
    const name = dayName.format(utcNoon(year, month, day));
    return state === "unavailable" ? `${name}, ${unavailableLabel}` : name;
  };
  const weekdays = weekdayNames(locale);
  const page = (months: number) =>
    setShownMonth(addMonthsToMonth(calendar.month, months));

  return (
    <View role="group" aria-label={label} style={styles.calendar}>
      <View style={styles.header}>
        <PageButton
          label={previousMonthLabel}
          glyph="‹"
          disabled={disabled || !calendar.canGoPrevious}
          onPress={() => page(-1)}
        />
        <Text aria-live="polite" style={styles.title}>
          {monthTitle(calendar.month, locale)}
        </Text>
        <PageButton
          label={nextMonthLabel}
          glyph="›"
          disabled={disabled || !calendar.canGoNext}
          onPress={() => page(1)}
        />
      </View>
      <View aria-hidden style={styles.week}>
        {weekdayColumns.map((column, columnIndex) => (
          <Text key={column} style={styles.weekday}>
            {weekdays[columnIndex]}
          </Text>
        ))}
      </View>
      {calendar.weeks.map((week) => (
        <View key={weekKey(week)} style={styles.week}>
          {weekdayColumns.map((column, columnIndex) => {
            const cell = week[columnIndex] ?? Option.none();
            if (Option.isNone(cell)) {
              return <View key={column} style={styles.cell} />;
            }
            const day = cell.value;
            const isSelected = day.state === "selected";
            const isDisabled =
              disabled || (day.state !== "available" && !isSelected);
            return (
              <Pressable
                key={column}
                role="button"
                aria-label={dayLabel(day)}
                aria-selected={isSelected}
                aria-disabled={isDisabled}
                disabled={isDisabled}
                onPress={() => onSelect(day.date)}
                style={({ pressed }) => [
                  styles.cell,
                  styles.day,
                  pressed && !isDisabled && styles.pressed,
                  isSelected && styles.selectedDay,
                  day.state === "outside-range" && styles.outsideRange,
                  disabled && styles.inert,
                ]}
              >
                <Text
                  style={[
                    styles.dayNumber,
                    isSelected && styles.selectedDayNumber,
                    day.state === "unavailable" && styles.unavailableDayNumber,
                  ]}
                >
                  {day.day}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function PageButton({
  label,
  glyph,
  disabled,
  onPress,
}: {
  readonly label: string;
  readonly glyph: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      role="button"
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pageButton,
        pressed && !disabled && styles.pressed,
        disabled && styles.pageButtonDisabled,
      ]}
    >
      <Text aria-hidden style={styles.pageGlyph}>
        {glyph}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  calendar: { gap: theme.spacing.xs },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.xs,
  },
  title: {
    ...theme.type.body,
    flex: 1,
    fontWeight: "600",
    textAlign: "center",
    color: theme.colors.text,
  },
  pageButton: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.md,
  },
  pageButtonDisabled: { opacity: 0.3 },
  pageGlyph: { ...theme.type.heading, color: theme.colors.text },
  week: { flexDirection: "row", gap: theme.spacing.xs },
  weekday: {
    ...theme.type.caption,
    flex: 1,
    textAlign: "center",
    color: theme.colors.textMuted,
  },
  cell: { flex: 1, aspectRatio: 1, minHeight: theme.touchTarget },
  day: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.md,
  },
  selectedDay: { backgroundColor: theme.colors.accent },
  pressed: { backgroundColor: theme.colors.surfacePressed },
  outsideRange: { opacity: 0.3 },
  inert: { opacity: 0.5 },
  dayNumber: {
    ...theme.type.body,
    color: theme.colors.text,
    fontVariant: ["tabular-nums"],
  },
  selectedDayNumber: { fontWeight: "700", color: theme.colors.background },
  unavailableDayNumber: {
    color: theme.colors.textMuted,
    textDecorationLine: "line-through",
  },
});
