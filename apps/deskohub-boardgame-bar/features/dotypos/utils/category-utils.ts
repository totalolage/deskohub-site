import type { Category } from "@deskohub/dotypos/generated";

/**
 * Check if a category should be displayed in menus
 */
export function isCategoryDisplayable(category: Category): boolean {
  if (category.deleted) return false;
  if (category.display === false) return false;
  if (category.tags?.includes("non-menu")) return false;
  return true;
}
