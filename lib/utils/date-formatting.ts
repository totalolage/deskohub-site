import { cache } from "react";
import { constants } from "@/lib/constants";

/**
 * Get current timestamp - cached for the duration of the request
 * This ensures consistent timestamps across server and client during SSR
 */
export const getNow = cache(() => new Date().toISOString());

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
    timeZone: constants.workingHours.timezone,
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
    timeZone: constants.workingHours.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  
  const parts = formatter.formatToParts(dateObj);
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || "";
  
  const year = getPart("year");
  const month = getPart("month");
  const day = getPart("day");
  const hour = getPart("hour");
  const minute = getPart("minute");
  
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/**
 * Get the minimum datetime for booking (current time)
 * Formatted for datetime-local input
 */
export function getMinBookingDateTime(): string {
  return formatDateTimeForInput(new Date());
}
