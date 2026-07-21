import { getLocale } from "@/features/i18n";
import { siteConstants } from "@/shared/utils/constants";

type TimeOfDay = { hrs: number; mins: number };
type DayHours = { open: TimeOfDay; close: TimeOfDay };

/**
 * Format time of day to string representation using Intl API
 * The TimeOfDay values represent the actual display time (already in Prague timezone)
 * We need to create a fixed reference date to avoid timezone conversion issues
 */
function formatTime(time: TimeOfDay): string {
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
function formatDayHours(dayHours: DayHours): string {
  const open = formatTime(dayHours.open);
  const close = formatTime(dayHours.close);
  return `${open} - ${close}`;
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
