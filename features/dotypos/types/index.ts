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
  guestCount: number;
  specialRequests?: string;
}

export interface DotyposConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  cloudId: string;
  apiUrl: string;
}

export interface DotyposTokenResponse {
  access_token: string;
  expires_in: number;
  token_type?: string;
  refresh_token?: string;
}
