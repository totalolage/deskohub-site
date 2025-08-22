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

    // Group categories by type (same logic as in menu-client.tsx)
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
    };

    const groupedCategories = {
      drinks: [] as Array<{ name: string; items: MenuItemWithCategory[] }>,
      food: [] as Array<{ name: string; items: MenuItemWithCategory[] }>,
      other: [] as Array<{ name: string; items: MenuItemWithCategory[] }>,
    };

    categorizedItems.forEach((category) => {
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
