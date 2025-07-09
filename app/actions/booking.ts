"use server";

import { baseLocale, m, setLocale } from "@/i18n";
import { extractFormData } from "@/lib/form-utils";
import { getLocaleFromAction } from "@/i18n/utils/get-locale.action";
import { getBookingSchema, type BookingFormData } from "@/lib/schemas/booking";

// Server-side booking schema with localized messages
const getServerBookingSchema = async () => {
  setLocale((await getLocaleFromAction()) ?? baseLocale);
  return getBookingSchema();
};

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
    const bookingSchema = await getServerBookingSchema();

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
