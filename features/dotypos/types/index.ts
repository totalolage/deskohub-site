/**
 * Dotypos POS System Integration Types
 */

export interface DotyposReservation {
  id: string;
  status: "confirmed" | "pending" | "cancelled";
  createdAt: Date;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  datetime: Date;
  duration?: number; // Duration in hours
  guestCount: number;
  specialRequests?: string;
}
