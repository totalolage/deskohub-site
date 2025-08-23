"use client";

import type { MenuItemWithCategory } from "@/features/dotypos/backend/service";
import { m } from "@/i18n";
import { siteConstants } from "@/shared/utils/constants";
import { MenuFooterNote } from "./menu-footer-note";
import { MenuHero } from "./menu-hero";
import { MenuOpeningHours } from "./menu-opening-hours";
import { MenuPDFDownload } from "./menu-pdf-download";
import { MenuSection } from "./menu-section";

interface MenuClientProps {
  categories: Array<{
    id: string;
    name: string;
    items: MenuItemWithCategory[];
  }>;
}

export function MenuClient({ categories }: MenuClientProps) {
  // Group categories by type using ID-based configuration
  const groupedCategories = {
    drinks: [] as Array<{
      id: string;
      name: string;
      items: MenuItemWithCategory[];
    }>,
    food: [] as Array<{
      id: string;
      name: string;
      items: MenuItemWithCategory[];
    }>,
    other: [] as Array<{
      id: string;
      name: string;
      items: MenuItemWithCategory[];
    }>,
  };

  // Create a map for quick category lookup by ID
  const categoryMap = new Map(categories.map((cat) => [cat.id, cat]));

  // Process categories in the order defined in the config
  // This ensures the display order matches the configuration

  // Process food categories in config order
  siteConstants.menu.categoryGroups.food.forEach((categoryId) => {
    const category = categoryMap.get(categoryId);
    if (
      category &&
      !siteConstants.menu.excludedCategories.includes(categoryId)
    ) {
      groupedCategories.food.push(category);
    }
  });

  // Process drinks categories in config order
  siteConstants.menu.categoryGroups.drinks.forEach((categoryId) => {
    const category = categoryMap.get(categoryId);
    if (
      category &&
      !siteConstants.menu.excludedCategories.includes(categoryId)
    ) {
      groupedCategories.drinks.push(category);
    }
  });

  // Process other categories in config order
  siteConstants.menu.categoryGroups.other.forEach((categoryId) => {
    const category = categoryMap.get(categoryId);
    if (
      category &&
      !siteConstants.menu.excludedCategories.includes(categoryId)
    ) {
      groupedCategories.other.push(category);
    }
  });

  // Handle uncategorized items if enabled
  if (siteConstants.menu.showUncategorized) {
    const defaultSection = siteConstants.menu.defaultSection;
    const processedIds = new Set([
      ...siteConstants.menu.categoryGroups.food,
      ...siteConstants.menu.categoryGroups.drinks,
      ...siteConstants.menu.categoryGroups.other,
      ...siteConstants.menu.excludedCategories,
    ]);

    categories.forEach((category) => {
      if (!processedIds.has(category.id) && category.items.length > 0) {
        if (defaultSection === "drinks") {
          groupedCategories.drinks.push(category);
        } else if (defaultSection === "food") {
          groupedCategories.food.push(category);
        } else if (defaultSection === "other") {
          groupedCategories.other.push(category);
        }
      }
    });
  }

  return (
    <div className="bg-black">
      <MenuHero />

      <div className="max-w-4xl mx-auto px-6 py-16">
        <MenuPDFDownload />
        <MenuOpeningHours />

        {/* Food Section */}
        {groupedCategories.food.length > 0 && (
          <div className="mb-16">
            <h1 className="text-4xl font-bold text-center text-white mb-12">
              🍔 {m["menu.sections.food"]()}
            </h1>
            {groupedCategories.food.map((category) => (
              <MenuSection
                key={category.id}
                categoryName={category.name}
                items={category.items}
              />
            ))}
          </div>
        )}

        {/* Drinks Section */}
        {groupedCategories.drinks.length > 0 && (
          <div className="mb-16">
            <h1 className="text-4xl font-bold text-center text-white mb-12">
              🥤 {m["menu.sections.drinks"]()}
            </h1>
            {groupedCategories.drinks.map((category) => (
              <MenuSection
                key={category.id}
                categoryName={category.name}
                items={category.items}
              />
            ))}
          </div>
        )}

        {/* Other Section */}
        {groupedCategories.other.length > 0 && (
          <div className="mb-16">
            <h1 className="text-4xl font-bold text-center text-white mb-12">
              🎲 {m["menu.sections.other"]()}
            </h1>
            {groupedCategories.other.map((category) => (
              <MenuSection
                key={category.id}
                categoryName={category.name}
                items={category.items}
              />
            ))}
          </div>
        )}

        <MenuFooterNote />
      </div>
    </div>
  );
}
