import { isValidPhoneNumber } from "libphonenumber-js";
import { z } from "zod";
import { m } from "@/features/i18n";
import { getMinBookingDateTime } from "@/shared/utils";
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
  const datetimeSchema = z
    .date({
      error: m["tableReservation.validation.datetime.required"](),
    })
    .min(getMinBookingDateTime().date, {
      error: m["tableReservation.validation.datetime.mustBeFuture"](),
    })
    .refine(
      (date) => {
        // Check if the booking time is within business hours
        const { dayOfWeek, hours, minutes } =
          getLocalTimeInRestaurantTimezone(date);

        // Get working hours for the selected day
        const dayHours =
          siteConstants.workingHours.hours[
            dayOfWeek as 0 | 1 | 2 | 3 | 4 | 5 | 6
          ];

        // Convert to minutes for comparison
        const currentMinutes = hours * 60 + minutes;
        const openingMinutes = dayHours.open.hrs * 60 + dayHours.open.mins;
        const closingMinutes =
          dayHours.close.hrs === 24
            ? 24 * 60
            : dayHours.close.hrs * 60 + dayHours.close.mins;

        // Check if selected time is within opening hours
        return (
          currentMinutes >= openingMinutes && currentMinutes < closingMinutes
        );
      },
      {
        message:
          m["tableReservation.validation.datetime.outsideWorkingHours"](),
      }
    )
    .superRefine((date, ctx) => {
      const min = getMinBookingDateTime().date;
      const minutesSinceMin = (date.getTime() - min.getTime()) / (1000 * 60);
      if (
        minutesSinceMin %
        siteConstants.tableReservation.validation.time.minuteIncrement
      )
        ctx.addIssue({
          code: "not_multiple_of",
          divisor:
            siteConstants.tableReservation.validation.time.minuteIncrement,
          message: m["tableReservation.validation.datetime.selectTimeSlot"](),
        });
    });

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
        message:
          m[
            "tableReservation.validation.datetime.durationExceedsWorkingHours"
          ](),
        path: ["duration"],
      }
    );
};

export type TableReservationFormUserInput = z.input<
  ReturnType<typeof getTableReservationSchema>
>;
export type TableReservationFormData = z.output<
  ReturnType<typeof getTableReservationSchema>
>;
