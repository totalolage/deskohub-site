"use server";

import { renderToBuffer } from "@react-pdf/renderer";
import { Effect } from "effect";
import { DotyposServiceLive, getMenuItems } from "@/features/dotypos";
import type { MenuItemWithCategory } from "@/features/dotypos/backend/service";
import { MenuPDFDocument } from "../components/menu-pdf-document";

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

    // Generate PDF using React PDF
    const pdfBuffer = await renderToBuffer(
      <MenuPDFDocument categories={groupedCategories} />
    );

    // Convert buffer to base64 for transfer to client
    const base64Pdf = pdfBuffer.toString("base64");

    // Return the PDF data
    return {
      success: true,
      pdfData: base64Pdf,
      filename: "deskohub-menu.pdf",
    };
  } catch (error) {
    console.error("Failed to generate menu PDF:", error);
    return { success: false, error: "Failed to generate PDF" };
  }
}
