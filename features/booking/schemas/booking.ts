import { z } from "zod";
import { m } from "@/i18n";
import { constants } from "@/lib/constants";
import {
  getAvailableDurations,
  isReservationWithinWorkingHours,
} from "@/lib/utils/working-hours-timezone";

// Single unified booking schema function that handles localization internally
export const getBookingSchema = () => {
  return z
    .object({
      datetime: z.coerce
        .date()
        .min(new Date(), m["booking.validation.datetime.mustBeFuture"]()),
      guestCount: z.coerce
        .number()
        .min(
          constants.booking.validation.guestCount.min,
          m["booking.validation.guestCount.required"]()
        )
        .max(
          constants.booking.validation.guestCount.max,
          m["booking.validation.guestCount.maximum"]({
            max: constants.booking.validation.guestCount.max,
          })
        )
        .int(m["booking.validation.guestCount.integer"]()),
      duration: z.coerce
        .number()
        .min(
          constants.booking.validation.duration.min,
          m["booking.validation.duration.minimum"]()
        )
        .multipleOf(
          constants.booking.validation.duration.increment,
          m["booking.validation.duration.increment"]()
        ),
      name: z
        .string()
        .min(
          constants.booking.validation.name.min,
          m["booking.validation.name.minimum"]({
            min: constants.booking.validation.name.min,
          })
        )
        .max(
          constants.booking.validation.name.max,
          m["booking.validation.name.maximum"]({
            max: constants.booking.validation.name.max,
          })
        ),
      email: z.string().email(m["booking.validation.email.invalid"]()),
      phone: z
        .string()
        .min(
          constants.booking.validation.phone.min,
          m["booking.validation.phone.minimum"]()
        )
        .max(
          constants.booking.validation.phone.max,
          m["booking.validation.phone.maximum"]()
        )
        .regex(/^[+]?[0-9\s\-()]+$/, m["booking.validation.phone.invalid"]()),
      tablePreference: z
        .enum(constants.booking.validation.tablePreference.values)
        .optional()
        .default(constants.booking.defaultValues.tablePreference),
      specialRequests: z
        .string()
        .max(
          constants.booking.validation.specialRequests.max,
          m["booking.validation.specialRequests.maximum"]({
            max: constants.booking.validation.specialRequests.max,
          })
        )
        .optional(),
    })
    .superRefine((data, ctx) => {
      // Validate that the entire reservation (start time + duration) is within working hours
      if (data.datetime && data.duration) {
        // Check if duration is available for the selected time
        const availableDurations = getAvailableDurations(data.datetime);
        if (!availableDurations.includes(data.duration)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              m["booking.validation.datetime.durationExceedsWorkingHours"](),
            path: ["duration"],
          });
          return;
        }

        // Double-check with the full validation
        if (!isReservationWithinWorkingHours(data.datetime, data.duration)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              m["booking.validation.datetime.durationExceedsWorkingHours"](),
            path: ["duration"],
          });
        }
      }
    });
};

type BookingFormSchema = ReturnType<typeof getBookingSchema>;

/**
 * A utility type to be used for things like type inference, never for parsing or validation
 */
export const bookingSchema = getBookingSchema() as Omit<
  BookingFormSchema,
  | "parse"
  | "safeParse"
  | "transform"
  | "superRefine"
  | "extend"
  | "parseAsync"
  | "safeParseAsync"
  | "transformAsync"
>;

export type BookingFormData = z.infer<BookingFormSchema>;
