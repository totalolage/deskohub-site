/**
 * Dotypos POS System Integration
 *
 * Provides integration with Dotypos API for managing reservations
 * and other POS-related operations.
 */

export type { ReservationInput } from "./backend/client";
export { createReservation, getReservation } from "./backend/client";
export type {
  DotyposConfig,
  DotyposReservation,
  DotyposTokenResponse,
} from "./types";
