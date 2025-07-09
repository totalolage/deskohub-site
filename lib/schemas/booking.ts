import { z } from "zod";
import { m } from "@/i18n";
import { constants } from "../constants";

// Single unified booking schema function that handles localization internally
export const getBookingSchema = () => {
  return z.object({
    datetime: z.coerce
      .date()
      .min(new Date(), m["booking.validation.datetime.mustBeFuture"]()),
    guestCount: z.coerce
      .number()
      .min(
        constants.booking.validation.guestCount.min,
        m["booking.validation.guestCount.required"](),
      )
      .max(
        constants.booking.validation.guestCount.max,
        m["booking.validation.guestCount.maximum"]({
          max: constants.booking.validation.guestCount.max,
        }),
      )
      .int(m["booking.validation.guestCount.integer"]()),
    name: z
      .string()
      .min(
        constants.booking.validation.name.min,
        m["booking.validation.name.minimum"]({
          min: constants.booking.validation.name.min,
        }),
      )
      .max(
        constants.booking.validation.name.max,
        m["booking.validation.name.maximum"]({
          max: constants.booking.validation.name.max,
        }),
      ),
    email: z.string().email(m["booking.validation.email.invalid"]()),
    phone: z
      .string()
      .min(
        constants.booking.validation.phone.min,
        m["booking.validation.phone.minimum"](),
      )
      .max(
        constants.booking.validation.phone.max,
        m["booking.validation.phone.maximum"](),
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
        }),
      )
      .optional(),
  });
};

export type BookingFormData = z.infer<ReturnType<typeof getBookingSchema>>;

