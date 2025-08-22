"use client";

import type { MenuItemWithCategory } from "@/features/dotypos/backend/service";
import { m } from "@/i18n";
import { MenuFooterNote } from "./menu-footer-note";
import { MenuHero } from "./menu-hero";
import { MenuOpeningHours } from "./menu-opening-hours";
import { MenuPDFDownload } from "./menu-pdf-download";
import { MenuSection } from "./menu-section";

// Category display order and grouping
const CATEGORY_GROUPS = {
  drinks: [
    "Nealkoholické nápoje",
    "Teplé nápoje",
    "Alkoholické nápoje",
    "Pivo",
    "Víno",
    "Destiláty",
    "Míchané nápoje",
    "Koktejly",
  ],
  food: [
    "Občerstvení",
    "Teplá jídla",
    "Předkrmy",
    "Hlavní jídla",
    "Dezerty",
    "Sladké",
    "Něco na zub",
    "Mám malý hlad",
    "Něco sladkého",
    "Pořádné jídlo",
  ],
} as const;

interface MenuClientProps {
  categories: Array<{ name: string; items: MenuItemWithCategory[] }>;
}

export function MenuClient({ categories }: MenuClientProps) {
  // Group categories by type
  const groupedCategories = {
    drinks: [] as Array<{ name: string; items: MenuItemWithCategory[] }>,
    food: [] as Array<{ name: string; items: MenuItemWithCategory[] }>,
    other: [] as Array<{ name: string; items: MenuItemWithCategory[] }>,
  };

  categories.forEach((category) => {
    const isDrink = CATEGORY_GROUPS.drinks.some((name) =>
      category.name.toLowerCase().includes(name.toLowerCase())
    );
    const isFood = CATEGORY_GROUPS.food.some((name) =>
      category.name.toLowerCase().includes(name.toLowerCase())
    );

    if (isDrink) {
      groupedCategories.drinks.push(category);
    } else if (isFood) {
      groupedCategories.food.push(category);
    } else if (category.items.length > 0) {
      groupedCategories.other.push(category);
    }
  });

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
                key={category.name}
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
                key={category.name}
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
                key={category.name}
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
