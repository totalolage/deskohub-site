export interface BookingData {
  id: string;
  datetime: Date;
  guestCount: number;
  name: string;
  email: string;
  phone: string;
  tablePreference: string;
  specialRequests?: string;
  status: "pending" | "confirmed" | "cancelled";
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
