import {
  getAvailableDurations as getAvailableDurationsFromPackage,
  getLocalTimeInTimezone,
  isReservationWithinWorkingHours as isReservationWithinWorkingHoursFromPackage,
  type ReservationScheduleConfig,
} from "@deskohub/reservation";
import { siteConstants } from "@/shared/utils/constants";

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
  return getLocalTimeInTimezone(date, siteConstants.workingHours.timezone);
}

const reservationScheduleConfig: ReservationScheduleConfig = {
  timezone: siteConstants.workingHours.timezone,
  workingHours: siteConstants.workingHours.hours,
  validation: {
    minDurationHours: siteConstants.tableReservation.validation.duration.min,
    durationIncrementHours:
      siteConstants.tableReservation.validation.duration.increment,
    fallbackMaxDurationHours: 9,
  },
};

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
  return isReservationWithinWorkingHoursFromPackage(
    datetime,
    durationHours,
    reservationScheduleConfig
  );
}

/**
 * Calculates available duration options based on selected datetime and closing time
 * @param datetime The selected date and time for the reservation
 * @returns Array of available duration options in hours
 */
export function getAvailableDurations(datetime: Date | null): number[] {
  return getAvailableDurationsFromPackage(datetime, reservationScheduleConfig);
}
