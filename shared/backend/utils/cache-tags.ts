/**
 * Cache Tags for Next.js Caching
 *
 * Centralized cache tag management for reservation pages
 * and other cacheable resources.
 */

import type { GetGalleryImagesOptions } from "@/features/gallery/actions/get-cloudinary-images";

abstract class CaheTags {
  abstract get _tags(): Record<string, unknown>;

  constructor(private _base: string) {}

  get all() {
    return `all-${this._base}`;
  }

  get cacheTags(): string[] {
    return [
      this.all,
      ...Object.keys(this._tags)
        .map((tag) => this._constructTag(tag))
        .filter(Boolean),
    ];
  }

  _constructTag(name: keyof typeof this._tags) {
    if (!name) return null;
    return `${this._base}-${this._tags[name]}`;
  }
}

export class ReservationCacheTags extends CaheTags {
  _tags: Partial<{
    reservationId: string;
  }> = {};

  constructor(options: { reservationId?: string; customerId?: string }) {
    super("reservations");
    this._tags.reservationId = options.reservationId;
  }

  get reservation() {
    return this._constructTag("reservationId");
  }
}

export class CustomerCacheTags extends CaheTags {
  _tags: Partial<{
    customerId: string;
  }> = {};

  constructor(options: { customerId?: string }) {
    super("customers");
    this._tags.customerId = options.customerId;
  }

  get customer() {
    return this._constructTag("customerId");
  }
}

export class CloudinaryImageCacheTags extends CaheTags {
  _tags: Partial<{
    tags: string;
    maxResults: number;
  }> = {};

  constructor(options?: GetGalleryImagesOptions) {
    super("cloudinary-images");
    if (options?.tags) this._tags.tags = JSON.stringify(options.tags);
    if (options?.maxResults) this._tags.maxResults = options.maxResults;
  }

  get tags() {
    return this._constructTag("tags");
  }

  get maxResults() {
    return this._constructTag("maxResults");
  }
}
