/**
 * Dotypos POS System Integration
 *
 * Provides integration with Dotypos API for managing reservations
 * and other POS-related operations.
 */

// Export the Effect service and functions
export {
  createReservation,
  DotyposClient,
  DotyposConfigTag,
  DotyposServiceLive,
  getReservation,
  type ReservationInput,
} from "./backend/service";
// Re-export generated types if needed by consumers
export type {
  CreateReservationRequest,
  ErrorResponse,
  Reservation,
  TokenResponse,
  UpdateReservationRequest,
} from "./generated/types.gen";
// Export types
export type { DotyposReservation } from "./types";
