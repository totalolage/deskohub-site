import { isValidPhoneNumber } from "libphonenumber-js";
import { z } from "zod";
import { m } from "@/i18n";
import { siteConstants } from "@/shared/utils/constants";
import {
  getAvailableDurations,
  getLocalTimeInRestaurantTimezone,
  isReservationWithinWorkingHours,
} from "@/shared/utils/working-hours-timezone";

// In Zod v4, we should avoid coerce/preprocess for better type inference
// Use transform or refine for custom parsing logic

// Main table reservation schema using Zod v4's composable pattern
// Using a factory function ensures messages are evaluated at runtime with correct locale
export const getTableReservationSchema = () => {
  // Datetime schema - expecting Date input from form
  const datetimeSchema = z
    .date({
      error: m["tableReservation.validation.datetime.required"](),
    })
    .min(new Date(), { error: m["tableReservation.validation.datetime.mustBeFuture"]() })
    .refine(
      (date) => {
        // Check if minutes are in 30-minute increments using modular arithmetic
        const minutes = date.getMinutes();
        return (
          minutes % siteConstants.tableReservation.validation.time.minuteIncrement === 0
        );
      },
      { message: m["tableReservation.validation.datetime.thirtyMinuteIncrements"]() }
    )
    .refine(
      (date) => {
        // Check if the booking time is within business hours
        const { dayOfWeek, hours, minutes } =
          getLocalTimeInRestaurantTimezone(date);

        // Get working hours for the selected day
        const workingHours =
          dayOfWeek === 0 || dayOfWeek === 6
            ? siteConstants.workingHours.weekends
            : siteConstants.workingHours.weekdays;

        // Check if the day is open
        if (!workingHours.days.includes(dayOfWeek)) {
          return false;
        }

        // Parse opening and closing times
        const openTimeParts = workingHours.open.split(":").map(Number);
        const closeTimeParts = workingHours.close.split(":").map(Number);

        const openHours = openTimeParts[0] ?? 0;
        const openMinutes = openTimeParts[1] ?? 0;
        const closeHours = closeTimeParts[0] ?? 0;
        const closeMinutes = closeTimeParts[1] ?? 0;

        const currentMinutes = hours * 60 + minutes;
        const openingMinutes = openHours * 60 + openMinutes;
        const closingMinutes =
          closeHours === 24 ? 24 * 60 : closeHours * 60 + closeMinutes;

        // Check if selected time is within opening hours
        return (
          currentMinutes >= openingMinutes && currentMinutes < closingMinutes
        );
      },
      { message: m["tableReservation.validation.datetime.outsideWorkingHours"]() }
    );

  // Guest count schema - expecting number input from form
  const guestCountSchema = z
    .number({
      error: m["tableReservation.validation.guestCount.required"](),
    })
    .int({ error: m["tableReservation.validation.guestCount.integer"]() })
    .min(siteConstants.tableReservation.validation.guestCount.min, {
      error: m["tableReservation.validation.guestCount.required"](),
    })
    .max(siteConstants.tableReservation.validation.guestCount.max, {
      error: m["tableReservation.validation.guestCount.maximum"]({
        max: siteConstants.tableReservation.validation.guestCount.max,
      }),
    });

  // Duration schema - expecting number input from form
  const durationSchema = z
    .number({
      error: m["tableReservation.validation.duration.minimum"](),
    })
    .min(siteConstants.tableReservation.validation.duration.min, {
      error: m["tableReservation.validation.duration.minimum"](),
    })
    .multipleOf(siteConstants.tableReservation.validation.duration.increment, {
      error: m["tableReservation.validation.duration.increment"](),
    });

  // Name schema
  const nameSchema = z
    .string()
    .min(siteConstants.tableReservation.validation.name.min, {
      error: m["tableReservation.validation.name.minimum"]({
        min: siteConstants.tableReservation.validation.name.min,
      }),
    })
    .max(siteConstants.tableReservation.validation.name.max, {
      error: m["tableReservation.validation.name.maximum"]({
        max: siteConstants.tableReservation.validation.name.max,
      }),
    });

  // Email schema using Zod v4's improved email validation
  const emailSchema = z
    .email({ error: m["tableReservation.validation.email.invalid"]() })
    .min(1, { error: m["tableReservation.validation.email.invalid"]() });

  // Phone schema - basic validation only
  const phoneSchema = z
    .string()
    .min(1, {
      error: m["tableReservation.validation.phone.minimum"](),
    })
    .refine((phone) => isValidPhoneNumber(phone, "CZ"), {
      error: m["tableReservation.validation.phone.invalid"](),
    });

  // Table preference schemas using booleans instead of enum
  const needsLargerTableSchema = z.boolean().default(false);
  const needsPrivateSpaceSchema = z.boolean().default(false);

  // Special requests schema
  const specialRequestsSchema = z
    .string()
    .max(siteConstants.tableReservation.validation.specialRequests.max, {
      error: m["tableReservation.validation.specialRequests.maximum"]({
        max: siteConstants.tableReservation.validation.specialRequests.max,
      }),
    })
    .optional();

  return z
    .object({
      datetime: datetimeSchema,
      guestCount: guestCountSchema,
      duration: durationSchema,
      name: nameSchema,
      email: emailSchema,
      phone: phoneSchema,
      needsLargerTable: needsLargerTableSchema,
      needsPrivateSpace: needsPrivateSpaceSchema,
      specialRequests: specialRequestsSchema,
    })
    .refine(
      (data) => {
        // Validate that the entire reservation (start time + duration) is within working hours
        if (!data.datetime || !data.duration) return true;

        // Check if duration is available for the selected time
        const availableDurations = getAvailableDurations(data.datetime);
        if (!availableDurations.includes(data.duration)) {
          return false;
        }

        // Double-check with the full validation
        return isReservationWithinWorkingHours(data.datetime, data.duration);
      },
      {
        message: m["tableReservation.validation.datetime.durationExceedsWorkingHours"](),
        path: ["duration"],
      }
    );
};

export type TableReservationFormUserInput = z.input<ReturnType<typeof getTableReservationSchema>>;
export type TableReservationFormData = z.output<ReturnType<typeof getTableReservationSchema>>;
