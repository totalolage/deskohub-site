import { constants } from "@/lib/constants";

/**
 * Converts a Date object to the restaurant's timezone
 * and returns the local time components in that timezone
 */
export function getLocalTimeInRestaurantTimezone(date: Date): {
  dayOfWeek: number;
  hours: number;
  minutes: number;
  timeString: string;
} {
  // Create formatter for restaurant timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: constants.workingHours.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const weekdayPart = parts.find((p) => p.type === "weekday");
  const hourPart = parts.find((p) => p.type === "hour");
  const minutePart = parts.find((p) => p.type === "minute");

  if (!weekdayPart || !hourPart || !minutePart)
    throw new Error("Failed to parse date parts");

  // Convert weekday to number (0 = Sunday, 1 = Monday, etc.)
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const dayOfWeek = weekdayMap[weekdayPart.value];
  const hours = parseInt(hourPart.value, 10);
  const minutes = parseInt(minutePart.value, 10);
  const timeString = `${hourPart.value}:${minutePart.value}`;

  return { dayOfWeek, hours, minutes, timeString };
}

/**
 * Checks if a given datetime and duration falls entirely within working hours
 * Takes into account the restaurant's timezone
 * @param datetime The start date and time of the reservation
 * @param durationHours The duration of the reservation in hours
 * @returns true if the entire reservation is within working hours, false otherwise
 */
export function isReservationWithinWorkingHours(
  datetime: Date,
  durationHours: number
): boolean {
  // Get the start time in restaurant timezone
  const startTime = getLocalTimeInRestaurantTimezone(datetime);

  // Calculate end time
  const endDateTime = new Date(
    datetime.getTime() + durationHours * 60 * 60 * 1000
  );
  const endTime = getLocalTimeInRestaurantTimezone(endDateTime);

  // Get working hours for the day
  const workingHours =
    startTime.dayOfWeek === 0 || startTime.dayOfWeek === 6
      ? constants.workingHours.weekends
      : constants.workingHours.weekdays;

  // Check if the day is open
  if (!workingHours.days.includes(startTime.dayOfWeek)) {
    return false;
  }

  // Parse opening and closing times
  const [openHours, openMinutes] = workingHours.open.split(":").map(Number);
  const [closeHours, closeMinutes] = workingHours.close.split(":").map(Number);

  const openTimeInMinutes = openHours * 60 + openMinutes;
  const closeTimeInMinutes =
    closeHours === 24 ? 24 * 60 : closeHours * 60 + closeMinutes;

  // Check start time
  const startTimeInMinutes = startTime.hours * 60 + startTime.minutes;
  if (
    startTimeInMinutes < openTimeInMinutes ||
    startTimeInMinutes >= closeTimeInMinutes
  ) {
    return false;
  }

  // For reservations that span across days
  if (endTime.dayOfWeek !== startTime.dayOfWeek) {
    // Check if the current day's closing time is reached
    const endOfDayMinutes =
      endTime.dayOfWeek === startTime.dayOfWeek
        ? endTime.hours * 60 + endTime.minutes
        : closeTimeInMinutes;

    if (endOfDayMinutes > closeTimeInMinutes) {
      return false;
    }

    // If the reservation spans to the next day, it's not allowed
    // (Restaurant closes at midnight at latest)
    return false;
  }

  // Check end time
  const endTimeInMinutes = endTime.hours * 60 + endTime.minutes;
  if (endTimeInMinutes > closeTimeInMinutes) {
    return false;
  }

  return true;
}

/**
 * Calculates available duration options based on selected datetime and closing time
 * @param datetime The selected date and time for the reservation
 * @returns Array of available duration options in hours
 */
export function getAvailableDurations(datetime: Date | null): number[] {
  const increment = constants.booking.validation.duration.increment;
  const minDuration = constants.booking.validation.duration.min;

  // If no datetime selected, return durations up to our longest operating hours (9 hours for weekends)
  if (!datetime) {
    const maxHours = 9; // Weekend hours: 15:00-24:00 = 9 hours
    const options: number[] = [];
    for (let hours = minDuration; hours <= maxHours; hours += increment) {
      options.push(hours);
    }
    return options;
  }

  // Get the selected time in restaurant timezone
  const { dayOfWeek, hours, minutes } =
    getLocalTimeInRestaurantTimezone(datetime);

  // Get working hours for the selected day
  const workingHours =
    dayOfWeek === 0 || dayOfWeek === 6
      ? constants.workingHours.weekends
      : constants.workingHours.weekdays;

  // Check if the day is open
  if (!workingHours.days.includes(dayOfWeek)) {
    return []; // No durations available on closed days
  }

  // Parse opening and closing times
  const [openHours, openMinutes] = workingHours.open.split(":").map(Number);
  const [closeHours, closeMinutes] = workingHours.close.split(":").map(Number);

  const currentMinutes = hours * 60 + minutes;
  const openingMinutes = openHours * 60 + openMinutes;
  const closingMinutes =
    closeHours === 24 ? 24 * 60 : closeHours * 60 + closeMinutes;

  // Check if selected time is before opening hours
  if (currentMinutes < openingMinutes) {
    return [];
  }

  // Check if selected time is at or after closing hours
  if (currentMinutes >= closingMinutes) {
    return [];
  }

  // Calculate minutes until closing
  const minutesUntilClosing = closingMinutes - currentMinutes;

  // If too close to closing for minimum duration, return empty
  if (minutesUntilClosing < minDuration * 60) {
    return [];
  }

  // Calculate available durations
  const maxHours = Math.floor((minutesUntilClosing / 60) * 2) / 2; // Round down to nearest 30 minutes
  const options: number[] = [];

  for (let hours = minDuration; hours <= maxHours; hours += increment) {
    options.push(hours);
  }

  return options;
}
