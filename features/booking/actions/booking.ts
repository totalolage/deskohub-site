"use server";

import { redirect } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { storeBooking } from "@/features/booking/lib/booking-storage";
import { getBookingSchema } from "@/features/booking/schemas/booking";
import { actionClient } from "@/lib/safe-action-client";

export const submitBooking = actionClient
  .inputSchema(getBookingSchema())
  .action(async ({ parsedInput }) => {
    const bookingId = uuidv4();

    // Store booking data (temporary storage until Airtable integration)
    await storeBooking({
      id: bookingId,
      datetime: parsedInput.datetime,
      duration: parsedInput.duration,
      guestCount: parsedInput.guestCount,
      name: parsedInput.name,
      email: parsedInput.email,
      phone: parsedInput.phone,
      tablePreference: parsedInput.tablePreference,
      specialRequests: parsedInput.specialRequests,
      status: "pending",
      submittedAt: new Date(),
    });

    redirect(`/reservation/${bookingId}`);
  });
