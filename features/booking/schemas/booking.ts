import { z } from "zod/v4";
import { m } from "@/i18n";
import { siteConstants } from "@/shared/utils/constants";
import {
  getAvailableDurations,
  getLocalTimeInRestaurantTimezone,
  isReservationWithinWorkingHours,
} from "@/shared/utils/working-hours-timezone";

// In Zod v4, we should avoid coerce/preprocess for better type inference
// Use transform or refine for custom parsing logic

// Main booking schema using Zod v4's composable pattern
// Using a factory function ensures messages are evaluated at runtime with correct locale
export const getBookingSchema = () => {
  // Datetime schema - expecting Date input from form
  const datetimeSchema = z
    .date({
      error: m["booking.validation.datetime.required"](),
    })
    .min(new Date(), { error: m["booking.validation.datetime.mustBeFuture"]() })
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
        const [openHours, openMinutes] = workingHours.open
          .split(":")
          .map(Number);
        const [closeHours, closeMinutes] = workingHours.close
          .split(":")
          .map(Number);

        const currentMinutes = hours * 60 + minutes;
        const openingMinutes = openHours * 60 + openMinutes;
        const closingMinutes =
          closeHours === 24 ? 24 * 60 : closeHours * 60 + closeMinutes;

        // Check if selected time is within opening hours
        return (
          currentMinutes >= openingMinutes && currentMinutes < closingMinutes
        );
      },
      { message: m["booking.validation.datetime.outsideWorkingHours"]() }
    );

  // Guest count schema - expecting number input from form
  const guestCountSchema = z
    .number({
      error: m["booking.validation.guestCount.required"](),
    })
    .int({ error: m["booking.validation.guestCount.integer"]() })
    .min(siteConstants.booking.validation.guestCount.min, {
      error: m["booking.validation.guestCount.required"](),
    })
    .max(siteConstants.booking.validation.guestCount.max, {
      error: m["booking.validation.guestCount.maximum"]({
        max: siteConstants.booking.validation.guestCount.max,
      }),
    });

  // Duration schema - expecting number input from form
  const durationSchema = z
    .number({
      error: m["booking.validation.duration.minimum"](),
    })
    .min(siteConstants.booking.validation.duration.min, {
      error: m["booking.validation.duration.minimum"](),
    })
    .multipleOf(siteConstants.booking.validation.duration.increment, {
      error: m["booking.validation.duration.increment"](),
    });

  // Name schema
  const nameSchema = z
    .string()
    .min(siteConstants.booking.validation.name.min, {
      error: m["booking.validation.name.minimum"]({
        min: siteConstants.booking.validation.name.min,
      }),
    })
    .max(siteConstants.booking.validation.name.max, {
      error: m["booking.validation.name.maximum"]({
        max: siteConstants.booking.validation.name.max,
      }),
    });

  // Email schema using Zod v4's improved email validation
  const emailSchema = z
    .email({ error: m["booking.validation.email.invalid"]() })
    .min(1, { error: m["booking.validation.email.invalid"]() });

  // Phone schema with regex validation
  const phoneSchema = z
    .string()
    .min(siteConstants.booking.validation.phone.min, {
      error: m["booking.validation.phone.minimum"](),
    })
    .max(siteConstants.booking.validation.phone.max, {
      error: m["booking.validation.phone.maximum"](),
    })
    .regex(/^[+]?[0-9\s\-()]+$/, {
      error: m["booking.validation.phone.invalid"](),
    });

  // Table preference schema using enum with default
  const tablePreferenceSchema = z
    .enum(siteConstants.booking.validation.tablePreference.values)
    .default(siteConstants.booking.defaultValues.tablePreference);

  // Special requests schema
  const specialRequestsSchema = z
    .string()
    .max(siteConstants.booking.validation.specialRequests.max, {
      error: m["booking.validation.specialRequests.maximum"]({
        max: siteConstants.booking.validation.specialRequests.max,
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
      tablePreference: tablePreferenceSchema,
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
        message: m["booking.validation.datetime.durationExceedsWorkingHours"](),
        path: ["duration"],
      }
    );
};

export type BookingFormData = z.input<ReturnType<typeof getBookingSchema>>;
