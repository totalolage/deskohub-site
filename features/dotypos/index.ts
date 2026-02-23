/**
 * Dotypos POS System Integration
 *
 * Provides integration with Dotypos API for managing reservations
 * and other POS-related operations.
 */

export { isCategoryDisplayable } from "@deskohub/dotypos/category-utils";

export type { Reservation } from "@deskohub/dotypos/generated/types.gen";
export { DotyposService } from "./backend/service";
