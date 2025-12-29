/**
 * Dotypos POS System Integration
 *
 * Provides integration with Dotypos API for managing reservations
 * and other POS-related operations.
 */
export { DotyposService } from "./backend/service";

export type { Reservation } from "./generated/types.gen";

export { isCategoryDisplayable } from "./utils/category-utils";
