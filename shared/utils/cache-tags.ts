/**
 * Cache Tags for Next.js 15 'use cache' directive
 *
 * Simple, ergonomic cache tag helpers following best practices:
 * - Direct function calls instead of classes
 * - Data-driven tagging
 * - Meaningful, domain-specific tags
 * - Easy to use with cacheTag() API
 */

import { unstable_cacheTag as cacheTag } from "next/cache";

/**
 * Creates a stable, short hash for complex objects to use in cache tags
 * Uses a simple hashing algorithm suitable for cache keys
 */
function createStableHash(obj: unknown): string {
  const seen = new WeakSet();
  const MAX_DEPTH = 10;
  const MAX_STRING_LENGTH = 1000; // Limit string length for performance

  // Create a deterministic string representation with circular reference protection
  const stringify = (value: unknown, depth = 0): string => {
    if (depth > MAX_DEPTH) return "[...]";
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value !== "object") {
      const str = String(value);
      // Truncate very long strings to avoid memory issues
      return str.length > 100 ? `${str.substring(0, 100)}...` : str;
    }

    // Prevent circular references
    if (seen.has(value)) return "[circular]";
    seen.add(value);

    let result: string;

    // Handle arrays
    if (Array.isArray(value)) {
      // Limit array processing for very large arrays
      const items = value.slice(0, 50).map((v) => stringify(v, depth + 1));
      result = `[${items.join(",")}${value.length > 50 ? ",..." : ""}]`;
    } else {
      // Handle objects - sort keys for stability
      const sortedKeys = Object.keys(value).sort().slice(0, 50); // Limit keys
      const pairs = sortedKeys.map(
        (key) =>
          `${key}:${stringify((value as Record<string, unknown>)[key], depth + 1)}`
      );
      result = `{${pairs.join(",")}}`;
    }

    seen.delete(value);
    return result;
  };

  const str = stringify(obj);
  const truncatedStr =
    str.length > MAX_STRING_LENGTH ? str.substring(0, MAX_STRING_LENGTH) : str;

  // Simple but effective hash function
  let hash = 0;
  for (let i = 0; i < truncatedStr.length; i++) {
    const char = truncatedStr.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0; // Force to 32-bit integer
  }

  return Math.abs(hash).toString(36);
}

/**
 * Cache tag namespaces - prefix all tags to avoid collisions
 */
const NAMESPACES = {
  cloudinary: "cdn",
  reservation: "res",
  customer: "cust",
  table: "tbl",
  menu: "menu",
} as const;

/**
 * Apply cache tags directly to the current cache context
 * Use this inside functions with 'use cache' directive
 */
export function applyCacheTags(...tags: string[]) {
  // Optimize for common single-tag case
  if (tags.length === 1) {
    cacheTag(tags[0]!);
  } else {
    for (const tag of tags) {
      cacheTag(tag);
    }
  }
}

/**
 * Cloudinary image cache tags
 */
export const cloudinaryTags = {
  // Tag all cloudinary images
  all: () => `${NAMESPACES.cloudinary}:all`,

  // Tag specific image by public ID
  image: (publicId: string) => `${NAMESPACES.cloudinary}:img:${publicId}`,

  // Tag image search results with stable hashing for complex objects
  search: (tags?: unknown, maxResults?: number) => {
    const parts = [`${NAMESPACES.cloudinary}:search`];
    if (tags) {
      // Create a stable hash for the tags object to avoid overly long cache keys
      const tagHash = createStableHash(tags);
      parts.push(`tags:${tagHash}`);
    }
    if (maxResults) parts.push(`limit:${maxResults}`);
    return parts.join(":");
  },

  // Get all relevant tags for a cloudinary operation
  getTags: (publicId?: string) => {
    const tags = [cloudinaryTags.all()];
    if (publicId) tags.push(cloudinaryTags.image(publicId));
    return tags;
  },
};

/**
 * Dotypos API cache tags
 */
export const dotyposTags = {
  // Reservation tags
  reservation: {
    all: () => `${NAMESPACES.reservation}:all`,
    byId: (id: string) => `${NAMESPACES.reservation}:${id}`,
    byCustomer: (customerId: string) =>
      `${NAMESPACES.reservation}:cust:${customerId}`,

    getTags: (reservationId?: string, customerId?: string) => {
      const tags = [dotyposTags.reservation.all()];
      if (reservationId) tags.push(dotyposTags.reservation.byId(reservationId));
      if (customerId) tags.push(dotyposTags.reservation.byCustomer(customerId));
      return tags;
    },
  },

  // Customer tags
  customer: {
    all: () => `${NAMESPACES.customer}:all`,
    byId: (id: string) => `${NAMESPACES.customer}:${id}`,
    byEmail: (email: string) => `${NAMESPACES.customer}:email:${email}`,
    byPhone: (phone: string) => `${NAMESPACES.customer}:phone:${phone}`,

    getTags: (customerId?: string, email?: string, phone?: string) => {
      const tags = [dotyposTags.customer.all()];
      if (customerId) tags.push(dotyposTags.customer.byId(customerId));
      if (email) tags.push(dotyposTags.customer.byEmail(email));
      if (phone) tags.push(dotyposTags.customer.byPhone(phone));
      return tags;
    },
  },

  // Table tags
  tables: {
    all: () => `${NAMESPACES.table}:all`,

    getTags: () => {
      return [dotyposTags.tables.all()];
    },
  },

  // Menu/Product tags
  menu: {
    all: () => `${NAMESPACES.menu}:all`,
    byCategory: (categoryId: string) => `${NAMESPACES.menu}:cat:${categoryId}`,
    byProduct: (productId: string) => `${NAMESPACES.menu}:prod:${productId}`,
    includeDeleted: (include: boolean) =>
      `${NAMESPACES.menu}:deleted:${include}`,

    getTags: (options?: {
      categoryId?: string;
      productId?: string;
      includeDeleted?: boolean;
    }) => {
      const tags = [dotyposTags.menu.all()];
      if (options?.categoryId)
        tags.push(dotyposTags.menu.byCategory(options.categoryId));
      if (options?.productId)
        tags.push(dotyposTags.menu.byProduct(options.productId));
      if (options?.includeDeleted !== undefined)
        tags.push(dotyposTags.menu.includeDeleted(options.includeDeleted));
      return tags;
    },
  },
};
