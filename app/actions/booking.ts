"use server";

import { z } from "zod";
import { baseLocale, m, setLocale } from "@/i18n";
import { extractFormData } from "@/lib/form-utils";
import { getLocaleFromAction } from "@/i18n/utils/get-locale.action";

// Define comprehensive validation schema with regular zod
const getBookingSchema = async () => {
  setLocale((await getLocaleFromAction()) ?? baseLocale);

  return z.object({
    datetime: z.coerce
      .date()
      .min(new Date(), m["booking.validation.datetime.mustBeFuture"]()),
    guestCount: z
      .string()
      .transform((val) => parseInt(val, 10))
      .pipe(
        z
          .number()
          .min(1, m["booking.validation.guestCount.required"]())
          .max(10, m["booking.validation.guestCount.maximum"]())
          .int(m["booking.validation.guestCount.integer"]()),
      ),
    name: z
      .string()
      .min(2, m["booking.validation.name.minimum"]({ min: 2 }))
      .max(50, m["booking.validation.name.maximum"]({ max: 50 })),
    email: z
      .string()
      .email(m["booking.validation.email.invalid"]())
      .max(100, m["booking.validation.email.maximum"]({ max: 100 })),
    phone: z
      .string()
      .min(9, m["booking.validation.phone.minimum"]())
      .max(20, m["booking.validation.phone.maximum"]())
      .regex(/^[+]?[0-9\s\-()]+$/, m["booking.validation.phone.invalid"]()),
    tablePreference: z.string().optional(),
    specialRequests: z
      .string()
      .max(500, m["booking.validation.specialRequests.maximum"]({ max: 500 }))
      .optional(),
  });
};
// Type inference from Zod schema
type BookingFormData = z.infer<Awaited<ReturnType<typeof getBookingSchema>>>;

type ActionState = {
  success: boolean;
  message: string;
  errors: Record<string, string[]>;
  data?: BookingFormData;
  formData?: Record<string, string>;
};

// Server action with useActionState-compatible signature
export async function submitBooking(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const bookingSchema = await getBookingSchema();

    // Extract FormData and validate with zod
    const formDataObject = extractFormData(formData);
    const validationResult = bookingSchema.safeParse(formDataObject);

    // Handle validation errors
    if (!validationResult.success) {
      const errors = validationResult.error.flatten().fieldErrors;

      return {
        success: false,
        errors,
        message: m["booking.validation.general"](),
        formData: formDataObject, // Return form data to preserve field values
      };
    }

    // At this point, data is validated and type-safe
    const validatedData = validationResult.data;

    // TODO: Implement actual booking logic (connect to AirTable in future)
    console.log("Booking submitted successfully:", {
      id: `booking-${Date.now()}`, // Temporary ID
      ...validatedData,
      submittedAt: new Date().toISOString(),
    });

    // Simulate processing time
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return {
      success: true,
      message: "Booking submitted successfully",
      errors: {},
      data: validatedData,
      formData: {}, // Clear form data on success
    };
  } catch (error) {
    console.error("Booking submission error:", error);

    // Return a generic error message to avoid exposing internal details
    return {
      success: false,
      message: "An unexpected error occurred. Please try again.",
      errors: {},
      formData: {}, // Clear form data on error
    };
  }
}
