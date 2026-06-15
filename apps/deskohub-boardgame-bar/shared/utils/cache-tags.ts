/**
 * Cache Tags for Next.js 15 'use cache' directive
 *
 * Simple, ergonomic cache tag helpers following best practices:
 * - Direct function calls instead of classes
 * - Data-driven tagging
 * - Meaningful, domain-specific tags
 * - Easy to use with cacheTag() API
 */

import { createCloudinaryCacheTags } from "@deskohub/cloudinary";
import { cacheTag } from "next/cache";

/**
 * Cache tag namespaces - prefix all tags to avoid collisions
 */
const NAMESPACES = {
  cloudinary: "cdn",
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
export const cloudinaryTags = createCloudinaryCacheTags({
  namespace: NAMESPACES.cloudinary,
});

/**
 * Dotypos API cache tags
 */
export const dotyposTags = {
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
