/**
 * Category utility functions for filtering and validation
 */

import type { Category } from "../generated/types.gen";

/**
 * Known category tags used in Dotypos
 * Add new tags here as they are used in the system
 */
export const CATEGORY_TAGS = {
  NON_MENU: "non-menu",
} as const;

export type CategoryTagValue =
  (typeof CATEGORY_TAGS)[keyof typeof CATEGORY_TAGS];

/**
 * Check if a category has a specific tag
 */
export function categoryHasTag(category: Category, tag: string): boolean {
  return category.tags?.includes(tag) ?? false;
}

/**
 * Check if a category should be displayed in menus
 * A category is displayable if:
 * - It's not deleted
 * - It's marked as display (display !== false)
 * - It doesn't have the "non-menu" tag
 */
export function isCategoryDisplayable(category: Category): boolean {
  if (category.deleted) return false;
  if (category.display === false) return false;
  if (categoryHasTag(category, CATEGORY_TAGS.NON_MENU)) return false;
  return true;
}
