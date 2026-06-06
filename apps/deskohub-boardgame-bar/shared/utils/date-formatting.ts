import { m } from "@/features/i18n";
import { siteConstants } from "@/shared/utils/constants";

/**
 * Format a date consistently between server and client
 * Always uses the restaurant's timezone to avoid hydration mismatches
 */
export function formatDate(
  date: Date | string,
  locale: string,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;

  // Always use explicit timezone to ensure consistency
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: siteConstants.workingHours.timezone,
    ...options,
  });

  return formatter.format(dateObj);
}

/**
 * Format duration in minutes to human-readable format using Intl API and i18n patterns
 * Shows hours and minutes, dropping any zero values
 * Uses locale-specific formatting patterns to allow different orderings
 * Examples:
 * - 30 minutes → "30 minutes" / "30 minut"
 * - 60 minutes → "1 hour" / "1 hodina"
 * - 90 minutes → "1 hour, 30 minutes" / "1 hodina, 30 minut"
 * - 120 minutes → "2 hours" / "2 hodiny"
 */
export function formatDurationMinutes(
  totalMinutes: number,
  locale?: string
): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  // Use Intl.NumberFormat for locale-aware integer formatting
  const numberFormatter = new Intl.NumberFormat(locale, {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  const formattedHours = numberFormatter.format(hours);
  const formattedMinutes = numberFormatter.format(minutes);
  const hourLabel = m["timeUnits.hour"]({ count: hours });
  const minuteLabel = m["timeUnits.minute"]({ count: minutes });

  // Use i18n patterns to allow locale-specific formatting and ordering
  if (hours > 0 && minutes > 0) {
    return m["duration.hoursAndMinutes"]({
      hours: formattedHours,
      hourLabel,
      minutes: formattedMinutes,
      minuteLabel,
    });
  }

  if (hours > 0) {
    return m["duration.hoursOnly"]({
      hours: formattedHours,
      hourLabel,
    });
  }

  if (minutes > 0) {
    return m["duration.minutesOnly"]({
      minutes: formattedMinutes,
      minuteLabel,
    });
  }

  // Edge case: 0 minutes
  return m["duration.minutesOnly"]({
    minutes: numberFormatter.format(0),
    minuteLabel: m["timeUnits.minute"]({ count: 0 }),
  });
}
