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
} from "./backend/service";

// Re-export generated types if needed by consumers
export type {
  CreateReservationRequest,
  ErrorResponse,
  Reservation,
  TokenResponse,
  UpdateReservationRequest,
} from "./generated/types.gen";

// Export display utilities
// Note: formatDateTime and formatDuration now require locale parameter
export {
  formatDateTime, // (date, locale) => string
  formatDuration, // (hours, locale) => string
  getReservationDisplayData,
  parseReservationNote,
} from "./utils/reservation-display";
