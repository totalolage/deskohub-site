import type z from "zod/v4";
import type { getBookingSchema } from "./schemas/booking";

export interface BookingData
  extends z.output<ReturnType<typeof getBookingSchema>> {
  id: string;
  submittedAt: Date;
}

export interface BookingResponse {
  success: boolean;
  bookingId?: string;
  message: string;
  data?: BookingData;
}

export interface BookingStorageItem {
  id: string;
  data: BookingData;
  createdAt: Date;
}
