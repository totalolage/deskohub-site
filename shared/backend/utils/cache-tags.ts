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

export const cloudinaryImageCacheTags = (options: GetGalleryImagesOptions) => ({
  _base: "cloudinary-images",
  get all() {
    return `all-${this._base}`;
  },
  get searchType() {
    if (!options.searchType) return null;
    return `${this._base}-${options.searchType}`;
  },
  get searchValue() {
    if (!options.searchValue) return null;
    return `${this.searchType}-${options.searchValue}`;
  },
  get maxResults() {
    if (!options.maxResults) return null;
    return `${this._base}-${options.maxResults}`;
  },
});
