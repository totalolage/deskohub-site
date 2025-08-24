/**
 * Cache Tags for Next.js Caching
 * 
 * Centralized cache tag management for reservation pages
 * and other cacheable resources.
 */

/**
 * Generate a cache tag for a specific reservation
 */
export function getReservationCacheTag(reservationId: string): string {
  return `reservation-${reservationId}`;
}

/**
 * Generate a cache tag for all reservations
 */
export function getAllReservationsCacheTag(): string {
  return 'all-reservations';
}

/**
 * Generate a cache tag for a specific customer's reservations
 */
export function getCustomerCacheTag(customerId: string): string {
  return `customer-${customerId}`;
}

/**
 * Generate cache tags for a reservation page
 */
export function getReservationPageCacheTags(
  reservationId: string,
  customerId?: string
): string[] {
  const tags = [
    getReservationCacheTag(reservationId),
    getAllReservationsCacheTag(),
  ];
  
  if (customerId) {
    tags.push(getCustomerCacheTag(customerId));
  }
  
  return tags;
}