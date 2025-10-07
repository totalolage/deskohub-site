/**
 * Dotypos POS System Integration
 *
 * Provides integration with Dotypos API for managing reservations
 * and other POS-related operations.
 */

// Export cached versions for use in server components
export {
  getCachedCategories,
  getCachedCustomer,
  getCachedProducts,
  getCachedReservation,
  getCachedTables,
} from "./actions/cached-dotypos";
// Export the Effect service and functions that are actually being used
export {
  createReservation,
  DotyposClient,
  DotyposServiceLive,
  getMenuItems,
  getReservation,
} from "./backend/service";

// Re-export only the types that are actually being used
export type { Reservation } from "./generated/types.gen";

// Export utility functions
export {
  CATEGORY_TAGS,
  categoryHasTag,
  isCategoryDisplayable,
  type CategoryTagValue,
} from "./utils/category-utils";
