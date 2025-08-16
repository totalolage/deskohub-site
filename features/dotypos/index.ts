/**
 * Dotypos POS System Integration
 * 
 * Provides integration with Dotypos API for managing reservations
 * and other POS-related operations.
 */

// Export the Effect service and functions
export {
  createReservation,
  getReservation,
  DotyposServiceLive,
  type ReservationInput,
} from "./backend/service";

// Export types
export type {
  DotyposConfig,
  DotyposReservation,
  DotyposTokenResponse,
} from "./types";

// Re-export generated types if needed by consumers
export type {
  Reservation,
  CreateReservationRequest,
  UpdateReservationRequest,
  TokenResponse,
  ErrorResponse,
} from "./generated/types.gen";