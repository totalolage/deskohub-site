import { getLocale } from "@/features/i18n";
import { siteConstants } from "@/shared/utils/constants";

type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type TimeObject = { hrs: number; mins: number };
type DayHours = { open: TimeObject; close: TimeObject };

/**
 * Format time object to string representation using Intl API
 * The TimeObject values represent the actual display time (already in Prague timezone)
 * We need to create a fixed reference date to avoid timezone conversion issues
 */
export function formatTime(time: TimeObject): string {
  // Create a fixed UTC date with our time values
  // Using UTC ensures no local timezone conversion happens
  // The year/month/day don't matter since we only format hours/minutes
  const fixedDate = new Date(Date.UTC(2024, 0, 1, time.hrs, time.mins, 0));

  // Format using Intl API with UTC timezone to prevent conversion
  // This gives us locale-aware formatting while preserving the exact hours
  const formatter = new Intl.DateTimeFormat(getLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC", // Use UTC to prevent any timezone conversion
  });

  return formatter.format(fixedDate);
}

/**
 * Format day hours to string representation using Intl API
 */
export function formatDayHours(dayHours: DayHours): string {
  const open = formatTime(dayHours.open);
  const close = formatTime(dayHours.close);
  return `${open} - ${close}`;
}

/**
 * Get working hours for a specific day
 */
export function getWorkingHoursForDay(day: DayOfWeek): DayHours {
  return siteConstants.workingHours.hours[day];
}

/**
 * Get formatted working hours for weekdays (Monday-Friday)
 */
export function getWeekdayHours(): {
  open: string;
  close: string;
  formatted: string;
} {
  // Assuming all weekdays have the same hours (which they do in the current setup)
  const mondayHours = siteConstants.workingHours.hours[1];
  return {
    open: formatTime(mondayHours.open),
    close: formatTime(mondayHours.close),
    formatted: formatDayHours(mondayHours),
  };
}

/**
 * Get formatted working hours for weekends (Saturday-Sunday)
 */
export function getWeekendHours(): {
  open: string;
  close: string;
  formatted: string;
} {
  // Assuming both weekend days have the same hours (which they do in the current setup)
  const saturdayHours = siteConstants.workingHours.hours[6];
  return {
    open: formatTime(saturdayHours.open),
    close: formatTime(saturdayHours.close),
    formatted: formatDayHours(saturdayHours),
  };
}

/**
 * Check if a day is a weekend day
 */
export function isWeekend(day: DayOfWeek): boolean {
  return day === 0 || day === 6;
}

/**
 * Get list of days for weekdays
 */
export function getWeekdaysList(): DayOfWeek[] {
  return [1, 2, 3, 4, 5];
}

/**
 * Get list of days for weekends
 */
export function getWeekendsList(): DayOfWeek[] {
  return [0, 6];
}

/**
 * Convert time string to TimeObject
 */
export function parseTimeString(timeStr: string): TimeObject {
  const [hrs, mins] = timeStr.split(":").map(Number);
  return { hrs: hrs ?? 0, mins: mins ?? 0 };
}

/**
 * Convert TimeObject to minutes since midnight
 */
export function timeToMinutes(time: TimeObject): number {
  return time.hrs * 60 + time.mins;
}

/**
 * Check if a specific time is within working hours for a day
 */
export function isTimeWithinWorkingHours(
  day: DayOfWeek,
  time: TimeObject
): boolean {
  const dayHours = getWorkingHoursForDay(day);
  const timeInMinutes = timeToMinutes(time);
  const openInMinutes = timeToMinutes(dayHours.open);
  const closeInMinutes = timeToMinutes(dayHours.close);

  return timeInMinutes >= openInMinutes && timeInMinutes < closeInMinutes;
}
