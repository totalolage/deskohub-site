"use server";

import { Effect } from "effect";
import { DotyposServiceLive, getMenuItems } from "@/features/dotypos";
import type { MenuItemWithCategory } from "@/features/dotypos/backend/service";

export async function generateMenuPDF() {
  // Fetch menu data from Dotypos
  const program = getMenuItems().pipe(
    Effect.provide(DotyposServiceLive),
    Effect.tapError((error) =>
      Effect.logError("Failed to fetch menu data for PDF", error)
    )
  );

  try {
    const result = await Effect.runPromise(program);

    // Group items by category for PDF
    const categorizedItems = Array.from(result.itemsByCategory.entries()).map(
      ([categoryName, items]) => ({
        name: categoryName,
        items: items,
      })
    );

    // Use ID-based configuration from site constants
    const { menu } = await import("@/shared/utils/constants").then(
      (m) => m.siteConstants
    );

    const groupedCategories = {
      drinks: [] as Array<{ name: string; items: MenuItemWithCategory[] }>,
      food: [] as Array<{ name: string; items: MenuItemWithCategory[] }>,
      other: [] as Array<{ name: string; items: MenuItemWithCategory[] }>,
    };

    // Create a map of category names to IDs (similar to menu-server)
    const categoryIdMap = new Map<string, string>();
    result.categories.forEach((cat) => {
      if (cat.name && cat.id) {
        categoryIdMap.set(cat.name, cat.id);
      }
    });

    // Create a map for quick category lookup by name
    const categoriesByName = new Map(
      categorizedItems.map((cat) => [cat.name, cat])
    );

    // Process categories in the order defined in the config
    // This ensures the display order matches the configuration

    // Helper function to add category by ID
    const addCategoryById = (
      categoryId: string,
      targetGroup: Array<{ name: string; items: MenuItemWithCategory[] }>
    ) => {
      // Find category name that matches this ID
      const categoryName = Array.from(categoryIdMap.entries()).find(
        ([_name, id]) => id === categoryId
      )?.[0];

      if (categoryName) {
        const category = categoriesByName.get(categoryName);
        if (category && !menu.excludedCategories.includes(categoryId)) {
          targetGroup.push(category);
        }
      }
    };

    // Process food categories in config order
    menu.categoryGroups.food.forEach((categoryId) => {
      addCategoryById(categoryId, groupedCategories.food);
    });

    // Process drinks categories in config order
    menu.categoryGroups.drinks.forEach((categoryId) => {
      addCategoryById(categoryId, groupedCategories.drinks);
    });

    // Process other categories in config order
    menu.categoryGroups.other.forEach((categoryId) => {
      addCategoryById(categoryId, groupedCategories.other);
    });

    // Handle uncategorized items if enabled
    if (menu.showUncategorized) {
      const defaultSection = menu.defaultSection;
      const processedIds = new Set([
        ...menu.categoryGroups.food,
        ...menu.categoryGroups.drinks,
        ...menu.categoryGroups.other,
        ...menu.excludedCategories,
      ]);

      categorizedItems.forEach((category) => {
        const categoryId =
          categoryIdMap.get(category.name) ||
          category.items[0]?.categoryId ||
          "unknown";
        if (!processedIds.has(categoryId) && category.items.length > 0) {
          if (defaultSection && groupedCategories[defaultSection]) {
            groupedCategories[defaultSection].push(category);
          }
        }
      });
    }

    // Create HTML content for PDF
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Deskohub Menu</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .header { text-align: center; margin-bottom: 30px; }
          .logo { max-width: 150px; height: auto; margin-bottom: 10px; }
          h1 { color: #000; font-size: 32px; }
          h2 { color: #22c55e; font-size: 24px; margin-top: 30px; margin-bottom: 20px; }
          .category { margin-bottom: 30px; }
          .category-title { color: #22c55e; font-size: 20px; font-weight: bold; margin-bottom: 15px; }
          .item { display: flex; justify-content: space-between; margin-bottom: 10px; padding: 8px; border-bottom: 1px solid #eee; }
          .item-name { font-weight: bold; }
          .item-unit { color: #666; font-size: 12px; margin-left: 5px; }
          .item-description { color: #666; font-size: 12px; }
          .item-price { font-weight: bold; color: #22c55e; white-space: nowrap; }
          .unavailable { opacity: 0.6; }
          .unavailable .item-name::after { content: " (momentálně nedostupné)"; color: red; font-size: 10px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>DESKOHUB MENU</h1>
        </div>
        
        ${
          groupedCategories.food.length > 0
            ? `
          <h2>🍔 JÍDLO</h2>
          ${groupedCategories.food
            .map(
              (category) => `
            <div class="category">
              <div class="category-title">${category.name}</div>
              ${category.items
                .map(
                  (item) => `
                <div class="item ${!item.available ? "unavailable" : ""}">
                  <div>
                    <span class="item-name">${item.name}</span>
                    ${
                      item.unit && ["g", "l"].some((u) => item.unit.includes(u))
                        ? `<span class="item-unit">(${item.unit})</span>`
                        : ""
                    }
                    ${
                      item.description
                        ? `<div class="item-description">${item.description}</div>`
                        : ""
                    }
                  </div>
                  <div class="item-price">
                    ${
                      item.priceWithVat && Number(item.priceWithVat) > 0
                        ? `${Math.round(Number(item.priceWithVat))} Kč`
                        : "Na dotaz"
                    }
                  </div>
                </div>
              `
                )
                .join("")}
            </div>
          `
            )
            .join("")}
        `
            : ""
        }
        
        ${
          groupedCategories.drinks.length > 0
            ? `
          <h2>🥤 NÁPOJE</h2>
          ${groupedCategories.drinks
            .map(
              (category) => `
            <div class="category">
              <div class="category-title">${category.name}</div>
              ${category.items
                .map(
                  (item) => `
                <div class="item ${!item.available ? "unavailable" : ""}">
                  <div>
                    <span class="item-name">${item.name}</span>
                    ${
                      item.unit && ["g", "l"].some((u) => item.unit.includes(u))
                        ? `<span class="item-unit">(${item.unit})</span>`
                        : ""
                    }
                    ${
                      item.description
                        ? `<div class="item-description">${item.description}</div>`
                        : ""
                    }
                  </div>
                  <div class="item-price">
                    ${
                      item.priceWithVat && Number(item.priceWithVat) > 0
                        ? `${Math.round(Number(item.priceWithVat))} Kč`
                        : "Na dotaz"
                    }
                  </div>
                </div>
              `
                )
                .join("")}
            </div>
          `
            )
            .join("")}
        `
            : ""
        }
        
        ${
          groupedCategories.other.length > 0
            ? `
          <h2>🎲 OSTATNÍ</h2>
          ${groupedCategories.other
            .map(
              (category) => `
            <div class="category">
              <div class="category-title">${category.name}</div>
              ${category.items
                .map(
                  (item) => `
                <div class="item ${!item.available ? "unavailable" : ""}">
                  <div>
                    <span class="item-name">${item.name}</span>
                    ${
                      item.unit && ["g", "l"].some((u) => item.unit.includes(u))
                        ? `<span class="item-unit">(${item.unit})</span>`
                        : ""
                    }
                    ${
                      item.description
                        ? `<div class="item-description">${item.description}</div>`
                        : ""
                    }
                  </div>
                  <div class="item-price">
                    ${
                      item.priceWithVat && Number(item.priceWithVat) > 0
                        ? `${Math.round(Number(item.priceWithVat))} Kč`
                        : "Na dotaz"
                    }
                  </div>
                </div>
              `
                )
                .join("")}
            </div>
          `
            )
            .join("")}
        `
            : ""
        }
      </body>
      </html>
    `;

    // Return the HTML content for the client to download
    return {
      success: true,
      htmlContent,
      filename: "deskohub-menu.html",
    };
  } catch (error) {
    console.error("Failed to generate menu PDF:", error);
    return { success: false, error: "Failed to generate PDF" };
  }
}
