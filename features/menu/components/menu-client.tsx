"use client";

import type { Category, Product } from "@/features/dotypos/generated";
import { siteConstants } from "@/shared/utils/constants";
import { MenuFooterNote } from "./menu-footer-note";
import { MenuHero } from "./menu-hero";
import { MenuOpeningHours } from "./menu-opening-hours";
import { MenuPDFDownload } from "./menu-pdf-download";
import { MenuSection } from "./menu-section";

interface MenuClientProps {
  products: Product[];
  categories: Category[];
  showPdfDownload: boolean;
}

export function MenuClient({
  products,
  categories,
  showPdfDownload,
}: MenuClientProps) {
  // Get display order for categories from config
  const categoryOrder = [
    ...siteConstants.menu.categoryGroups.food,
    ...siteConstants.menu.categoryGroups.drinks,
    ...siteConstants.menu.categoryGroups.other,
  ];

  // Filter and order categories
  const displayCategories: Category[] = [];
  const categoryMap = new Map(categories.map((cat) => [cat.id, cat]));

  // Add categories in configured order
  categoryOrder.forEach((categoryId) => {
    if (!siteConstants.menu.excludedCategories.includes(categoryId)) {
      const category = categoryMap.get(categoryId);
      if (category) {
        // Check if there are products for this category
        const hasProducts = products.some((p) => p._categoryId === categoryId);
        if (hasProducts) {
          displayCategories.push(category);
        }
      }
    }
  });

  // Handle uncategorized items if enabled
  if (siteConstants.menu.showUncategorized) {
    const processedIds = new Set([
      ...categoryOrder,
      ...siteConstants.menu.excludedCategories,
    ]);

    categories.forEach((category) => {
      if (category.id && !processedIds.has(category.id)) {
        // Check if there are products for this category
        const hasProducts = products.some((p) => p._categoryId === category.id);
        if (hasProducts) {
          displayCategories.push(category);
        }
      }
    });
  }

  return (
    <div className="bg-black">
      <MenuHero />

      <div className="max-w-4xl mx-auto px-6 py-16">
        {showPdfDownload && <MenuPDFDownload />}
        <MenuOpeningHours />

        {/* Display all categories in order */}
        {displayCategories.map((category) => (
          <MenuSection
            key={category.id}
            category={category}
            products={products}
            emoji={
              category.id
                ? siteConstants.menu.categoryEmojis[category.id]
                : undefined
            }
          />
        ))}

        <MenuFooterNote />
      </div>
    </div>
  );
}
