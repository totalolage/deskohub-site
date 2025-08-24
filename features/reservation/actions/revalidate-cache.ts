"use server";

import { revalidateReservation } from "@/shared/backend/utils/cache-revalidation";

/**
 * Server action to manually revalidate reservation cache
 * Useful for testing and manual cache invalidation
 */
export async function revalidateReservationCache(
  reservationId: string,
  customerId?: string
): Promise<{ success: boolean; message: string }> {
  try {
    await revalidateReservation(reservationId, customerId);

    return {
      success: true,
      message: `Cache revalidated for reservation ${reservationId}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to revalidate cache: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}
