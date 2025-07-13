/**
 * Formats a time string for display based on locale
 * @param time - Time string in HH:mm format (e.g., "15:00")
 * @param locale - The locale to use for formatting
 * @returns Formatted time string
 */
export const formatTimeString = (time: string, locale: string): string => {
  // Parse the time string
  const [hoursStr, minutesStr] = time.split(":");
  const hours = parseInt(hoursStr || "0", 10);
  const minutes = parseInt(minutesStr || "0", 10);

  // Create a date object for today with the specified time
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);

  // Format using Intl.DateTimeFormat
  // Let the Intl API decide the hour format based on locale
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

/**
 * Formats a time range for display (e.g., "15:00 - 23:00" or "3:00 PM - 11:00 PM")
 * @param startTime - Start time in HH:mm format
 * @param endTime - End time in HH:mm format
 * @param locale - The locale to use for formatting
 * @returns Formatted time range string
 */
export const formatTimeRange = (
  startTime: string,
  endTime: string,
  locale: string
): string => {
  const formattedStart = formatTimeString(startTime, locale);

  // Handle midnight (24:00) specially
  let formattedEnd: string;
  if (endTime === "24:00") {
    // Create a date object for midnight
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    midnight.setDate(midnight.getDate() + 1); // Next day's midnight

    formattedEnd = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
    }).format(midnight);
  } else {
    formattedEnd = formatTimeString(endTime, locale);
  }

  return `${formattedStart} - ${formattedEnd}`;
};
