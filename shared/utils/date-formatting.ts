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
 * Format time consistently
 */
export function formatTime(
  date: Date | string,
  locale: string,
  options: Intl.DateTimeFormatOptions = {}
): string {
  return formatDate(date, locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...options,
  });
}

/**
 * Format date for display in booking confirmations
 */
export function formatBookingDate(date: Date | string, locale: string): string {
  return formatDate(date, locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Format datetime for input fields (datetime-local)
 * Returns format: YYYY-MM-DDTHH:mm
 */
export function formatDateTimeForInput(date: Date | string): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;

  // Format in the restaurant's timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: siteConstants.workingHours.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(dateObj);
  const getPart = (type: string) =>
    parts.find((p) => p.type === type)?.value || "";

  const year = getPart("year");
  const month = getPart("month");
  const day = getPart("day");
  const hour = getPart("hour");
  const minute = getPart("minute");

  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/**
 * @returns {MinBookingDateTime}
 */
export function getMinBookingDateTime() {
  const now = new Date();
  const minutes = now.getMinutes();
  const roundedMinutes =
    Math.ceil(
      minutes / siteConstants.tableReservation.validation.time.minuteIncrement
    ) * siteConstants.tableReservation.validation.time.minuteIncrement;

  // If we need to round up to the next hour
  if (roundedMinutes === 60) {
    now.setHours(now.getHours() + 1);
    now.setMinutes(0);
  } else {
    now.setMinutes(roundedMinutes);
  }

  // Reset seconds and milliseconds
  now.setSeconds(0);
  now.setMilliseconds(0);

  return { input: formatDateTimeForInput(now), date: now };
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
