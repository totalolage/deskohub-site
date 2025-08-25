/**
 * Cache Tags for Next.js Caching
 *
 * Centralized cache tag management for reservation pages
 * and other cacheable resources.
 */

import type { GetGalleryImagesOptions } from "@/features/gallery/actions/get-cloudinary-images";

/**
 * Generate cache tags for reservation-related caching
 */
export const reservationCacheTags = (options: {
  reservationId?: string;
  customerId?: string;
}) => ({
  _base: "reservations",
  get all() {
    return `all-${this._base}`;
  },
  get reservation() {
    if (!options.reservationId) return null;
    return `reservation-${options.reservationId}`;
  },
  get customer() {
    if (!options.customerId) return null;
    return `customer-${options.customerId}`;
  },
});

export const customerCacheTags = (options: { customerId?: string }) => ({
  _base: "customers",
  get all() {
    return `all-${this._base}`;
  },
  get customer() {
    if (!options.customerId) return null;
    return `customer-${options.customerId}`;
  },
});

export const cloudinaryImageCacheTags = (options?: GetGalleryImagesOptions) => ({
  _base: "cloudinary-images",
  get all() {
    return `all-${this._base}`;
  },
  get search() {
    if (!options?.search) return null;
    return `${this._base}-${options.search}`;
  },
  get tags() {
    if (!options?.tags?.length) return null;
    // Create a consistent tag string by sorting tags
    const tagString = [...options.tags].sort().join(",");
    return `${this._base}-tags-${tagString}`;
  },
  get maxResults() {
    if (!options?.maxResults) return null;
    return `${this._base}-${options.maxResults}`;
  },
});
