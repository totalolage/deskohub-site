/**
 * Cache Revalidation Utilities
 *
 * Helper functions for revalidating Next.js cache
 */

import { revalidatePath, revalidateTag } from "next/cache";
import {
  getAllReservationsCacheTag,
  getCustomerCacheTag,
  getReservationCacheTag,
} from "./cache-tags";

/**
 * Revalidate all caches related to a specific reservation
 */
export async function revalidateReservation(
  reservationId: string,
  customerId?: string
): Promise<void> {
  // Revalidate the specific reservation
  revalidateTag(getReservationCacheTag(reservationId));

  // Revalidate all reservations
  revalidateTag(getAllReservationsCacheTag());

  // Revalidate customer's reservations if customer ID is provided
  if (customerId) {
    revalidateTag(getCustomerCacheTag(customerId));
  }

  // Also revalidate the specific reservation pages by path
  // This ensures both table and training room reservations are updated
  revalidatePath(`/reservation/${reservationId}`);
  revalidatePath(`/training-room/reservation/confirmation`);
}

/**
 * Revalidate all reservation-related caches
 * Use sparingly as this will trigger many revalidations
 */
export async function revalidateAllReservations(): Promise<void> {
  revalidateTag(getAllReservationsCacheTag());
  revalidatePath("/reservations");
  revalidatePath("/training-room/reservations");
}

/**
 * Revalidate caches for a specific customer
 */
export async function revalidateCustomerReservations(
  customerId: string
): Promise<void> {
  revalidateTag(getCustomerCacheTag(customerId));
}
